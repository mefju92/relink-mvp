// server/server.cjs
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
// node-fetch v3 (ESM) – ładujemy dynamicznie:
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const {
  PORT = 5174,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN,
  PLAYLIST_NAME = 'ReLink Import',
  // dla CORS ustaw na URL Netlify, np.
  // CORS_ORIGIN=https://stupendous-marshmallow-e107a7.netlify.app
  CORS_ORIGIN,
} = process.env;

const app = express();

/* ---------------- CORS (bez tras typu "*", zgodnie z Express 5) ---------------- */
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

/* ---------------- helpers ---------------- */
function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

/* ---------------- Spotify token (globalny – z refresh tokena) ---------------- */
let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (accessToken && now < tokenExpiresAt - 30_000) return accessToken;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`token error: ${res.status} ${JSON.stringify(json)}`);
  }
  accessToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;
  return accessToken;
}

/* ---------------- Dopasowanie / scoring ---------------- */
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
  const aSp = normArtist((sp.artists || []).map(x => x.name).join(' & '));
  const titleScore = jaccard(tLocal, tSp);
  const artistScore = aLocal ? jaccard(aLocal, aSp) : 0.5;
  const durScore = durationScore(local.durationMs, sp.duration_ms);
  return 0.5 * titleScore + 0.35 * artistScore + 0.15 * durScore;
}
async function spotifySearch(q, limit = 5) {
  const token = await getAccessToken();
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'track');
  url.searchParams.set('limit', String(limit));
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`search error ${res.status}: ${JSON.stringify(json)}`);
  return json.tracks?.items || [];
}
async function getUserId() {
  const token = await getAccessToken();
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`me error: ${res.status} ${JSON.stringify(j)}`);
  return j.id;
}

/* ---------------- ROUTES ---------------- */

app.get('/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// 1) START OAuth – albo szybki powrót, jeśli mamy już REFRESH TOKEN
app.get('/spotify/login', (req, res) => {
  const frontend = req.query.frontend || CORS_ORIGIN || '/';
  if (SPOTIFY_REFRESH_TOKEN) {
    // mamy stały refresh token – nie trzeba logować; wracamy do UI
    const url = `${frontend.replace(/\/$/, '')}/app?spotify=connected`;
    return res.redirect(302, url);
  }
  // pełny OAuth
  const redirect_uri = `${getBaseUrl(req)}/spotify/callback`;
  const scope = 'playlist-modify-private playlist-modify-public user-read-email';
  const state = Buffer.from(JSON.stringify({ f: frontend }), 'utf8').toString('base64url');
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

// 2) CALLBACK Spotify – wymiana code -> tokeny, wyświetlenie REFRESH TOKEN
app.get('/spotify/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    const frontend = (() => {
      try { return JSON.parse(Buffer.from(state || '', 'base64url').toString()).f; }
      catch { return CORS_ORIGIN || '/'; }
    })();

    if (error) {
      return res.redirect(`${frontend.replace(/\/$/, '')}/app?spotify=error&reason=${encodeURIComponent(error)}`);
    }
    if (!code) return res.status(400).send('<pre>Brak ?code z Spotify</pre>');

    const redirect_uri = `${getBaseUrl(req)}/spotify/callback`;
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      return res.status(400).send(`<pre>Token exchange failed ${r.status}\n${JSON.stringify(j, null, 2)}</pre>`);
    }

    const refresh = j.refresh_token;
    if (refresh) {
      console.log('=== SPOTIFY REFRESH TOKEN ===\n' + refresh + '\n============================');
    }

    const back = `${frontend.replace(/\/$/, '')}/app?spotify=ok`;
    res.send(`<!doctype html><meta charset="utf-8">
      <h3>Połączono z Spotify ✅</h3>
      ${refresh ? `<p><b>REFRESH_TOKEN:</b> <code>${refresh}</code></p>
      <p>Dodaj go w Render → Environment jako <code>SPOTIFY_REFRESH_TOKEN</code> i zdeployuj backend.</p>` : ''}
      <p>Za chwilę wrócisz do aplikacji…</p>
      <script>setTimeout(()=>location.href=${JSON.stringify(back)}, 1200)</script>`);
  } catch (e) {
    res.status(500).send(`<pre>${String(e)}</pre>`);
  }
});

