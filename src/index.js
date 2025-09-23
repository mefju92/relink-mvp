import 'dotenv/config';
import { ensureDirs } from './util.js';
import { scanCommand } from './scan.js';
import { matchCommand, playlistCommand } from './spotify.js';

const [,, cmd, ...args] = process.argv;

await ensureDirs();

if (!cmd || cmd === 'help') {
  console.log(`
ReLink CLI — komendy:
  scan <folder>        — skanuje folder i zapisuje export/tracks.csv
  match                — (TODO) dopasowuje do Spotify i zapisuje export/matches.csv
  playlist             — (TODO) tworzy playlistę na Spotify z dopasowań
`);
  process.exit(0);
}

if (cmd === 'scan') {
  const folder = args[0];
  if (!folder) {
    console.error('Użycie: node src/index.js scan "/ścieżka/do/muzyki"');
    process.exit(1);
  }
  await scanCommand(folder);
  process.exit(0);
}

if (cmd === 'match') {
  await matchCommand();
  process.exit(0);
}

if (cmd === 'playlist') {
  await playlistCommand();
  process.exit(0);
}

console.error('Nieznana komenda. Użyj: scan | match | playlist');
process.exit(1);
