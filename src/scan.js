import fg from 'fast-glob';
import mm from 'music-metadata';
import fs from 'fs';
import path from 'path';
import { toCsv } from './csv.js';

const exts = ['.mp3', '.flac', '.m4a', '.wav'];

// usuwa dopiski typu (Official Video), [OUT NOW], {Live}, itp.
function stripDecorations(s) {
  return s
    .replace(/\s*[\(\[\{](official.*?|lyric.*?|video.*?|audio.*?|teaser.*?|hd.*?|out now.*?|radio edit.*?|extended.*?|original mix.*?|remix.*?|live.*?|edit.*?|mix.*?|hq.*?)[\)\]\}]/gi, '')
    .replace(/\s*[-–—]\s*(official.*?|lyric.*?|video.*?|audio.*?|teaser.*?|hd.*?|out now.*?|radio edit.*?|extended.*?|original mix.*?|remix.*?|live.*?|edit.*?|mix.*?|hq.*?)$/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// proste wyciągnięcie artysty i tytułu z nazwy pliku
function parseFromFilename(filename) {
  // usuń rozszerzenie
  let base = filename.replace(/\.[^.]+$/, '');
  base = base.replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // często mamy "Artist - Title"
  let artist = '';
  let title = '';

  // weź ostatni segment po slashu (podfoldery jak Favorites/…)
  const parts = base.split(/[\\/]/);
  base = parts[parts.length - 1];

  // czasem w nazwie są przecinki i inne znaki – uprość
  base = stripDecorations(base);

  // warianty z " - "
  if (base.includes(' - ')) {
    const [left, ...rest] = base.split(' - ');
    artist = left;
    title = rest.join(' - ');
  } else {
    // fallback: niech cały base idzie w title
    title = base;
  }

  artist = artist.replace(/"/g, '').trim();
  title = title.replace(/"/g, '').trim();

  // dodatkowe czyszczenie „feat.” → nie usuwamy, bo bywa przydatne w wyszukiwaniu
  return { artist, title };
}

export async function scanCommand(root) {
  const pattern = exts.map(e => `**/*${e}`).concat(['**/*.{MP3,FLAC,M4A,WAV}']);
  const entries = await fg(pattern, { cwd: root, onlyFiles: true, dot: false });
  console.log(`Znaleziono ${entries.length} plików — czytam tagi...`);

  const rows = [];
  for (const rel of entries) {
    const full = path.join(root, rel);
    let title = '';
    let artist = '';
    let album = '';
    let year = '';
    let duration_ms = 0;

    try {
      const meta = await mm.parseFile(full, { duration: true });
      const common = meta.common || {};
      const format = meta.format || {};
      title = (common.title || '').trim();
      artist = (Array.isArray(common.artists) ? common.artists.join(', ') : (common.artist || '')).trim();
      album = (common.album || '').trim();
      year = common.year || '';
      duration_ms = Math.round((format.duration || 0) * 1000);
    } catch (e) {
      // ignorujemy pojedyncze błędy odczytu
    }

    // jeśli tagi puste – spróbuj z nazwy pliku
    if (!title || !artist) {
      const guess = parseFromFilename(rel);
      if (!title) title = guess.title || '';
      if (!artist) artist = guess.artist || '';
    }

    rows.push({ path: rel, title, artist, album, year, duration_ms });
  }

  await fs.promises.mkdir('export', { recursive: true });
  await toCsv('export/tracks.csv', rows);
  console.log('Gotowe: export/tracks.csv');
}
