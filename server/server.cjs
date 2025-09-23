// server/server.cjs
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '20mb' }));

// ── ENV ───────────────────────────────────────────────────────────────────────
const {
  PORT = 5174,

  // Spotify
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN,
  PLAYLIST_NAME,

  // Supabase
  SUPABASE_URL,
  SUPABASE_BUCKET = 'audio',

  // Debug
  DEBUG_MATCH = '0',
} = process.env;

// Akceptuj obie nazwy dla klucza (żeby nie zablokować się literówką)
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

console.log('=== ReLink API start ===');
console.log('Port:', PORT);
console.log('Spotify:', {
  hasClientId: !!SPOTIFY_CLIENT_ID,
  hasClientSecret: !!SPOTIFY_CLIENT_SECRET,
  hasRefresh: !!SPOTIFY_REFRESH_TOKEN,
});
console.log('Supabase:', {
  urlPresent: !!SUPABASE_URL,
  keyPresent: !!SUPABASE_SERVICE_ROLE_KEY,
  bucket: SUPABASE_BUCKET,
});

// ── Supabase client ───────────────────────────────────────────────────────────
let sb = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  console.log('🟢 Supabase OK — klient utworzony.');
} else {
  console.warn('🔴 Supabase nie skonfigurowany — brak URL lub SERVICE ROLE KEY.');
}

// helper: upewnij się, że bucket istnieje (jeśli nie, utwórz publiczny)
async function ensureBucketExists() {
  if (!sb) return;
  try {
    const { data: buckets, error: listErr } = await sb.storage.listBuckets();
    if (listErr) throw listErr;
    const exists = (buckets || []).some(b => b.name === SUPABASE_BUCKET);
    if (!exists) {
      console.log(`ℹ️  Tworzę bucket "${SUPABASE_BUCKET}" (public: true)…`);
      const { error: createErr } = await sb.storage.createBucket(SUPABASE_BUCKET, {
        public: true,
      });
      if (createErr) throw createErr;
      console.log(`✅ Utworzono bucket "${SUPABASE_BUCKET}".`);
    }
  } catch (e) {
    console.warn('⚠️  ensureBucketExists error:', e.message || String(e));
  }
}

// Multer (w pamięci)
const upload = multer({ storage: multer.memoryStorage() });

// ── Strona info + health ─────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(`<pre>ReLink API ✅

GET  /ping                     → zdrowie serwera
POST /api/match                → dopasuj listę utworów do Spotify
POST /api/playlist             → utwórz playlistę i dodaj dopasowania
POST /api/upload               → wgraj zaznaczone pliki do chmury (Supabase)
GET  /cloud/list               → lista plików użytkownika w chmurze (Supabase)

Frontend (Vite): http://localhost:5173
</pre>`);
});
app.get('/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── Spotify helpers ──────────────────────────────────────────────────────────
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
  if (!res.ok) throw new Error(`token error: ${res.status} ${JSON.stringify(json)}`);
  accessToken = json.access_token;
  tokenExpiresAt = Date.now() + (json.expires_in || 3600) * 1000;
  return accessToken;
}

function coreTitle(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+\(feat\..*?\)|\s+feat\..*$/g, '')
    .replace(/\s+-\s+live.*$|\s+\(live.*\)$/g, '')
    .replace(/\s+\(remaster.*\)|\s+-\s+remaster.*$/g, '')
    .replace(/\b(official\s+music\s+video|official\s+video|lyrics?|visualizer|audio|hd|hq|4k)\b/gi, '')
    .replace(/\s*\(\s*(official|lyrics?|audio|video|remaster(?:ed)?|live|mix|edit)[^)]*\)\s*/gi, ' ')
    .replace(/\s*\[\s*(official|lyrics?|audio|video|remaster(?:ed)?|live|mix|edit)[^\]]*\]\s*/gi, ' ')
    .replace(/[\[\]\(\)]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function normArtist(a) { return (a || '').toLowerCase().replace(/\band\b/g, '&').replace(/\s{2,}/g, ' ').trim(); }
function jaccard(a, b) {
  const A = new Set(String(a).split(' ').filter(Boolean));
  const B = new Set(String(b).split(' ').filter(Boolean));
  const I = [...A].filter((x) => B.has(x)).length;
  const U = new Set([...A, ...B]).size || 1;
  return I / U;
}
function durationScore(localMs, spMs) {
  if (!localMs || !spMs) return 0.55;
  const d = Math.abs(localMs - spMs);
  if (d <= 1000) return 1;
  if (d <= 3000) return 0.92;
  if (d <= 5000) return 0.85;
  if (d <= 8000) return 0.7;
  if (d <= 12000) return 0.55;
  return 0.35;
}
function scoreCandidate(local, sp) {
  const tLocal = coreTitle(local.title);
  const tSp = coreTitle(sp.name);
  const aLocal = normArtist(local.artist || '');
  const aSp = normArtist((sp.artists || []).map((x) => x.name).join(' & '));
  const titleScore = jaccard(tLocal, tSp);
  const artistScore = aLocal ? jaccard(aLocal, aSp) : 0.5;
  const durScore = durationScore(local.durationMs, sp.duration_ms);
  const total = 0.52 * titleScore + 0.33 * artistScore + 0.15 * durScore;
  return { total, titleScore, artistScore, durScore };
}
async function spotifySearch(q, limit = 7) {
  const token = await getAccessToken();
  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'track');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('market', 'from_token');
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(`search error ${res.status}: ${JSON.stringify(json)}`);
  return json.tracks?.items || [];
}
async function spotifyMe() {
  const token = await getAccessToken();
  const res = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${token}` } });
  const j = await res.json();
  if (!res.ok) throw new Error(`me error: ${res.status} ${JSON.stringify(j)}`);
  return j.id;
}

