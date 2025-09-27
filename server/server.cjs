// Minimal Express backend for ReLink MVP (CORS fixed for Netlify)
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '20mb' }));

// ==== CORS (ważne!) ====
// Podaj dokładny adres Twojego frontu na Netlify:
const NETLIFY_ORIGIN = 'https://stupendous-marshmallow-e107a7.netlify.app';

app.use(
  cors({
    origin: [NETLIFY_ORIGIN],            // dozwolony origin (Netlify)
    methods: ['GET', 'POST', 'OPTIONS'], // jakich metod używasz
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Preflight dla wszystkich ścieżek
app.options('*', cors());

// ===== ENV =====
const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN,
  PLAYLIST_NAME = 'ReLink Import',
  PORT = 5174,
} = process.env;

// ===== Token cache =====
let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (accessToken && now < tokenExpiresAt - 30_000) return accessToken;

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
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

// ===== Matching helpers =====
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
function normArtist(a) {
  return (a || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
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

// ===== Routes =====
app.get('/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/api/match', async (req, res) => {
  try {
    const { tracks = [], minScore = 0.58 } = req.body;
    const results = [];

    for (const t of tracks) {
      const q = [coreTitle(t.title), t.artist ? ` artist:${t.artist}` : ''].join(' ').trim();
      const items = await spotifySearch(q, 5);

      let best = null;
      let bestScore = 0;
      for (const it of items) {
        const s = scoreCandidate(t, it);
        if (s > bestScore) {
          bestScore = s;
          best = it;
        }
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

      // throttling żeby uniknąć 429
      await new Promise(r => setTimeout(r, 120));
    }

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

async function getUserId() {
  const token = await getAccessToken();
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`me error: ${res.status} ${JSON.stringify(j)}`);
  return j.id;
}

app.post('/api/playlist', async (req, res) => {
  try {
    const { title = PLAYLIST_NAME, matched = [], trackUris } = req.body;

    // Obsłuż oba formaty payloadu:
    const ids = Array.isArray(trackUris) && trackUris.length
      ? trackUris.map(u => u.replace('spotify:track:', ''))
      : matched.map(x => x.spotifyId).filter(Boolean);

    if (!ids.length) return res.json({ ok: false, error: 'Brak dopasowań do dodania.' });

    const token = await getAccessToken();
    const userId = await getUserId();

    // create playlist
    let r = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: title, public: false, description: 'Imported by ReLink' }),
    });
    let pj = await r.json();
    if (!r.ok) throw new Error(`create playlist: ${r.status} ${JSON.stringify(pj)}`);

    // add tracks in chunks of 100
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100).map(id => `spotify:track:${id}`);
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

// ===== Start =====
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
