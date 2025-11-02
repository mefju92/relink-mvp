// server/server.cjs
require('dotenv').config();
const express = require('express');
const multer = require('multer');

// użyj node-fetch w CommonJS (działa też w Node <18)
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

// ================== In-memory progress store ==================
/** userId -> { current, total, results, done, error } */
const matchProgress = new Map();

const {
  PORT = 5174,
  CORS_ORIGIN,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  PLAYLIST_NAME = 'ReLink Import',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_BUCKET = 'music',
  USER_LINKS_TABLE = 'user_links',
} = process.env;

const app = express();

// ================== CORS / JSON ==================
app.use((req, res, next) => {
  const allowOrigin = CORS_ORIGIN || req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '20mb' }));

// ================== Utils ==================
function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// wykryj czy ścieżka była wołana przez /api/... (do poprawnego redirect_uri)
function computeRedirectUri(req) {
  const isApi = (req.originalUrl || req.url || '').startsWith('/api/');
  return `${getBaseUrl(req)}${isApi ? '/api' : ''}/spotify/callback`;
}

// ================== Supabase (service role) ==================
const { createClient } = require('@supabase/supabase-js');
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Autoryzacja przez Bearer Supabase JWT
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'missing token' });
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ ok: false, error: 'invalid token' });
  req.user = data.user; // { id, ... }
  next();
}

// ================== Spotify helpers ==================
async function getUserSpotifyAccessTokenByUserId(userId) {
  const { data, error } = await supa
    .from(USER_LINKS_TABLE)
    .select('spotify_refresh_token')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;

  const refresh = data?.spotify_refresh_token;
  if (!refresh) {
    const e = new Error('NO_LINK: user not connected to Spotify');
    e.code = 'NO_LINK';
    throw e;
  }

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }),
  });
  const j = await r.json();
  if (!r.ok) {
    const e = new Error(`REFRESH_FAILED ${r.status}: ${JSON.stringify(j)}`);
    e.code = 'REFRESH_FAILED';
    e.details = j;
    throw e;
  }
  return j.access_token;
}

async function getSpotifyMe(accessToken) {
  const r = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`me error: ${r.status} ${JSON.stringify(j)}`);
  return j;
}

// ================== Normalizacja / dopasowanie ==================
function jaccard(a, b) {
  const A = new Set(String(a || '').toLowerCase().split(/\s+/).filter(Boolean));
  const B = new Set(String(b || '').toLowerCase().split(/\s+/).filter(Boolean));
  const I = new Set([...A].filter(x => B.has(x))).size;
  const U = new Set([...A, ...B]).size || 1;
  return I / U;
}

function normArtist(a) { 
  return (a || '').toLowerCase().replace(/\s+/g, ' ').trim(); 
}

