// server/server.cjs
require('dotenv').config();
const express = require('express');
const multer = require('multer');

// node-fetch v3 (ESM)
const fetch = (...a) => import('node-fetch').then(({ default: f }) => f(...a));

// === ENV ===
const {
  PORT = 5174,
  CORS_ORIGIN,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN, // używane do wyszukiwania (token aplikacyjny)
  PLAYLIST_NAME = 'ReLink Import',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_BUCKET = 'music',
  USER_LINKS_TABLE = 'user_links', // mapa: user_id -> spotify_*
} = process.env;

// === App ===
const app = express();

// CORS
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

// === Supabase (service role) ===
const { createClient } = require('@supabase/supabase-js');
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// === Spotify: token aplikacyjny (z globalnego refresh tokena) ===
let accessToken = null;
let tokenExpiresAt = 0;

async function getAppAccessToken() {
  const now = Date.now();
  if (accessToken && now < tokenExpiresAt - 30_000) return accessToken;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(`token error: ${res.status} ${JSON.stringify(json)}`);
  accessToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;
  return accessToken;
}

// === USER TOKEN (tworzenie playlist u UŻYTKOWNIKA) ===
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
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    const e = new Error(`REFRESH_FAILED ${r.status}: ${JSON.stringify(j)}`);
    e.code = 'REFRESH_FAILED';
    e.details = j;
    throw e;
  }
  return j.access_token; // access token użytkownika
}

async function getSpotifyMe(accessToken) {
  const r = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`me error: ${r.status} ${JSON.stringify(j)}`);
  return j; // {id, display_name, ...}
}

// === Dopasowanie / scoring ===
function coreTitle(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+\(feat\..*?\)|\s+feat\..*$/g, '')
    .replace(/\s+-\s+live.*$|\s+\(live.*\)$/g, '')
    .replace(/\s+\(remaster.*\)|\s+-\s+remaster.*$/g, '')
    .replace(/\bofficial\s+video\b|\bhd\b|\bhq\b|\blyrics?\b/gi, '')
    .replace(/[\[\]\(\)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normArtist(a) { return (a || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function jaccard(a, b) {
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  const I = new Set([...A].filter(x => B.has(x))).size;
  const U = new Set([...A, ...B]).size || 1;
  return I / U;
}
function durationScore(localMs, spMs) {
  if (!localMs || !spMs) return 0.5;
  const diff = Math.abs(localMs - spMs);
  if (diff <= 1000) return 1;
  if (diff <= 3000) return 0.9;
  if (diff <= 5000) return 0.8;
  if (diff <= 8000) return 0.65;
  if (diff <= 12000) return 0.5;
  return 0.3;
}
function scoreCandidate(local, sp) {
  const tLocal = coreTitle(local.title);
  const tSp = coreTitle(sp.name);
  const aLocal = normArtist(local.artist || '');
  theArtists = (sp.artists || []).map(x => x.name).join(' & ');
  const aSp = normArtist(theArtists);
  const titleScore = jaccard(tLocal, tSp);
  const artistScore = aLocal ? jaccard(aLocal, aSp) : 0.5;
  const durScore = durationScore(local.durationMs, sp.duration_ms);
  return 0.5 * titleScore + 0.35 * artistScore + 0.15 * durScore;
}
async function spotifySearch(q, limit = 5) {
  const token = await getAppAccessToken();
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'track');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`search error ${res.status}: ${JSON.stringify(json)}`);
  return json.tracks?.items || [];
}

// === Auth helper (front przekazuje Bearer: <JWT z Supabase>) ===
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'missing token' });
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ ok: false, error: 'invalid token' });
  req.user = data.user;
  next();
}

// === ROUTES ===
app.get('/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now(), base: getBaseUrl(req) });
});


