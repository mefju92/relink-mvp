#!/usr/bin/env node
/* Ulepszanie dopasowań – generowanie bogatszych zapytań i podbijanie słabych wyników */
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const SpotifyWebApi = require('spotify-web-api-node');
const stringSimilarity = require('string-similarity');
const { remove: stripDiacritics } = require('diacritics');
require('dotenv').config();

/* === Normalizacja / czyszczenie tytułów === */
function stripPathPrefix(raw) {
  if (!raw) return '';
  // Usuń wszystko do ostatniego / lub \
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
// Wytnij marketing/śmieci: (Official Video), [HD], - Radio Edit, - Extended Mix, "out now", "copy (1)" itd.
function coreTitle(raw) {
  if (!raw) return '';
  let s = stripPathPrefix(raw);       // <— NOWE: usuń "Favorites/..."
  s = norm(s);

  // dopiski w nawiasach
  s = s.replace(/\s*[\(\[]\s*(official|lyrics?|audio|video|music video|mv|hd|hq|remaster(?:ed)?|visualizer|clip|radio edit|extended mix|full(?:\s+(?:track|version))?|original mix|live|out now|premiere|teaser|trailer)\s*[\)\]]/gi, '');

  // dopiski po myślniku na końcu (+ copy (1))
  s = s.replace(/\s*-\s*(official|lyrics?|audio|video|music video|mv|hd|hq|remaster(?:ed)?|visualizer|clip|radio edit|extended mix|full(?:\s+(?:track|version))?|original mix|live|out now|premiere|teaser|trailer|copy\s*\(\d+\))\b.*$/gi, '');

  // końcowe [HD]/[Official] itp.
  s = s.replace(/\s*\[(?:hd|hq|official|lyrics?|audio|video|music video|mv)\]\s*$/i, '');

  // pojedyncze „official/out now” na końcu
  s = s.replace(/\b(official|out now)\s*$/i, '');

  // sprzątanie
  s = s.replace(/\s{2,}/g, ' ').replace(/\s*-\s*$/, '');

  return s.trim();
}

/* === Składanie zapytań do wyszukiwania === */
function buildQueries(artistRaw, titleRaw) {
  const a = norm(artistRaw);
  const t = norm(stripPathPrefix(titleRaw));
  const tCore = coreTitle(t);
  const tNoFeat = tCore.replace(/\bfeat\.?.*$/i, '').trim();

  const variants = [
    `${a} ${tCore}`,
    `${a} ${tNoFeat}`,
    `${tCore}`,
    `${tNoFeat}`,
    `"${tCore}" ${a}`,
    `"${tNoFeat}" ${a}`,
    `"${tCore}"`,
    `"${tNoFeat}"`,
    `${a} - ${tCore}`,
    `${a} - ${tNoFeat}`,
    `track:"${tCore}" artist:"${a}"`,
    `track:"${tNoFeat}" artist:"${a}"`,
  ];

  return [...new Set(variants.map(v => v.replace(/\s{2,}/g, ' ').trim()).filter(Boolean))];
}

/* === Scoring === */
function titleSim(a, b) {
  a = coreTitle(a);
  b = coreTitle(b);
  if (!a || !b) return 0;
  return stringSimilarity.compareTwoStrings(a.toLowerCase(), b.toLowerCase());
}
function durationPenalty(localMs, spotifyMs, soft = 2500, hard = 8000) {
  if (!localMs || !spotifyMs) return 0.05;
  const diff = Math.abs(Number(localMs) - Number(spotifyMs));
  if (diff <= soft) return 0;
  if (diff >= hard) return 0.4;
  return 0.4 * ((diff - soft) / (hard - soft));
}
function compositeScore(local, sp, opts = {}) {
  const { localTitle, localDurMs } = local;
  const tSim = titleSim(localTitle, sp.name);
  const pen = durationPenalty(localDurMs, sp.duration_ms, opts.softMs ?? 2500, opts.hardMs ?? 8000);
  const diff = Math.abs((localDurMs || 0) - (sp.duration_ms || 0));
  const boost = diff <= 2000 ? 0.15 : diff <= 5000 ? 0.07 : 0;
  let base = tSim;
  base = Math.max(0, Math.min(1, base - pen + boost));
  return base;
}

/* === Spotify === */
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
  if (!process.env.SPOTIFY_REFRESH_TOKEN) {
    throw new Error('Brak SPOTIFY_REFRESH_TOKEN w .env');
  }
  const { body } = await api.refreshAccessToken();
  api.setAccessToken(body.access_token);
  return body.access_token;
}

/* === Main === */
async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['in', 'out'],
    default: {
      in: 'export/matches.csv',
      out: 'export/matches_enhanced.csv',
      minScore: 0.65,
      durMs: 2500,
      limit: 7,
    },
  });

  const rows = parse(fs.readFileSync(argv.in, 'utf8'), { columns: true, skip_empty_lines: true });
  const api = newSpotifyClient();
  await getAccessToken(api);

  let fixedEmpty = 0;
  let improvedWeak = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const curId = r.spotify_track_id;
    const curScore = Number(r.match_score || 0);
    const localTitle = stripPathPrefix(r.title || r.filename || r.file || '');
    const localDurMs = Number(r.duration_ms || 0);

    // próbujemy tylko gdy brak ID albo słabo
    if (curId && curScore >= Number(argv.minScore)) continue;

    const queries = buildQueries(r.artist || '', localTitle);
    let best = { score: curScore || 0, id: curId || '', name: r.spotify_track_name || '' };

    for (const q of queries) {
      try {
        const res = await api.searchTracks(q, { limit: Math.min(Number(argv.limit), 50), market: 'from_token' });
        const items = res?.body?.tracks?.items || [];
        for (const sp of items) {
          const s = compositeScore({ localTitle, localDurMs }, sp, { softMs: Number(argv.durMs), hardMs: 9000 });
          if (s > best.score) {
            best = { score: s, id: sp.id, name: sp.name };
          }
        }
      } catch {}
    }

    if (!curId && best.id) fixedEmpty++;
    if (curId && best.id && best.score > curScore) improvedWeak++;

    if (best.id) {
      r.spotify_track_id = best.id;
      r.match_score = best.score.toFixed(3);
      r.spotify_track_name = best.name || r.spotify_track_name || '';
    }
  }

  fs.writeFileSync(argv.out, stringify(rows, { header: true }), 'utf8');
  console.log(`Zapisano: ${argv.out}`);
  console.log(`Uratowano puste ID: ${fixedEmpty}, poprawiono słabe dopasowania: ${improvedWeak}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