function coreTitle(s) {
  if (!s) return '';
  let cleaned = (s || '')
    .toLowerCase()
    .replace(/\b(out\s*now)\b/gi, '')
    .replace(/\[\s*out\s*now\s*\]/gi, '')
    .replace(/\bofficial\s+(?:music\s+)?video\b/gi, '')
    .replace(/\bofficial\s+audio\b/gi, '')
    .replace(/\b(hd|hq|4k|8k)\b/gi, '')
    .replace(/\blyrics?\b/gi, '')
    .replace(/\blyric\s+video\b/gi, '')
    .replace(/\(\d{4}\)/g, '')
    .replace(/\d{3,4}p/gi, '')
    .replace(/\s*-?\s*copy\s*\(\d+\)\s*$/i, '')
    .replace(/\s*\(\s*copy\s*\d*\s*\)/gi, '')
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

function splitArtists(artistRaw) {
  if (!artistRaw) return [];
  const normalized = normArtist(artistRaw);
  return normalized
    .split(/\s*(?:,|&|x|vs\.?|versus|feat\.?|ft\.?|featuring|with)\s*/i)
    .map(a => a.trim())
    .filter(Boolean);
}

function artistOverlap(localArtist, spotifyArtists) {
  const localTokens = splitArtists(localArtist);
  const spotifyTokens = (spotifyArtists || []).map(a => normArtist(a.name));
  if (localTokens.length === 0) return 0.5;
  let matches = 0;
  for (const local of localTokens) {
    for (const sp of spotifyTokens) {
      if (jaccard(local, sp) > 0.6) { matches++; break; }
    }
  }
  return matches / localTokens.length;
}

function durationScore(localMs, spMs) {
  if (!localMs || !spMs) return 0.6;
  const diff = Math.abs(localMs - spMs);
  if (diff <= 2000)  return 1.0;
  if (diff <= 5000)  return 0.95;
  if (diff <= 10000) return 0.85;
  if (diff <= 20000) return 0.7;
  if (diff <= 30000) return 0.55;
  return 0.4;
}

function scoreCandidate(local, sp) {
  const tLocal = coreTitle(local.title);
  const tSp    = coreTitle(sp.name);
  const titleScore  = jaccard(tLocal, tSp);
  const artistScore = local.artist ? artistOverlap(local.artist, sp.artists || []) : 0.5;
  const durScore    = durationScore(local.durationMs, sp.duration_ms);

  const localHasRemix = /\b(remix|edit)\b/i.test(local.title || '');
  const spHasRemix    = /\b(remix|edit)\b/i.test(sp.name || '');
  const remixBonus    = (localHasRemix && spHasRemix) ? 0.05 : 0;

  return Math.min(1.0, 0.50 * titleScore + 0.40 * artistScore + 0.10 * durScore + remixBonus);
}

function buildSearchQueries(track) {
  let title = coreTitle(track.title || '');
  let artist = normArtist(track.artist || '');
  const artists = splitArtists(track.artist || '');

  // usuń np. "- Records" z końca
  title = title.replace(/\s*-\s*(music|records|recordings|label|entertainment)$/i, '').trim();

  // feat z tytułu do artysty (gdy sensowne)
  const featMatch = title.match(/\b(?:feat\.?|ft\.?|featuring)\s+([^()]+?)(?:\)|$)/i);
  if (featMatch && artists.length === 1) {
    const featArtist = featMatch[1].trim();
    artists.push(featArtist);
    title = title.replace(/\s*[\(\[]?\s*(?:feat\.?|ft\.?|featuring)\s+[^()\]]+[\)\]]?/gi, '').trim();
  }

  const hasRemix       = /\b(remix|edit|mix|bootleg|mashup|vip)\b/i.test(title);
  const titleNoRemix   = title.replace(/\b(remix|edit|mix|bootleg|mashup|vip)\b/gi, '').trim();
  const titleNoBracks  = title.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();

  const Q = new Set();

  if (artist && title) Q.add(`${artist} ${title}`);
  if (titleNoBracks !== title && artist && titleNoBracks) Q.add(`${artist} ${titleNoBracks}`);
  if (title) Q.add(title);
  if (artists.length > 1 && title) {
    Q.add(`${artists[0]} ${artists[1]} ${title}`);
    if (titleNoBracks) Q.add(`${artists[0]} ${artists[1]} ${titleNoBracks}`);
  }
  if (hasRemix && titleNoRemix && artist) Q.add(`${artist} ${titleNoRemix}`);
  if (artist && (titleNoBracks || title)) Q.add(`track:"${titleNoBracks || title}" artist:"${artists[0] || artist}"`);

  return [...Q].slice(0, 6);
}

async function spotifySearch(q, userAccessToken, limit = 5) {
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'track');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${userAccessToken}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`search error ${res.status}: ${JSON.stringify(json)}`);
  return json.tracks?.items || [];
}

function groupDuplicates(tracks) {
  const groups = [];
  const seen = new Set();

  tracks.forEach((track, idx) => {
    if (seen.has(idx)) return;

    const key = `${normArtist(track.artist || '')}_${coreTitle(track.title || '')}`;
    const group = { master: idx, duplicates: [], track };

    tracks.forEach((other, otherIdx) => {
      if (otherIdx <= idx) return;
      const otherKey = `${normArtist(other.artist || '')}_${coreTitle(other.title || '')}`;
      const durationDiff = Math.abs((track.durationMs || 0) - (other.durationMs || 0));
      if (otherKey === key || (otherKey === key && durationDiff < 3000)) {
        group.duplicates.push(otherIdx);
        seen.add(otherIdx);
      }
    });

    groups.push(group);
  });

  return groups;
}

// ================== Routes: misc ==================
app.get('/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now(), base: getBaseUrl(req) });
});

// ================== Routes: Spotify OAuth ==================
// login – dostępne pod /spotify/login i /api/spotify/login
app.get(['/spotify/login', '/api/spotify/login'], async (req, res) => {
  const frontendParam = (req.query.frontend || CORS_ORIGIN || '/').replace(/\/$/, '');
  const frontend = /\/app$/.test(frontendParam) ? frontendParam : (frontendParam + '/app');
  const jwt = req.query.token || null;

  const redirect_uri = computeRedirectUri(req);
  const scope = 'playlist-modify-private playlist-modify-public user-read-email user-read-private';
  const state = Buffer.from(JSON.stringify({ f: frontend, jwt }), 'utf8').toString('base64url');

  const authUrl =
    'https://accounts.spotify.com/authorize?' +
    new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri,
      scope,
      state,
    }).toString();

  res.redirect(authUrl);
});

