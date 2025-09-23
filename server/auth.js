// server/auth.js
require('dotenv').config();
const express = require('express');
const open = require('node:child_process').spawn;

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  AUTH_PORT = 8888,
} = process.env;

const REDIRECT_URI = `http://127.0.0.1:${AUTH_PORT}/callback`;
const SCOPES = [
  'playlist-modify-private',
  'playlist-modify-public',
  'user-read-email',
  'user-read-private',
].join(' ');

const app = express();

app.get('/login', (_req, res) => {
  const url = new URL('https://accounts.spotify.com/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('state', Math.random().toString(36).slice(2));
  res.redirect(url.toString());
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('State mismatch lub brak code.');

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
      redirect_uri: REDIRECT_URI,
    }),
  });
  const j = await r.json();

  if (!r.ok) {
    return res
      .status(r.status)
      .type('text')
      .send(`❌ Błąd token exchange:\n\n${JSON.stringify(j, null, 2)}`);
  }

  // pokaż refresh_token gotowy do wklejenia
  res
    .status(200)
    .type('text')
    .send(
`✅ Sukces — masz Refresh Token

Skopiuj do server/.env:
SPOTIFY_REFRESH_TOKEN=${j.refresh_token}

▶ Szczegóły (dla debug):
${JSON.stringify(j, null, 2)}

Możesz zamknąć to okno i zatrzymać skrypt (Ctrl+C).`
    );
});

app.listen(Number(AUTH_PORT), () => {
  console.log(`Auth helper działa na http://127.0.0.1:${AUTH_PORT}/login`);
  // próbuj otworzyć przeglądarkę
  const cmd = process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', `http://127.0.0.1:${AUTH_PORT}/login`] : [`http://127.0.0.1:${AUTH_PORT}/login`];
  open(cmd, args, { stdio: 'ignore', detached: true });
});
