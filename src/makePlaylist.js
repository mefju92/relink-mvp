// src/makePlaylist.cjs
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const SpotifyWebApi = require('spotify-web-api-node');
require('dotenv').config();

const api = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});

// 1) Jeśli nie masz REFRESH_TOKEN -> pokaż URL autoryzacji i zakończ proces
if (!process.env.SPOTIFY_REFRESH_TOKEN) {
  const scopes = ['playlist-modify-private', 'playlist-modify-public'];
  const url = api.createAuthorizeURL(scopes, 'state');
  console.log('Otwórz w przeglądarce i zaloguj się:\n', url);
  console.log('\nPo autoryzacji uruchom:\n');
  console.log('node src/makePlaylist.cjs CODE=<tu-kod-z-parametru-?code=> FILE=export/matches_filtered.csv NAME="Relink import" PUBLIC=false');
  process.exit(0);
}

// 2) Jeśli przekazano CODE=..., wymień na refresh token i wypisz co dodać do .env
const codeArg = process.argv.find(a => a.startsWith('CODE='));
if (codeArg) {
  const code = codeArg.split('=')[1];
  api.authorizationCodeGrant(code).then(({ body }) => {
    console.log('ACCESS_TOKEN:', body.access_token);
    console.log('REFRESH_TOKEN (dodaj do .env):', body.refresh_token);
    console.log('\nDopisz do .env:\nSPOTIFY_REFRESH_TOKEN=' + body.refresh_token);
    process.exit(0);
  }).catch((e) => {
    console.error('Błąd wymiany CODE -> tokens:', e?.body || e);
    process.exit(1);
  });
} else {
  // 3) Mamy refresh token – twórz playlistę
  (async () => {
    try {
      api.setRefreshToken(process.env.SPOTIFY_REFRESH_TOKEN);

      const FILE = (process.argv.find(a=>a.startsWith('FILE=')) || 'FILE=export/matches_filtered.csv').split('=')[1];
      const NAME = (process.argv.find(a=>a.startsWith('NAME=')) || 'NAME=Relink import').split('=')[1];
      const PUBLIC = (process.argv.find(a=>a.startsWith('PUBLIC=')) || 'PUBLIC=false').split('=')[1] === 'true';

      const csv = fs.readFileSync(FILE, 'utf8');
      const rows = parse(csv, { columns: true, skip_empty_lines: true });
      const uris = rows.map(r => `spotify:track:${r.spotify_track_id}`).filter(Boolean);

      const { body: token } = await api.refreshAccessToken();
      api.setAccessToken(token.access_token);
      const { body: me } = await api.getMe();
      const { body: pl } = await api.createPlaylist(me.id, NAME, { public: PUBLIC, description: 'Relink import' });

      for (let i = 0; i < uris.length; i += 100) {
        await api.addTracksToPlaylist(pl.id, uris.slice(i, i + 100));
      }
      console.log(`Utworzono playlistę: ${NAME}  (utwory: ${uris.length})`);
    } catch (e) {
      console.error('Błąd tworzenia playlisty:', e?.body || e);
      process.exit(1);
    }
  })();
}
