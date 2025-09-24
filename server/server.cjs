// server/server.cjs
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ----- ENV -----
const {
  PORT = 5174,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  PLAYLIST_NAME = 'ReLink Import',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_BUCKET = 'audio',
  FRONTEND_URL = 'http://localhost:5173',
  // Na Render ustaw na: https://<twoja-usługa>.onrender.com/spotify/callback
  SPOTIFY_REDIRECT_URI = 'http://localhost:5174/spotify/callback',
} = process.env;

// ----- Supabase admin client (SERVICE KEY!) -----
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ----- Express -----
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));

// ===== Pomocnicze =====

// wyciągnięcie zalogowanego usera z Bearer: <supabase_jwt>
async function getUserFromBearer(req) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error) return null;
    return data.user || null;
  } catch {
    return null;
  }
}

// pobranie rekordu z tabeli user_spotify_tokens
async function getUserSpotifyRow(userId) {
  const { data, error } = await supabaseAdmin
    .from('user_spotify_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error) return null;
  return data;
}

// odświeżenie access_token jeśli wygasł
async function refreshSpotifyAccessToken(userId, row) {
  if (!row?.refresh_token) return null;

  const resp = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization':
        'Basic ' +
        Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    }),
  });

  const tok = await resp.json();
  if (!resp.ok) {
    throw new Error(tok.error_description || tok.error || 'Spotify refresh error');
  }

  const expires_at = Math.floor(Date.now() / 1000) + (tok.expires_in || 3600);
  const patch = {
    access_token: tok.access_token,
    expires_at,
    ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
  };

  const { error } = await supabaseAdmin
    .from('user_spotify_tokens')
    .update(patch)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);

  return patch.access_token;
}

async function ensureSpotifyAccessToken(userId) {
  const row = await getUserSpotifyRow(userId);
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  if (row.access_token && (row.expires_at || 0) > now + 60) {
    return row.access_token;
  }
  return await refreshSpotifyAccessToken(userId, row);
}

// prosty fetch do Spotify z obsługą błędów
async function spotifyFetch(accessToken, url, opts = {}) {
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body || undefined,
  });

  // 204 No Content (np. po dodaniu tracków)
  if (res.status === 204) return null;

  let data = null;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.error_description ||
      (await res.text().catch(() => '')) ||
      `HTTP ${res.status}`;
    throw new Error(`Spotify error: ${msg}`);
  }
  return data;
}

// ===== LOG startu =====
console.log('=== ReLink API start ===');
console.log('Port:', PORT);
console.log('Spotify:', {
  hasClientId: !!SPOTIFY_CLIENT_ID,
  hasClientSecret: !!SPOTIFY_CLIENT_SECRET,
});
console.log('Supabase:', {
  urlPresent: !!SUPABASE_URL,
  keyPresent: !!SUPABASE_SERVICE_ROLE_KEY,
  bucket: SUPABASE_BUCKET,
});
console.log('Frontend URL:', FRONTEND_URL);
console.log('Spotify Redirect URI:', SPOTIFY_REDIRECT_URI);

// ===== Proste endpointy =====
app.get('/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/', (_req, res) => {
  res.type('text/plain').send(
`ReLink API

GET  /ping            → zdrowie serwera
POST /api/bootstrap   → utwórz prywatny folder użytkownika (wymaga Bearer supabase)
GET  /cloud/list      → lista plików w chmurze (wymaga Bearer supabase)

Spotify per user:
GET  /spotify/login    → start OAuth
GET  /spotify/callback → zapis tokenów per user (SERVICE ROLE)

POST /api/playlist     → tworzenie playlisty na koncie użytkownika (per-user tokens)

Frontend: ${FRONTEND_URL}
`
  );
});

