// server/server.cjs
require('dotenv').config();
const express = require('express');
const multer = require('multer');

const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

// Storage dla progressu dopasowywania (in-memory)
const matchProgress = new Map(); // userId -> { current, total, results, done }

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

app.use((req, res, next) => {
  const allowOrigin = CORS_ORIGIN || req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '20mb' }));

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

const { createClient } = require('@supabase/supabase-js');
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

// ========== ULEPSZONE FUNKCJE NORMALIZACJI ==========

function coreTitle(s) {
  if (!s) return '';
  
  let cleaned = (s || '')
    .toLowerCase()
    // Usuń TYLKO oczywisty szum
    .replace(/\b(out\s*now)\b/gi, '')
    .replace(/\[\s*out\s*now\s*\]/gi, '')
    .replace(/\bofficial\s+(?:music\s+)?video\b/gi, '')
    .replace(/\bofficial\s+audio\b/gi, '')
    .replace(/\b(hd|hq|4k|8k)\b/gi, '')
    .replace(/\blyrics?\b/gi, '')
    .replace(/\blyric\s+video\b/gi, '')
    .replace(/\(\d{4}\)/g, '') // usuń rok w nawiasach
    .replace(/\d{3,4}p/gi, '') // usuń 1080p, 720p
    // Usuń "Copy (1)", "Copy (2)" itp.
    .replace(/\s*-?\s*copy\s*\(\d+\)\s*$/i, '')
    .replace(/\s*\(\s*copy\s*\d*\s*\)/gi, '')
    // Usuń TYLKO puste nawiasy
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\{\s*\}/g, '')
    // Czyść spacje
    .replace(/\s+/g, ' ')
    .trim();
    
  return cleaned;
}

function normArtist(a) { 
  return (a || '').toLowerCase().replace(/\s+/g, ' ').trim(); 
}

// NOWE: Rozdzielanie artystów po feat/ft/&/x/vs
function splitArtists(artistRaw) {
  if (!artistRaw) return [];
  const normalized = normArtist(artistRaw);
  // Rozdziel po typowych separatorach
  return normalized
    .split(/\s*(?:,|&|x|vs\.?|versus|feat\.?|ft\.?|featuring|with)\s*/i)
    .map(a => a.trim())
    .filter(Boolean);
}

// NOWE: Oblicz overlap artystów (lepsze niż prosty jaccard)
function artistOverlap(localArtist, spotifyArtists) {
  const localTokens = splitArtists(localArtist);
  const spotifyTokens = spotifyArtists.map(a => normArtist(a.name));
  
  if (localTokens.length === 0) return 0.5; // fallback gdy brak artysty
  
  let matches = 0;
  for (const local of localTokens) {
    for (const spotify of spotifyTokens) {
      if (jaccard(local, spotify) > 0.6) {
        matches++;
        break;
      }
    }
  }
  
  return matches / localTokens.length;
}

function jaccard(a, b) {
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  const I = new Set([...A].filter(x => B.has(x))).size;
  const U = new Set([...A, ...B]).size || 1;
  return I / U;
}

function durationScore(localMs, spMs) {
  if (!localMs || !spMs) return 0.6; // wyższy fallback
  const diff = Math.abs(localMs - spMs);
  if (diff <= 2000) return 1.0;    // ±2s
  if (diff <= 5000) return 0.95;   // ±5s
  if (diff <= 10000) return 0.85;  // ±10s
  if (diff <= 20000) return 0.7;   // ±20s
  if (diff <= 30000) return 0.55;  // ±30s
  return 0.4;
}

