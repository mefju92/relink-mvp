#!/usr/bin/env node
/* src/rescueUnmatched.cjs — ratowanie słabych dopasowań (wersja rozszerzona) */
const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const SpotifyWebApi = require('spotify-web-api-node');
const stringSimilarity = require('string-similarity');
const { remove: stripDiacritics } = require('diacritics');
const _ = require('lodash');
require('dotenv').config();

/* === Normalizacja / czyszczenie tytułów === */
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
  let s = norm(raw);

  // dopiski w nawiasach
  s = s.replace(
    /\s*[\(\[]\s*(official|lyrics?|audio|video|music video|mv|hd|hq|remaster(?:ed)?|visualizer|clip|radio edit|extended mix|full(?:\s+(?:track|version))?|original mix|live|out now|premiere|teaser|trailer)\s*[\)\]]/gi,
    ''
  );

  // dopiski po myślniku na końcu (+ copy (1))
  s = s.replace(
    /\s*-\s*(official|lyrics?|audio|video|music video|mv|hd|hq|remaster(?:ed)?|visualizer|clip|radio edit|extended mix|full(?:\s+(?:track|version))?|original mix|live|out now|premiere|teaser|trailer|copy\s*\(\d+\))\b.*$/gi,
    ''
  );

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
  const t = norm(titleRaw);
  const tCore = coreTitle(t);

  // wersje bez „feat …” w tytule
  const tNoFeat = tCore.replace(/\bfeat\.?.*$/i, '').trim();

  // zestaw bogatych wariantów
  const variants = [
    `${a} ${tCore}`,
    `${a} ${tNoFeat}`,
    `${tCore}`,
    `${tNoFeat}`,

    // cudzysłowy pomagają przy długich tytułach
    `"${tCore}" ${a}`,
    `"${tNoFeat}" ${a}`,
    `"${tCore}"`,
    `"${tNoFeat}"`,

    // forma „artist - title”
    `${a} - ${tCore}`,
    `${a} - ${tNoFeat}`,

    // kwalifikatory pól
    `track:"${tCore}" artist:"${a}"`,
    `track:"${tNoFeat}" artist:"${a}"`,
  ];

  return _.uniq(
    variants
      .map((q) => q.replace(/\s{2,}/g, ' ').trim())
      .filter(Boolean)
  );
}

/* === Scoring kandydatów === */
function similarity(a, b) {
  a = coreTitle(a);
  b = coreTitle(b);
  if (!a || !b) return 0;
  return stringSimilarity.compareTwoStrings(a.toLowerCase(), b.toLowerCase());
}

function artistScore(localArtist, spotifyArtists) {
  const local = norm(localArtist);
  const spNames = (spotifyArtists || []).map((x) => norm(x.name));
  if (!local || spNames.length === 0) return 0;
  const best = Math.max(
    ...spNames.map((sp) => stringSimilarity.compareTwoStrings(local.toLowerCase(), sp.toLowerCase()))
  );
  return isFinite(best) ? best : 0;
}

function durationPenalty(localMs, spotifyMs, soft = 2500, hard = 8000) {
  if (!localMs || !spotifyMs) return 0.05; // lekka kara za brak danych
  const diff = Math.abs(Number(localMs) - Number(spotifyMs));
  if (diff <= soft) return 0;
  if (diff >= hard) return 0.4;
  const ratio = (diff - soft) / (hard - soft);
  return 0.4 * ratio;
}

function compositeScore(local, sp, opts = {}) {
  const { localArtist, localTitle, localDurMs } = local;
  const titleSim = similarity(localTitle, sp.name);
  const artSim = artistScore(localArtist, sp.artists || []);
  const pen = durationPenalty(localDurMs, sp.duration_ms, opts.softMs ?? 2500, opts.hardMs ?? 8000);

  // Boost za bardzo bliski czas
  const durDiff = Math.abs((localDurMs || 0) - (sp.duration_ms || 0));
  const closeDurBoost =
    durDiff <= (opts.tightMs ?? 2000) ? 0.15 : durDiff <= (opts.looseMs ?? 5000) ? 0.07 : 0;

  let base = 0.6 * titleSim + 0.4 * artSim;
  base = Math.max(0, Math.min(1, base - pen + closeDurBoost));
  return base;
}

