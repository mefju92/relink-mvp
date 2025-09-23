import fs from 'fs';

export async function toCsv(outPath, rows) {
  if (!rows.length) {
    await fs.promises.writeFile(outPath, '');
    return;
  }
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const r of rows) {
    const line = headers.map(h => escapeCsv(r[h] ?? '')).join(',');
    lines.push(line);
  }
  await fs.promises.writeFile(outPath, lines.join('\n'), 'utf8');
}

export async function fromCsv(inPath) {
  const raw = await fs.promises.readFile(inPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const vals = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => (obj[h] = vals[i] ?? ''));
    return obj;
  });
  return rows;
}

// prosty parser CSV (obsługa cudzysłowów)
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function escapeCsv(val) {
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