// ULEPSZONE: Lepszy scoring z overlap artystów i bonusem za remix
function scoreCandidate(local, sp) {
  const tLocal = coreTitle(local.title);
  const tSp = coreTitle(sp.name);
  const aLocal = normArtist(local.artist || '');
  const spArtists = sp.artists || [];
  
  // Score tytułu
  const titleScore = jaccard(tLocal, tSp);
  
  // Score artysty - użyj overlap zamiast prostego jaccard
  const artistScore = aLocal ? artistOverlap(local.artist, spArtists) : 0.5;
  
  // Score czasu trwania
  const durScore = durationScore(local.durationMs, sp.duration_ms);
  
  // Bonus za dokładne dopasowanie remixu
  const localHasRemix = /\b(remix|edit)\b/i.test(local.title || '');
  const spHasRemix = /\b(remix|edit)\b/i.test(sp.name || '');
  const remixBonus = (localHasRemix && spHasRemix) ? 0.05 : 0;
  
  // NOWE WAGI: 50% tytuł, 40% artysta, 10% czas
  return Math.min(1.0, 0.50 * titleScore + 0.40 * artistScore + 0.10 * durScore + remixBonus);
}

// NOWE: Budowanie wielu wariantów zapytań
function buildSearchQueries(track) {
  let title = coreTitle(track.title || '');
  let artist = normArtist(track.artist || '');
  const artists = splitArtists(track.artist || '');
  
  // NOWE: Usuń label/wydawcę z końca tytułu (np. "- Guesthouse Music")
  title = title.replace(/\s*-\s*(music|records|recordings|label|entertainment)$/i, '').trim();
  
  // NOWE: Wyciągnij feat/ft z tytułu do artysty
  const featMatch = title.match(/\b(?:feat\.?|ft\.?|featuring)\s+([^()]+?)(?:\)|$)/i);
  if (featMatch && artists.length === 1) {
    const featArtist = featMatch[1].trim();
    artists.push(featArtist);
    // Usuń feat z tytułu
    title = title.replace(/\s*[\(\[]?\s*(?:feat\.?|ft\.?|featuring)\s+[^()\]]+[\)\]]?/gi, '').trim();
  }
  
  // Wykryj czy to remix/edit
  const hasRemix = /\b(remix|edit|mix|bootleg|mashup|vip)\b/i.test(title);
  const titleNoRemix = title.replace(/\b(remix|edit|mix|bootleg|mashup|vip)\b/gi, '').trim();
  
  // Warianty z nawiasami i bez
  const titleNoBrackets = title.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  
  const queries = [];
  
  // Zapytanie podstawowe z pełnym tytułem
  if (artist && title) {
    queries.push(`${artist} ${title}`);
  }
  
  // Bez nawiasów (często usuwa problematyczne "Radio Mix" itp)
  if (titleNoBrackets !== title && artist && titleNoBrackets) {
    queries.push(`${artist} ${titleNoBrackets}`);
  }
  
  // Tylko tytuł (gdy artist może być błędny z YouTube)
  if (title) {
    queries.push(title);
  }
  
  // Z wieloma artystami (np. "Calvin Harris Alesso Under Control")
  if (artists.length > 1 && title) {
    queries.push(`${artists[0]} ${artists[1]} ${title}`);
    // Też bez nawiasów
    if (titleNoBrackets !== title && titleNoBrackets) {
      queries.push(`${artists[0]} ${artists[1]} ${titleNoBrackets}`);
    }
  }
  
  // Wariant bez remix/edit (może znajdzie oryginał)
  if (hasRemix && titleNoRemix && artist) {
    queries.push(`${artist} ${titleNoRemix}`);
  }
  
  // Kwalifikatory Spotify (track:"..." artist:"...")
  if (artist && title) {
    queries.push(`track:"${titleNoBrackets || title}" artist:"${artists[0]}"`);
  }
  
  // Deduplikuj i ogranicz do 6 zapytań
  return [...new Set(queries.filter(Boolean))].slice(0, 6);
}

async function spotifySearch(q, userAccessToken, limit = 5) {
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'track');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { 
    headers: { Authorization: `Bearer ${userAccessToken}` } 
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`search error ${res.status}: ${JSON.stringify(json)}`);
  return json.tracks?.items || [];
}