/* === Spotify API === */
function newSpotifyClient() {
  const api = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: process.env.SPOTIFY_REDIRECT_URI,
  });
  if (process.env.SPOTIFY_REFRESH_TOKEN) {
    api.setRefreshToken(process.env.SPOTIFY_REFRESH_TOKEN);
  }
  return api;
}

async function getAccessToken(api) {
  if (!process.env.SPOTIFY_REFRESH_TOKEN) {
    throw new Error('Brak SPOTIFY_REFRESH_TOKEN w .env (najpierw uruchom przepływ autoryzacji).');
  }
  const { body } = await api.refreshAccessToken();
  api.setAccessToken(body.access_token);
  return body.access_token;
}

/* === Główna logika === */
async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['in', 'out'],
    default: {
      in: 'export/matches.csv',
      out: 'export/matches_rescued.csv',
      minScore: 0.55,
      limit: 15,    // spróbuj więcej kandydatów
      durMs: 5000,  // tolerancja czasu (soft)
    },
  });

  const MIN_SCORE = Number(argv.minScore);
  const MAX_LIMIT = Math.min(Number(argv.limit), 50); // API max 50
  const DUR_SOFT = Number(argv.durMs);
  const DUR_HARD = Math.max(DUR_SOFT * 3, 9000);

  const fileIn = path.resolve(argv.in);
  const fileOut = path.resolve(argv.out);

  const csv = fs.readFileSync(fileIn, 'utf8');
  const rows = parse(csv, { columns: true, skip_empty_lines: true });

  const api = newSpotifyClient();
  await getAccessToken(api);

  let improved = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const curId = r.spotify_track_id;
    const curScore = Number(r.match_score || 0);

    // próbujemy tylko, gdy wynik jest słaby
    if (curScore >= MIN_SCORE && curId) {
      if ((i + 1) % 50 === 0 || i === rows.length - 1) {
        console.log(`…przetworzono ${i + 1}/${rows.length}`);
      }
      continue;
    }

    const localArtist = norm(r.artist || '');
    const localTitle = norm(r.title || '');
    const localDurMs = Number(r.duration_ms || 0);

    const queries = buildQueries(localArtist, localTitle);
    let best = {
      score: curScore || 0,
      id: curId || '',
      name: r.spotify_track_name || '',
      artists: r.spotify_artists || '',
    };

    // Dwie tury wyszukiwania: (1) market from_token, (2) global
    const passes = [{ market: 'from_token' }, { market: undefined }];

    for (const pass of passes) {
      for (const q of queries) {
        try {
          const res = await api.searchTracks(q, {
            limit: MAX_LIMIT,
            ...(pass.market ? { market: pass.market } : {}),
          });
          const items = res?.body?.tracks?.items || [];
          for (const sp of items) {
            const candScore = compositeScore(
              { localArtist, localTitle, localDurMs },
              sp,
              { softMs: DUR_SOFT, hardMs: DUR_HARD, tightMs: 2000, looseMs: 5000 }
            );
            if (candScore > best.score) {
              best = {
                score: candScore,
                id: sp.id,
                name: sp.name,
                artists: (sp.artists || []).map((a) => a.name).join(', '),
              };
            }
          }
        } catch (_) {
          // ignoruj pojedyncze błędy sieciowe / limitowe
        }
      }
    }

    if (best.id && best.score > curScore) {
      r.spotify_track_id = best.id;
      r.match_score = best.score.toFixed(3);
      r.spotify_track_name = best.name || r.spotify_track_name || '';
      r.spotify_artists = best.artists || r.spotify_artists || '';
      improved++;
    }

    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      console.log(`…przetworzono ${i + 1}/${rows.length}`);
    }
  }

  const outCsv = stringify(rows, { header: true });
  fs.writeFileSync(fileOut, outCsv, 'utf8');

  console.log(`Zapisano: ${path.relative(process.cwd(), fileOut)}`);
  console.log(`Uratowano/ulepszono dopasowania: ${improved}`);
}

main().catch((e) => {
  console.error('Błąd:', e?.message || e);
  process.exit(1);
});
