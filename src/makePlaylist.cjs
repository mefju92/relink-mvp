#!/usr/bin/env node
/* Budowanie playlisty ze zfiltrowanego CSV */
const fs = require('fs');
const minimist = require('minimist');
const { parse } = require('csv-parse/sync');
const SpotifyWebApi = require('spotify-web-api-node');
const { stringify } = require('csv-stringify/sync');
const { remove: stripDiacritics } = require('diacritics');
require('dotenv').config();

/* Pomocnicze – spójność z filtrowaniem (czysto kosmetycznie do logów) */
function stripPathPrefix(raw) {
  if (!raw) return '';
  return String(raw).replace(/^.*[\\/]/, '');
}
function norm(s) {
  if (!s) return '';
  return stripDiacritics(String(s))
    .replace(/[–—]/g, '-')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function coreTitle(raw) {
  if (!raw) return '';
  let s = stripPathPrefix(raw);
  s = norm(s);
  s = s.replace(/\s*[\(\[]\s*(official|lyrics?|audio|video|music video|mv|hd|hq|remaster(?:ed)?|visualizer|clip|radio edit|extended mix|full(?:\s+(?:track|version))?|original mix|live|out now|premiere|teaser|trailer)\s*[\)\]]/gi, '');
  s = s.replace(/\s*-\s*(official|lyrics?|audio|video|music video|mv|hd|hq|remaster(?:ed)?|visualizer|clip|radio edit|extended mix|full(?:\s+(?:track|version))?|original mix|live|out now|premiere|teaser|trailer|copy\s*\(\d+\))\b.*$/gi, '');
  s = s.replace(/\s*\[(?:hd|hq|official|lyrics?|audio|video|music video|mv)\]\s*$/i, '');
  s = s.replace(/\b(official|out now)\s*$/i, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/\s*-\s*$/, '');
  return s.trim();
}

/* Spotify init */
function newSpotifyClient() {
  const api = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
  });
  if (process.env.SPOTIFY_REFRESH_TOKEN) api.setRefreshToken(process.env.SPOTIFY_REFRESH_TOKEN);
  return api;
}
async function getAccessToken(api) {
  if (!process.env.SPOTIFY_REFRESH_TOKEN) throw new Error('Brak SPOTIFY_REFRESH_TOKEN w .env');
  const { body } = await api.refreshAccessToken();
  api.setAccessToken(body.access_token);
  return body.access_token;
}

/* Main */
async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['file', 'name'],
    boolean: ['public'],
    default: { file: 'export/matches_filtered.csv', name: 'Relink import', public: false },
  });

  const csv = fs.readFileSync(argv.file, 'utf8');
  const rows = parse(csv, { columns: true, skip_empty_lines: true });

  const trackIds = rows
    .map(r => r.spotify_track_id?.trim())
    .filter(Boolean);

  const api = newSpotifyClient();
  await getAccessToken(api);

  const me = await api.getMe();
  console.log(`Zalogowano jako: ${me?.body?.display_name || me?.body?.id || '???'}`);

  // Stwórz playlistę
  const pl = await api.createPlaylist(argv.name, {
    description: 'Imported by relink',
    public: Boolean(argv.public),
  });
  const playlistId = pl?.body?.id;
  if (!playlistId) throw new Error('Brak ID playlisty z API (createPlaylist)');

  console.log(`Utworzono playlistę: "${argv.name}" (${playlistId})`);

  // Dodaj w paczkach po 100
  let added = 0;
  for (let i = 0; i < trackIds.length; i += 100) {
    const chunk = trackIds.slice(i, i + 100).map(id => `spotify:track:${id}`);
    await api.addTracksToPlaylist(playlistId, chunk);
    added += chunk.length;
    console.log(`Dodano ${added}/${trackIds.length}...`);
  }

  console.log(`Gotowe ✅ Link: https://open.spotify.com/playlist/${playlistId}`);
}

main().catch(e => {
  console.error('Błąd tworzenia playlisty:', e);
  process.exit(1);
});
