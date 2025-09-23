#!/usr/bin/env node
// Usuwa duplikaty po kolumnie spotify_track_id, zachowując pierwsze wystąpienie.
// Użycie:
//   node src/dedupeCsvById.cjs --in export/matches_rescued.csv --out export/matches_rescued_dedup.csv

const fs = require('fs');
const minimist = require('minimist');

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  // usuń puste z końca
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const header = lines.shift();
  const rows = lines.map(l => l.split(','));
  const cols = header.split(',');
  return { header, cols, rows };
}

function idx(cols, name) {
  const i = cols.indexOf(name);
  if (i === -1) throw new Error(`Brak kolumny: ${name}`);
  return i;
}

(function main() {
  const argv = minimist(process.argv.slice(2), { string: ['in', 'out'] });
  const inPath = argv.in;
  const outPath = argv.out || 'export/matches_rescued_dedup.csv';
  if (!inPath) {
    console.error('Użycie: node src/dedupeCsvById.cjs --in <wejściowy.csv> --out <wyjściowy.csv>');
    process.exit(1);
  }

  const text = fs.readFileSync(inPath, 'utf8');
  const { header, cols, rows } = parseCSV(text);
  const idI = idx(cols, 'spotify_track_id');

  const seen = new Set();
  const out = [header];
  let kept = 0, skipped = 0;

  for (const r of rows) {
    const id = r[idI];
    if (!id) { skipped++; continue; }
    if (seen.has(id)) { skipped++; continue; }
    seen.add(id);
    out.push(r.join(','));
    kept++;
  }

  fs.writeFileSync(outPath, out.join('\n'));
  console.log(`Zapisano: ${outPath}`);
  console.log(`Zachowane wiersze: ${kept}, pominięte (duplikaty/bez ID): ${skipped}`);
})();