// callback – dostępne pod /spotify/callback i /api/spotify/callback
app.get(['/spotify/callback', '/api/spotify/callback'], async (req, res) => {
  try {
    const { code, state, error } = req.query;
    const parsed = (() => { 
      try { return JSON.parse(Buffer.from(state || '', 'base64url').toString()) } 
      catch { return {} } 
    })();
    const frontend = (parsed.f || CORS_ORIGIN || '/').replace(/\/$/, '');
    const jwt = parsed.jwt || null;

    if (error) return res.redirect(`${frontend}?spotify=error&reason=${encodeURIComponent(error)}`);
    if (!code) return res.status(400).send('<pre>Brak ?code z Spotify</pre>');

    const redirect_uri = computeRedirectUri(req);

    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri }),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok) {
      return res.status(400).send(`<pre>Token exchange failed ${tokenRes.status}\n${JSON.stringify(tok, null, 2)}</pre>`);
    }

    const refresh = tok.refresh_token || null;
    const access  = tok.access_token  || null;

    let spName = null, spUserId = null;
    if (access) {
      const meRes = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${access}` } });
      const me = await meRes.json();
      if (meRes.ok) { 
        spUserId = me.id || null; 
        spName   = me.display_name || me.id || null; 
      }
    }

    if (jwt && refresh) {
      const { data: u, error: uerr } = await supa.auth.getUser(jwt);
      if (!uerr && u?.user?.id) {
        await supa.from(USER_LINKS_TABLE).upsert({
          user_id: u.user.id,
          spotify_user_id: spUserId,
          spotify_display_name: spName,
          spotify_refresh_token: refresh,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      }
    }

    const back = `${frontend}?spotify=ok`;
    res.send(`<!doctype html><meta charset="utf-8">
      <style>body{font-family:system-ui;padding:24px;max-width:600px;margin:40px auto}</style>
      <h3>✅ Połączono ze Spotify</h3>
      ${spName ? `<p>Konto: <b>${spName}</b></p>` : ''}
      <p>Za chwilę wrócisz do aplikacji…</p>
      <script>setTimeout(()=>location.href=${JSON.stringify(back)}, 1200)</script>`);
  } catch (e) {
    res.status(500).send(`<pre>${String(e)}</pre>`);
  }
});

// status / disconnect
app.get('/api/spotify/status', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supa
      .from(USER_LINKS_TABLE)
      .select('spotify_display_name')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error && (error.code === '42P01' || error.message?.includes('relation'))) {
      return res.json({ ok: true, connected: false, name: null, hint: 'table_missing' });
    }
    if (error && error.code !== 'PGRST116') throw error;

    res.json({ ok: true, connected: !!data, name: data?.spotify_display_name || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/spotify/disconnect', requireAuth, async (req, res) => {
  try {
    const { error } = await supa
      .from(USER_LINKS_TABLE)
      .delete()
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true, message: 'Spotify disconnected' });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ================== Routes: Matching ==================
app.post('/api/match', requireAuth, async (req, res) => {
  try {
    const { tracks = [] } = req.body || {};
    const userId = req.user.id;

    matchProgress.set(userId, { current: 0, total: tracks.length, results: null, done: false, error: null });
    res.json({ ok: true, jobId: userId, total: tracks.length });

    (async () => {
      try {
        const userAccess = await getUserSpotifyAccessTokenByUserId(userId);
        const groups = groupDuplicates(tracks);
        const allResults = [];

        for (let idx = 0; idx < groups.length; idx++) {
          const group = groups[idx];
          const t = group.track;

          const queries = buildSearchQueries(t);
          const allItems = [];
          const seenIds = new Set();

          for (const q of queries) {
            const items = await spotifySearch(q, userAccess, 5);
            for (const item of items) {
              if (!seenIds.has(item.id)) {
                allItems.push(item);
                seenIds.add(item.id);
              }
            }
          }

          let best = null, bestScore = -1;
          for (const it of allItems) {
            const s = scoreCandidate(t, it);
            if (s > bestScore) { best = it; bestScore = s; }
          }

          allResults.push({ best, bestScore, group });

          matchProgress.set(userId, { current: idx + 1, total: groups.length, results: null, done: false, error: null });
          await new Promise(r => setTimeout(r, 150));
        }

        // dynamiczny próg: >=85% trafień
        const thresholds = [0.56, 0.50, 0.45, 0.40, 0.35, 0.30];
        let chosenThreshold = 0.30;
        for (const threshold of thresholds) {
          const matched = allResults.filter(r => r.best && r.bestScore >= threshold).length;
          if (matched / allResults.length >= 0.85) { chosenThreshold = threshold; break; }
        }

        // wypełnij wyniki po ORYGINALNYCH indeksach
        const out = Array(tracks.length).fill(null);

        for (const result of allResults) {
          const { best, bestScore, group } = result;
          const duplicates = group.duplicates.length;

          const masterIdx = group.master;
          out[masterIdx] = best && bestScore >= chosenThreshold
            ? {
                spotifyId: best.id,
                spotifyUrl: best.external_urls?.spotify,
                name: best.name,
                artists: (best.artists || []).map(a => a.name).join(', '),
                score: Number(bestScore.toFixed(3)),
                duplicates,
                matched: true,
                isDuplicate: false
              }
            : {
                spotifyId: null, spotifyUrl: null, name: null, artists: null,
                score: Number((bestScore >= 0 ? bestScore : 0).toFixed(3)),
                duplicates,
                matched: false,
                isDuplicate: false
              };

          for (const dupIdx of group.duplicates) {
            out[dupIdx] = {
              spotifyId: null, spotifyUrl: null, name: null, artists: null,
              score: 0, duplicates: 0, matched: false, isDuplicate: true
            };
          }
        }

        matchProgress.set(userId, {
          current: groups.length,
          total: groups.length,
          results: { ok: true, results: out, threshold: chosenThreshold },
          done: true,
          error: null
        });

        setTimeout(() => matchProgress.delete(userId), 5 * 60 * 1000);
      } catch (e) {
        matchProgress.set(userId, { current: 0, total: 0, results: null, done: true, error: String(e) });
      }
    })();

  } catch (e) {
    if (e && e.code === 'NO_LINK') {
      return res.status(409).json({ ok: false, error: 'Spotify not connected', code: 'NO_LINK' });
    }
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get('/api/match/progress', requireAuth, async (req, res) => {
  const progress = matchProgress.get(req.user.id);
  if (!progress) return res.json({ exists: false });
  res.json({ exists: true, ...progress });
});

// (opcjonalny) strumień SSE — można używać zamiast /progress
app.post('/api/match-stream', requireAuth, async (req, res) => {
  try {
    const { tracks = [] } = req.body || {};
    const userAccess = await getUserSpotifyAccessTokenByUserId(req.user.id);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const groups = groupDuplicates(tracks);
    const allResults = [];
    const total = groups.length;

    for (let idx = 0; idx < groups.length; idx++) {
      const group = groups[idx];
      const t = group.track;

      const queries = buildSearchQueries(t);
      const allItems = [];
      const seenIds = new Set();

      for (const q of queries) {
        const items = await spotifySearch(q, userAccess, 5);
        for (const item of items) {
          if (!seenIds.has(item.id)) {
            allItems.push(item);
            seenIds.add(item.id);
          }
        }
      }

      let best = null, bestScore = -1;
      for (const it of allItems) {
        const s = scoreCandidate(t, it);
        if (s > bestScore) { best = it; bestScore = s; }
      }

      allResults.push({ best, bestScore, group });

      const progress = Math.round(((idx + 1) / total) * 100);
      res.write(`data: ${JSON.stringify({ type: 'progress', value: progress, current: idx + 1, total })}\n\n`);

      await new Promise(r => setTimeout(r, 150));
    }

    const thresholds = [0.56, 0.50, 0.45, 0.40, 0.35, 0.30];
    let chosenThreshold = 0.30;
    for (const threshold of thresholds) {
      const matched = allResults.filter(r => r.best && r.bestScore >= threshold).length;
      if (matched / allResults.length >= 0.85) { chosenThreshold = threshold; break; }
    }

    const out = Array(tracks.length).fill(null);
    for (const { best, bestScore, group } of allResults) {
      const duplicates = group.duplicates.length;
      const masterIdx  = group.master;

      out[masterIdx] = best && bestScore >= chosenThreshold
        ? {
            spotifyId: best.id,
            spotifyUrl: best.external_urls?.spotify,
            name: best.name,
            artists: (best.artists || []).map(a => a.name).join(', '),
            score: Number(bestScore.toFixed(3)),
            duplicates,
            matched: true,
            isDuplicate: false
          }
        : {
            spotifyId: null, spotifyUrl: null, name: null, artists: null,
            score: Number((bestScore >= 0 ? bestScore : 0).toFixed(3)),
            duplicates,
            matched: false,
            isDuplicate: false
          };

      for (const dupIdx of group.duplicates) {
        out[dupIdx] = {
          spotifyId: null, spotifyUrl: null, name: null, artists: null,
          score: 0, duplicates: 0, matched: false, isDuplicate: true
        };
      }
    }

    for (let i = 0; i < out.length; i++) {
      if (!out[i]) {
        out[i] = { spotifyId:null, spotifyUrl:null, name:null, artists:null, score:0, duplicates:0, matched:false, isDuplicate:false };
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'complete', results: out, threshold: chosenThreshold })}\n\n`);
    res.end();

  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: String(e) })}\n\n`);
    res.end();
  }
});

// ================== Routes: Playlist creation ==================
app.post('/api/playlist', requireAuth, async (req, res) => {
  try {
    const { name = PLAYLIST_NAME, trackUris = [] } = req.body || {};
    if (!Array.isArray(trackUris) || trackUris.length === 0) {
      return res.status(400).json({ ok: false, error: 'Brak trackUris' });
    }

    const userAccess = await getUserSpotifyAccessTokenByUserId(req.user.id);
    const me = await getSpotifyMe(userAccess);
    const userId = me.id;

    // create playlist
    let r = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userAccess}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, public: false, description: 'Imported by ReLink' }),
    });
    let pj = await r.json();
    if (!r.ok) throw new Error(`create playlist: ${r.status} ${JSON.stringify(pj)}`);

    // add tracks (batch 100)
    for (let i = 0; i < trackUris.length; i += 100) {
      const slice = trackUris.slice(i, i + 100);
      r = await fetch(`https://api.spotify.com/v1/playlists/${pj.id}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAccess}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: slice }),
      });
      const aj = await r.json();
      if (!r.ok) throw new Error(`add tracks: ${r.status} ${JSON.stringify(aj)}`);
      await new Promise(r => setTimeout(r, 150));
    }

    res.json({ ok: true, playlistId: pj.id, playlistUrl: pj.external_urls?.spotify });
  } catch (e) {
    if (e && e.code === 'NO_LINK') {
      return res.status(409).json({ ok: false, error: 'Spotify not connected', code: 'NO_LINK' });
    }
    if (e && e.code === 'REFRESH_FAILED') {
      return res.status(401).json({ ok: false, error: 'Re-auth required', code: 'NEED_RECONNECT' });
    }
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ================== Routes: Cloud (Supabase Storage) ==================
const upload = multer({ storage: multer.memoryStorage() });

app.get('/api/cloud/list', requireAuth, async (req, res) => {
  try {
    const prefix = `${req.user.id}/`;
    const { data: entries, error } = await supa.storage.from(SUPABASE_BUCKET).list(prefix, { limit: 1000 });
    if (error) throw error;

    const files = await Promise.all((entries || []).map(async f => {
      const path = prefix + f.name;
      const { data: signed } = await supa.storage.from(SUPABASE_BUCKET).createSignedUrl(path, 60 * 60);
      return { name: f.name, size: f.metadata?.size ?? f.size ?? 0, url: signed?.signedUrl };
    }));

    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post('/api/upload', requireAuth, upload.array('files', 50), async (req, res) => {
  try {
    const prefix = `${req.user.id}/`;
    const results = await Promise.all((req.files || []).map(async (file) => {
      const path = prefix + file.originalname;
      const { error } = await supa.storage.from(SUPABASE_BUCKET).upload(path, file.buffer, {
        contentType: file.mimetype, 
        upsert: true,
      });
      return { name: file.originalname, ok: !error, error: error?.message };
    }));
    res.json({ ok: true, files: results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.delete('/api/cloud/delete', requireAuth, async (req, res) => {
  try {
    const { filenames = [] } = req.body;
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ ok: false, error: 'Brak plików do usunięcia' });
    }

    const prefix = `${req.user.id}/`;
    const results = await Promise.all(
      filenames.map(async (filename) => {
        const path = prefix + filename;
        const { error } = await supa.storage.from(SUPABASE_BUCKET).remove([path]);
        return { name: filename, ok: !error, error: error?.message };
      })
    );

    const deleted = results.filter(r => r.ok).length;
    const failed  = results.filter(r => !r.ok).length;

    res.json({ ok: true, deleted, failed, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ================== Start ==================
app.listen(PORT, () => {
  console.log(`🚀 ReLink API on http://localhost:${PORT}`);
  console.log('📡 CORS_ORIGIN:', CORS_ORIGIN || '(*)');
  console.log('🎵 Spotify redirect (dynamic by path): <base>[ /api ]/spotify/callback');
  console.log('💾 USER_LINKS_TABLE:', USER_LINKS_TABLE);
});