// 1) START OAuth – pełny flow (autoryzacja z sekretem po stronie backendu)
app.get('/spotify/login', (req, res) => {
  // frontend może być podany jako origin (bez /app) – dopnijmy /app tylko raz
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


// 2) CALLBACK Spotify – zapisujemy refresh_token + display_name
app.get('/spotify/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    const parsed = (() => { try { return JSON.parse(Buffer.from(state || '', 'base64url').toString()) } catch { return {} } })();
    const frontend = (parsed.f || CORS_ORIGIN || '/').replace(/\/$/, '');
    const jwt = parsed.jwt || null;

    if (error) return res.redirect(`${frontend}?spotify=error&reason=${encodeURIComponent(error)}`);
    if (!code) return res.status(400).send('<pre>Brak ?code z Spotify</pre>');

    const redirect_uri = `${getBaseUrl(req)}/spotify/callback`;

    // wymiana code -> tokeny
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

    // pobierz profil użytkownika
    let spName = null, spUserId = null;
    if (access) {
      const meRes = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${access}` } });
      const me = await meRes.json();
      if (meRes.ok) { spUserId = me.id || null; spName = me.display_name || me.id || null; }
    }

    // zapisz w Supabase (mapowanie)
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

    // UWAGA: nie dopinamy /app drugi raz – frontend już je ma w state.f
    const back = `${frontend}?spotify=ok`;
    res.send(`<!doctype html><meta charset="utf-8">
      <style>body{font-family:system-ui;padding:24px}</style>
      <h3>Połączono ze Spotify ✅</h3>
      ${spName ? `<p>Konto: <b>${spName}</b></p>` : ''}
      <p>Za chwilę wrócisz do aplikacji…</p>
      <script>setTimeout(()=>location.href=${JSON.stringify(back)}, 900)</script>`);
  } catch (e) {
    res.status(500).send(`<pre>${String(e)}</pre>`);
  }
});



// 3) Status połączenia (front pokaże nazwę)
app.get('/api/spotify/status', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supa
      .from(USER_LINKS_TABLE)
      .select('spotify_display_name')
      .eq('user_id', req.user.id)
      .maybeSingle();

    // jeżeli tabela nie istnieje – nie wywalaj 500, tylko pokaż "disconnected"
    if (error && (error.code === '42P01' || error.message?.includes('relation'))) {
      return res.json({ ok: true, connected: false, name: null, hint: 'table_missing' });
    }
    if (error && error.code !== 'PGRST116') throw error;

    res.json({ ok: true, connected: !!data, name: data?.spotify_display_name || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});


// 4) Dopasowanie (wyszukiwanie: token aplikacyjny)
app.post('/api/match', requireAuth, async (req, res) => {
  try {
    const { minScore = 0.58, tracks = [] } = req.body || {};
    const out = [];
    for (const t of tracks) {
      const q = [t.title, t.artist].filter(Boolean).join(' ');
      const items = await spotifySearch(q, 5);
      let best = null, bestScore = -1;
      for (const it of items) {
        const s = scoreCandidate(t, it);
        if (s > bestScore) { best = it; bestScore = s; }
      }
      if (best && bestScore >= minScore) {
        out.push({
          spotifyId: best.id,
          spotifyUrl: best.external_urls?.spotify,
          name: best.name,
          artists: (best.artists || []).map(a => a.name).join(', '),
          score: Number(bestScore.toFixed(3)),
        });
      } else {
        out.push({ spotifyId: null, spotifyUrl: null, name: null, artists: null, score: Number(bestScore.toFixed(3)) });
      }
    }
    res.json({ ok: true, results: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 5) Tworzenie playlisty U ŻYTKOWNIKA (token z jego refresh_token)
app.post('/api/playlist', requireAuth, async (req, res) => {
  try {
    const { name = PLAYLIST_NAME, trackUris = [] } = req.body || {};
    if (!Array.isArray(trackUris) || trackUris.length === 0) {
      return res.status(400).json({ ok: false, error: 'Brak trackUris' });
    }

    // access token należący do aktualnego użytkownika
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

    // add tracks in chunks
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

// 6) Chmura: Supabase Storage
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
        contentType: file.mimetype, upsert: true,
      });
      return { name: file.originalname, ok: !error, error: error?.message };
    }));
    res.json({ ok: true, files: results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// start
app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
  console.log('CORS_ORIGIN:', CORS_ORIGIN || '(*)');
  console.log('USER_LINKS_TABLE:', USER_LINKS_TABLE);
});