// ===== CHMURA (MVP) =====
app.post('/api/bootstrap', async (req, res) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const path = `user/${user.id}/.keep`;
    const file = new Blob(['ok'], { type: 'text/plain' });
    const { error } = await supabaseAdmin.storage
      .from(SUPABASE_BUCKET)
      .upload(path, file, { upsert: true });
    if (error && !String(error.message || '').includes('Duplicate')) {
      return res.status(500).json({ error: error.message });
    }
    return res.json({ ok: true, path });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

app.get('/cloud/list', async (req, res) => {
  const user = await getUserFromBearer(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const base = `user/${user.id}`;
    const { data, error } = await supabaseAdmin.storage
      .from(SUPABASE_BUCKET)
      .list(base, { limit: 100 });
    if (error) return res.status(500).json({ error: error.message });
    const files = (data || []).map(f => ({
      name: f.name,
      size: f.metadata?.size || 0,
      path: `${base}/${f.name}`,
    }));
    return res.json({ ok: true, files });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
});

// ===== SPOTIFY OAuth per user =====
const OAUTH_SCOPE = [
  'playlist-modify-private',
  'playlist-modify-public',
  'user-read-private',
  'user-read-email',
].join(' ');

const oauthStates = Object.create(null);

app.get('/spotify/login', async (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  const frontend = req.query.frontend || FRONTEND_URL;
  oauthStates[state] = { frontend, createdAt: Date.now() };

  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
  url.searchParams.set('scope', OAUTH_SCOPE);
  url.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/spotify/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const mem = oauthStates[state];
    if (!mem) return res.status(400).send('State mismatch lub wygasły.');
    delete oauthStates[state];

    // oczekujemy, że front wywoła callback z nagłówkiem Authorization: Bearer <supabase_jwt>
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return res.send(`<html><body style="font-family:system-ui;padding:20px">
        <h3>Połączenie Spotify</h3>
        <p>Brak sesji użytkownika. Wróć do aplikacji i spróbuj ponownie po zalogowaniu.</p>
        <a href="${mem.frontend}">Wróć do aplikacji</a>
      </body></html>`);
    }

    const { data } = await supabaseAdmin.auth.getUser(token);
    const user = data?.user || null;
    if (!user) {
      return res.send(`<html><body style="font-family:system-ui;padding:20px">
        <h3>Połączenie Spotify</h3>
        <p>Brak użytkownika. Zaloguj się w aplikacji i spróbuj ponownie.</p>
        <a href="${mem.frontend}">Wróć do aplikacji</a>
      </body></html>`);
    }

    // wymiana code -> tokeny
    const tokenResp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization':
          'Basic ' +
          Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
      }),
    });

    const tok = await tokenResp.json();
    if (!tokenResp.ok) {
      return res.status(400).send('Błąd token exchange: ' + (tok.error_description || tok.error || ''));
    }

    const expires_at = Math.floor(Date.now() / 1000) + (tok.expires_in || 3600);
    const upsert = {
      user_id: user.id,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      scope: tok.scope || OAUTH_SCOPE,
      expires_at,
    };

    const { error } = await supabaseAdmin
      .from('user_spotify_tokens')
      .upsert(upsert, { onConflict: 'user_id' });

    if (error) {
      return res.status(500).send('Błąd zapisu tokenów: ' + error.message);
    }

    return res.send(`<html><body style="font-family:system-ui;padding:20px">
      <h3>Połączenie Spotify aktywne ✅</h3>
      <p>Możesz wrócić do aplikacji.</p>
      <a href="${mem.frontend}/app">Otwórz importera</a>
    </body></html>`);
  } catch (e) {
    return res.status(500).send('Błąd: ' + String(e));
  }
});

// ===== Tworzenie playlisty na koncie użytkownika (per-user tokens) =====
app.post('/api/playlist', async (req, res) => {
  try {
    const user = await getUserFromBearer(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const { name = PLAYLIST_NAME, trackUris = [] } = req.body || {};
    if (!Array.isArray(trackUris) || trackUris.length === 0) {
      return res.status(400).json({ error: 'Brak trackUris (spotify:track:...)' });
    }

    const accessToken = await ensureSpotifyAccessToken(user.id);
    if (!accessToken) {
      return res.status(400).json({ error: 'Brak połączenia Spotify. Użyj /spotify/login w aplikacji.' });
    }

    const me = await spotifyFetch(accessToken, 'https://api.spotify.com/v1/me');
    const userSpotifyId = me.id;

    const playlist = await spotifyFetch(
      accessToken,
      `https://api.spotify.com/v1/users/${encodeURIComponent(userSpotifyId)}/playlists`,
      {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: 'Playlist created by ReLink',
          public: false,
        }),
      }
    );

    const playlistId = playlist.id;
    const playlistUrl = playlist.external_urls?.spotify || null;

    // dodawanie po 100
    for (let i = 0; i < trackUris.length; i += 100) {
      const chunk = trackUris.slice(i, i + 100);
      await spotifyFetch(
        accessToken,
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        { method: 'POST', body: JSON.stringify({ uris: chunk }) }
      );
    }

    return res.json({ ok: true, playlistId, playlistUrl });
  } catch (e) {
    console.error('playlist error:', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// ----- Start -----
app.listen(PORT, () => {
  console.log(`API on http://localhost:${PORT}`);
});