// ── API: dopasowanie ──────────────────────────────────────────────────────────
app.post('/api/match', async (req, res) => {
  try {
    const { tracks = [], minScore = 0.56 } = req.body;
    if (!Array.isArray(tracks)) return res.status(400).json({ ok: false, error: 'tracks[] required' });

    const results = [];
    for (const t of tracks) {
      const title = coreTitle(t.title);
      const artist = normArtist(t.artist || '');
      const queries = [];
      if (title && artist) {
        queries.push(`track:"${title}" artist:"${artist}"`);
        queries.push(`${title} artist:${artist}`);
      }
      if (title) { queries.push(`"${title}"`); queries.push(title); }
      if (artist) queries.push(artist);

      let best = null, bestScore = 0;
      for (const q of queries) {
        const items = await spotifySearch(q, 7);
        for (const it of items) {
          const s = scoreCandidate(t, it);
          if (s.total > bestScore) { bestScore = s.total; best = it; }
        }
        await new Promise(r => setTimeout(r, 100));
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
    }
    res.json({ ok: true, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── API: playlist ─────────────────────────────────────────────────────────────
app.post('/api/playlist', async (req, res) => {
  try {
    const { title = PLAYLIST_NAME, matched = [] } = req.body;
    const ids = matched.map(x => x.spotifyId).filter(Boolean);
    if (!ids.length) return res.json({ ok: false, error: 'Brak dopasowań do dodania.' });

    const token = await getAccessToken();
    const userId = await spotifyMe();

    let r = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: title, public: false, description: 'Imported by ReLink' }),
    });
    let pj = await r.json();
    if (!r.ok) throw new Error(`create playlist: ${r.status} ${JSON.stringify(pj)}`);

    for (let i = 0; i < ids.length; i += 100) {
      const uris = ids.slice(i, i + 100).map(id => `spotify:track:${id}`);
      r = await fetch(`https://api.spotify.com/v1/playlists/${pj.id}/tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris }),
      });
      const aj = await r.json();
      if (!r.ok) throw new Error(`add tracks: ${r.status} ${JSON.stringify(aj)}`);
      await new Promise(r => setTimeout(r, 150));
    }
    res.json({ ok: true, playlistId: pj.id, playlistUrl: pj.external_urls?.spotify });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── API: upload do Supabase ───────────────────────────────────────────────────
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    if (!sb) return res.status(500).json({ ok: false, error: 'Supabase nie skonfigurowany' });
    await ensureBucketExists();

    const userId = 'demo-user'; // TODO: prawdziwe ID po auth
    const files = req.files || [];
    const out = [];

    for (const f of files) {
      const key = `${userId}/${f.originalname}`;
      const { error } = await sb.storage.from(SUPABASE_BUCKET).upload(key, f.buffer, {
        upsert: true,
        contentType: f.mimetype || 'application/octet-stream',
      });
      if (error) {
        console.error('Upload error:', error.message);
        out.push({ name: f.originalname, ok: false, error: error.message });
        continue;
      }
      const { data } = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(key);
      out.push({ name: f.originalname, ok: true, url: data.publicUrl });
    }
    res.json({ ok: true, files: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── API: lista plików (Supabase) ──────────────────────────────────────────────
app.get('/cloud/list', async (_req, res) => {
  try {
    if (!sb) return res.status(500).json({ ok: false, error: 'Supabase nie skonfigurowany' });
    await ensureBucketExists();

    const userId = 'demo-user';
    const { data, error } = await sb.storage.from(SUPABASE_BUCKET).list(userId, {
      limit: 1000,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    const files = (data || []).map((e) => {
      const key = `${userId}/${e.name}`;
      const { data } = sb.storage.from(SUPABASE_BUCKET).getPublicUrl(key);
      return { name: e.name, url: data.publicUrl, size: e.metadata?.size ?? null };
    });
    res.json({ ok: true, files });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`API on http://localhost:${PORT}`);
  // spróbuj od razu utworzyć bucket, żeby później nie brzęczał
  await ensureBucketExists();
});
