#!/usr/bin/env node
/* Filtrowanie: zostaw rekordy >= minScore, usuń duplikaty ID */
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { remove: stripDiacritics } = require('diacritics');

/* Usuwanie prefiksu ścieżki */
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
  let s = stripPathPrefix(raw); // <— NOWE
  s = norm(s);
  s = s.replace(/\s*[\(\[]\s*(official|lyrics?|audio|video|music video|mv|hd|hq|remaster(?:ed)?|visualizer|clip|radio edit|extended mix|full(?:\s+(?:track|version))?|original mix|live|out now|premiere|teaser|trailer)\s*[\)\]]/gi, '');
  s = s.replace(/\s*-\s*(official|lyrics?|audio|video|music video|mv|hd|hq|remaster(?:ed)?|visualizer|clip|radio edit|extended mix|full(?:\s+(?:track|version))?|original mix|live|out now|premiere|teaser|trailer|copy\s*\(\d+\))\b.*$/gi, '');
  s = s.replace(/\s*\[(?:hd|hq|official|lyrics?|audio|video|music video|mv)\]\s*$/i, '');
  s = s.replace(/\b(official|out now)\s*$/i, '');
  s = s.replace(/\s{2,}/g, ' ').replace(/\s*-\s*$/, '');
  return s.trim();
}

function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['in', 'out'],
    default: { in: 'export/matches.csv', out: 'export/matches_filtered.csv', minScore: 0.60 },
  });

  const rows = parse(fs.readFileSync(argv.in, 'utf8'), { columns: true, skip_empty_lines: true });

  const MIN = Number(argv.minScore);
  const seen = new Set();
  const kept = [];
  let rejected = 0, noId = 0, dupId = 0;

  for (const r of rows) {
    // Podmień tytuł na oczyszczony do spójności pipeline’u (nie wpływa na Spotify, tylko na raporty/export)
    if (r.title) r.title = coreTitle(r.title);

    const id = r.spotify_track_id?.trim();
    const score = Number(r.match_score || 0);

    if (!id) { noId++; continue; }
    if (score < MIN) { rejected++; continue; }
    if (seen.has(id)) { dupId++; continue; }

    seen.add(id);
    kept.push(r);
  }

  fs.writeFileSync(argv.out, stringify(kept, { header: true }), 'utf8');
  console.log(`Zapisano: ${argv.out}`);
  console.log(`Przyjęte: ${kept.length}, odrzucone (score): ${rejected}, bez ID: ${noId}, zduplikowane ID: ${dupId}`);
}

main();
