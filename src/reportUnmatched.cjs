#!/usr/bin/env node
const fs = require('fs');
const { parse } = require('csv-parse/sync');

const IN = process.argv[2] || 'export/matches.csv';
const minScore = parseFloat(process.argv[3] || '0.65');

const csv = fs.readFileSync(IN, 'utf8');
const rows = parse(csv, { columns: true, skip_empty_lines: true });

const has = n => n != null && n !== '';
const hdr = Object.keys(rows[0] || {});
const idCol = hdr.find(h => /spotify.*id/i.test(h)) || 'spotify_track_id';
const scoreCol = hdr.find(h => /match.*score/i.test(h)) || 'match_score';
const titleCol = hdr.find(h => /title/i.test(h)) || 'title';
const artistCol = hdr.find(h => /artist/i.test(h)) || 'artist';
const durCol = hdr.find(h => /(duration|length)/i.test(h)) || 'duration_ms';
const fileCol = hdr.find(h => /(path|file|filename)/i.test(h)) || 'path';

let missing = 0, low = 0;
for (const r of rows) {
  const id = r[idCol];
  const s = parseFloat(r[scoreCol] || '0');
  if (!has(id)) missing++;
  else if (s < minScore) low++;
}
console.log(`Plik: ${IN}`);
console.log(`Wierszy: ${rows.length}`);
console.log(`Brak ID: ${missing}`);
console.log(`Score < ${minScore}: ${low}`);

const sample = rows.filter(r => !(r[idCol]) || parseFloat(r[scoreCol]||'0') < minScore).slice(0, 15);
console.log('\nPrzykłady problemów:');
for (const r of sample) {
  console.log(`- ${r[artistCol]} – ${r[titleCol]}  (${r[durCol]} ms)  [${r[fileCol]}]  id=${r[idCol]||'-'} score=${r[scoreCol]||'-'}`);
}