// 3) Dopasowanie
app.post('/api/match', async (req, res) => {
  try {
    const { tracks = [], minScore = 0.58 } = req.body || {};
    const results = [];
    for (const t of tracks) {
      const artistQ = t.artist ? ` artist:"${t.artist}"` : '';
      const q = `${coreTitle(t.title)}${artistQ}`.trim();
      const items = await spotifySearch(q, 5);
      let best = null, bestScore = 0;
      for (const it of items) {
        const s = scoreCandidate(t, it);
        if (s > bestScore) { bestScore = s; best = it; }
      }
      if (best && bestScore >= minScore) {
        results.push({
          input: t,
          spotifyId: best.id,
          spotifyUrl: best.external_urls?.spotify,
          name: best.name,
          artists: best.artists?.map(a => a.name).join(', '),
          durationMs: best.duration_ms,
          score: Number(bestScore.toFixed(3)),
        });
      } else {
        results.push({ input: t, spotifyId: null, score: Number(bestScore.toFixed(3)) });
      }
      await new Promise(r => setTimeout(r, 120));
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 4) Tworzenie playlisty
// body: { name, trackUris: ["spotify:track:..."] }
app.post('/api/playlist', async (req, res) => {
  try {
    const { name = PLAYLIST_NAME, trackUris = [] } = req.body || {};
    if (!Array.isArray(trackUris) || trackUris.length === 0) {
      return res.status(400).json({ ok: false, error: 'Brak trackUris' });
    }
    const token = await getAccessToken();
    const userId = await getUserId();

    // create playlist
    let r = await fetch(`https://api.spotify.com/v1/users/${encodeURIComponent(userId)}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, public: false, description: 'Imported by ReLink' }),
    });
    let pj = await r.json();
    if (!r.ok) throw new Error(`create playlist: ${r.status} ${JSON.stringify(pj)}`);

    // add tracks in chunks of 100
    for (let i = 0; i < trackUris.length; i += 100) {
      const slice = trackUris.slice(i, i + 100);
      r = await fetch(`https://api.spotify.com/v1/playlists/${pj.id}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: slice }),
      });
      const aj = await r.json();
      if (!r.ok) throw new Error(`add tracks: ${r.status} ${JSON.stringify(aj)}`);
      await new Promise(r => setTimeout(r, 150));
    }

    res.json({ ok: true, playlistId: pj.id, playlistUrl: pj.external_urls?.spotify });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

/* ---------------- CHMURA: Supabase Storage ---------------- */
const { createClient } = require('@supabase/supabase-js');
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = process.env.SUPABASE_BUCKET || 'music';

// prosty auth na bearerze z Supabase (ten sam token, co masz w froncie)
async function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ ok: false, error: 'missing token' });
  const { data, error } = await supa.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ ok: false, error: 'invalid token' });
  req.user = data.user;
  next();
}

// LISTA plików w chmurze
async function listCloudHandler(req, res) {
  try {
    const prefix = `${req.user.id}/`;
    const { data: entries, error } = await supa.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) throw error;

    const files = await Promise.all((entries || []).map(async f => {
      const path = prefix + f.name;
      const { data: signed } = await supa.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      return { name: f.name, size: f.metadata?.size ?? f.size ?? 0, url: signed?.signedUrl };
    }));

    res.json({ ok: true, files });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}

// UPLOAD do chmury (multipart/form-data; pole: "files")
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

async function uploadCloudHandler(req, res) {
  try {
    const prefix = `${req.user.id}/`;
    const results = await Promise.all((req.files || []).map(async (file) => {
      const path = prefix + file.originalname;
      const { error } = await supa.storage.from(BUCKET).upload(path, file.buffer, {
        contentType: file.mimetype, upsert: true,
      });
      return { name: file.originalname, ok: !error, error: error?.message };
    }));
    res.json({ ok: true, files: results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
}

// Endpoints (i alias zgodny z frontem)
app.get('/api/cloud/list', requireAuth, listCloudHandler);
app.get('/cloud/list',     requireAuth, listCloudHandler);  // alias, by działało /cloud/list
app.post('/api/upload',    requireAuth, upload.array('files', 50), uploadCloudHandler);


/* ---------------- start ---------------- */
app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
  console.log('CORS_ORIGIN:', CORS_ORIGIN || '(*)');
});
