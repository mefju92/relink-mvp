// ReLink API (Express 5) — CORS fixed for Express v5
require('dotenv').config();
const express = require('express');
const cors = require('cors');

// ---- ENV ----
const {
  PORT = 5174,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  PLAYLIST_NAME = 'ReLink Import',
} = process.env;

// ---- CORS (Express 5) ----
// Uwaga: w Express 5 nie używamy '*' jako ścieżki — musi być '(.*)'
const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://localhost:5174',
  'https://stupendous-marshmallow-e107a7.netlify.app', // Twój front na Netlify
]);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // np. curl / ping
    cb(null, allowedOrigins.has(origin));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
};

const app = express();
app.use(cors(corsOptions));
app.options('(.*)', cors(corsOptions)); // <— to wywalało się na '*' w Express 5
app.use(express.json({ limit: '20mb' }));

// ---- Log startu ----
console.log('=== ReLink API start ===');
console.log({
  PORT,
  hasSpotifyId: !!SPOTIFY_CLIENT_ID,
  hasSpotifySecret: !!SPOTIFY_CLIENT_SECRET,
});

// ---- /ping ----
app.get('/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ===================================================================
//                          /api/match (MVP)
// ===================================================================

// proste czyszczenie tytułów
function coreTitle(s = '') {
  return s
    .toLowerCase()
    .replace(/\s+\(feat\..*?\)|\s+feat\..*$/g, '')
    .replace(/\s+-\s+live.*$|\s+\(live.*\)$/g, '')
    .replace(/\s+\(remaster.*\)|\s+-\s+remaster.*$/g, '')
    .replace(/\bofficial\s+video\b|\bhd\b|\bhq\b|\blyrics?\b/gi, '')
    .replace(/[\[\]\(\)]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normArtist(a = '') {
  return a.toLowerCase().replace(/\s+/g, ' ').trim();
}

function jaccard(a, b) {
  const A = new Set(a.split(' '));
  const B = new Set(b.split(' '));
  const I = [...A].filter((x) => B.has(x)).length;
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
  const aSp = normArtist((sp.artists || []).map((x) => x.name).join(' & '));

  const titleScore = jaccard(tLocal, tSp);
  const artistScore = aLocal ? jaccard(aLocal, aSp) : 0.5;
  const durScore = durationScore(local.durationMs, sp.duration_ms);

  return 0.5 * titleScore + 0.35 * artistScore + 0.15 * durScore;
}

// token aplikacyjny (client_credentials) do wyszukiwania
let appToken = null;
let appTokenExp = 0;

async function getAppToken() {
  const now = Date.now();
  if (appToken && now < appTokenExp - 30_000) return appToken;

  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:
        'Basic ' +
        Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'token error');

  appToken = j.access_token;
  appTokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  return a