// Grupowanie duplikatów
function groupDuplicates(tracks) {
  const groups = [];
  const seen = new Set();

  tracks.forEach((track, idx) => {
    if (seen.has(idx)) return;

    const key = `${normArtist(track.artist || '')}_${coreTitle(track.title || '')}`;
    const group = { 
      master: idx, 
      duplicates: [],
      track 
    };

    tracks.forEach((other, otherIdx) => {
      if (otherIdx <= idx) return;
      
      const otherKey = `${normArtist(other.artist || '')}_${coreTitle(other.title || '')}`;
      const durationDiff = Math.abs((track.durationMs || 0) - (other.durationMs || 0));
      
      if (otherKey === key || (key && otherKey && key === otherKey && durationDiff < 3000)) {
        group.duplicates.push(otherIdx);
        seen.add(otherIdx);
      }
    });

    groups.push(group);
  });

  return groups;
}

async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'missing token' });
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ ok: false, error: 'invalid token' });
  req.user = data.user;
  next();
}

app.get('/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now(), base: getBaseUrl(req) });
});

app.get('/spotify/login', (req, res) => {
  const frontendParam = (req.query.frontend || CORS_ORIGIN || '/').replace(/\/$/, '');
  const frontend = /\/app$/.test(frontendParam) ? frontendParam : (frontendParam + '/app');
  const jwt = req.query.token || null;

  const redirect_uri = `${getBaseUrl(req)}/spotify/callback`;
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

app.get('/spotify/callback', async (req, res) => {
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

    const redirect_uri = `${getBaseUrl(req)}/spotify/callback`;

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
    const access = tok.access_token || null;

    let spName = null, spUserId = null;
    if (access) {
      const meRes = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${access}` } });
      const me = await meRes.json();
      if (meRes.ok) { 
        spUserId = me.id || null; 
        spName = me.display_name || me.id || null; 
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

app.post('/api/match', requireAuth, async (req, res) => {
  try {
    const { tracks = [] } = req.body || {};
    const userId = req.user.id;
    
    // Inicjalizuj progress
    matchProgress.set(userId, { current: 0, total: tracks.length, results: null, done: false, error: null });
    
    // Odpowiedz od razu, żeby nie blokować
    res.json({ ok: true, jobId: userId, total: tracks.length });
    
    // Przetwarzanie w tle
    (async () => {
      try {
        const userAccess = await getUserSpotifyAccessTokenByUserId(userId);
        const groups = groupDuplicates(tracks);
        const allResults = [];
        
        for (let idx = 0; idx < groups.length; idx++) {
          const group = groups[idx];
          const t = group.track;
          
          // ULEPSZONE: Wielowariantowe zapytania
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
          
          allResults.push({ best, bestScore, group, duplicates: group.duplicates.length });
          
          // Update progress
          matchProgress.set(userId, { current: idx + 1, total: groups.length, results: null, done: false, error: null });
          
          await new Promise(r => setTimeout(r, 150));
        }
        
        // Oblicz próg
        const thresholds = [0.56, 0.50, 0.45, 0.40, 0.35, 0.30];
        let chosenThreshold = 0.30;
        for (const threshold of thresholds) {
          const matched = allResults.filter(r => r.best && r.bestScore >= threshold).length;
          if (matched / allResults.length >= 0.85) {
            chosenThreshold = threshold;
            break;
          }
        }
        
        // Przygotuj wyniki
        const out = [];
        for (const result of allResults) {
          const { best, bestScore, duplicates } = result;
          if (best && bestScore >= chosenThreshold) {
            out.push({
              spotifyId: best.id,
              spotifyUrl: best.external_urls?.spotify,
              name: best.name,
              artists: (best.artists || []).map(a => a.name).join(', '),
              score: Number(bestScore.toFixed(3)),
              duplicates,
              matched: true,
              isDuplicate: false
            });
          } else {
            out.push({ 
              spotifyId: null, spotifyUrl: null, name: null, artists: null, 
              score: Number(bestScore.toFixed(3)),
              duplicates, matched: false, isDuplicate: false
            });
          }
          for (let i = 0; i < duplicates; i++) {
            out.push({ spotifyId: null, spotifyUrl: null, name: null, artists: null, score: 0, duplicates: 0, matched: false, isDuplicate: true });
          }
        }
        
        // Zapisz wyniki
        matchProgress.set(userId, { current: groups.length, total: groups.length, results: { ok: true, results: out, threshold: chosenThreshold }, done: true, error: null });
        
        // Usuń po 5 minutach
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

// Nowy endpoint do sprawdzania progressu
app.get('/api/match/progress', requireAuth, async (req, res) => {
  const progress = matchProgress.get(req.user.id);
  if (!progress) {
    return res.json({ exists: false });
  }
  res.json({ exists: true, ...progress });
});

app.post('/api/match-stream', requireAuth, async (req, res) => {
  try {
    const { tracks = [] } = req.body || {};
    const userAccess = await getUserSpotifyAccessTokenByUserId(req.user.id);
    
    // Ustaw headers dla SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    const groups = groupDuplicates(tracks);
    const allResults = [];
    const total = groups.length;
    
    for (let idx = 0; idx < groups.length; idx++) {
      const group = groups[idx];
      const t = group.track;
      
      // ULEPSZONE: Wielowariantowe zapytania
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
      
      allResults.push({ best, bestScore, group, duplicates: group.duplicates.length });
      
      // Wyślij postęp do frontendu
      const progress = Math.round(((idx + 1) / total) * 100);
      res.write(`data: ${JSON.stringify({ type: 'progress', value: progress, current: idx + 1, total })}\n\n`);
      
      await new Promise(r => setTimeout(r, 150));
    }
    
    // Oblicz próg jak wcześniej
    const thresholds = [0.56, 0.50, 0.45, 0.40, 0.35, 0.30];
    let chosenThreshold = 0.30;
    for (const threshold of thresholds) {
      const matched = allResults.filter(r => r.best && r.bestScore >= threshold).length;
      if (matched / allResults.length >= 0.85) {
        chosenThreshold = threshold;
        break;
      }
    }
    
    // Przygotuj wyniki
    const out = [];
    for (const result of allResults) {
      const { best, bestScore, duplicates } = result;
      if (best && bestScore >= chosenThreshold) {
        out.push({
          spotifyId: best.id,
          spotifyUrl: best.external_urls?.spotify,
          name: best.name,
          artists: (best.artists || []).map(a => a.name).join(', '),
          score: Number(bestScore.toFixed(3)),
          duplicates,
          matched: true,
          isDuplicate: false
        });
      } else {
        out.push({ 
          spotifyId: null, spotifyUrl: null, name: null, artists: null, 
          score: Number(bestScore.toFixed(3)),
          duplicates, matched: false, isDuplicate: false
        });
      }
      for (let i = 0; i < duplicates; i++) {
        out.push({ spotifyId: null, spotifyUrl: null, name: null, artists: null, score: 0, duplicates: 0, matched: false, isDuplicate: true });
      }
    }
    
    // Wyślij końcowe wyniki
    res.write(`data: ${JSON.stringify({ type: 'complete', results: out, threshold: chosenThreshold })}\n\n`);
    res.end();
    
  } catch (e) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: String(e) })}\n\n`);
    res.end();
  }
});

app.post('/api/playlist', requireAuth, async (req, res) => {
  try {
    const { name = PLAYLIST_NAME, trackUris = [] } = req.body || {};
    if (!Array.isArray(trackUris) || trackUris.length === 0) {
      return res.status(400).json({ ok: false, error: 'Brak trackUris' });
    }

    const userAccess = await getUserSpotifyAccessTokenByUserId(req.user.id);
    const me = await getSpotifyMe(userAccess);
    const userId = me.id;

    let r = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userAccess}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, public: false, description: 'Imported by ReLink' }),
    });
    let pj = await r.json();
    if (!r.ok) throw new Error(`create playlist: ${r.status} ${JSON.stringify(pj)}`);

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

app.listen(PORT, () => {
  console.log(`🚀 ReLink API on http://localhost:${PORT}`);
  console.log('📡 CORS_ORIGIN:', CORS_ORIGIN || '(*)');
  console.log('💾 USER_LINKS_TABLE:', USER_LINKS_TABLE);
});