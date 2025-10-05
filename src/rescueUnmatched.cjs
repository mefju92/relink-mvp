#!/usr/bin/env node
/* src/rescueUnmatched.cjs — ratowanie słabych dopasowań (wersja ulepszona) */
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
    .replace(/[']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ULEPSZONE: Wytnij marketing/śmieci + obsługa Copy (1)
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

  // pojedyncze „official/out now" na końcu
  s = s.replace(/\b(official|out now)\s*$/i, '');
  
  // NOWE: Usuń Copy (1), Copy (2) itp.
  s = s.replace(/\s*-?\s*copy\s*\(\d+\)\s*$/i, '');
  s = s.replace(/\s*\(\s*copy\s*\d*\s*\)/gi, '');

  // sprzątanie
  s = s.replace(/\s{2,}/g, ' ').replace(/\s*-\s*$/, '');

  return s.trim();
}

// NOWE: Rozdzielanie artystów
function splitArtists(artistRaw) {
  if (!artistRaw) return [];
  const normalized = norm(artistRaw);
  return normalized
    .split(/\s*(?:,|&|x|vs\.?|versus|feat\.?|ft\.?|featuring|with)\s*/i)
    .map(a => a.trim())
    .filter(Boolean);
}

// NOWE: Overlap artystów
function artistOverlap(localArtists, spotifyArtists) {
  const localTokens = localArtists;
  const spotifyTokens = (spotifyArtists || []).map(a => norm(a.name));
  
  if (localTokens.length === 0) return 0;
  
  let matches = 0;
  for (const local of localTokens) {
    for (const spotify of spotifyTokens) {
      const sim = stringSimilarity.compareTwoStrings(local.toLowerCase(), spotify.toLowerCase());
      if (sim > 0.6) {
        matches++;
        break;
      }
    }
  }
  
  return localTokens.length > 0 ? matches / localTokens.length : 0;
}

/* === ULEPSZONE: Składanie zapytań do wyszukiwania === */
function buildQueries(artistRaw, titleRaw) {
  let title = coreTitle(titleRaw);
  const artists = splitArtists(artistRaw);
  
  // NOWE: Usuń label/wydawcę z końca tytułu
  title = title.replace(/\s*-\s*(music|records|recordings|label|entertainment)$/i, '').trim();
  
  // NOWE: Wyciągnij feat/ft z tytułu do artystów
  const featMatch = title.match(/\b(?:feat\.?|ft\.?|featuring)\s+([^()]+?)(?:\)|$)/i);
  if (featMatch && artists.length === 1) {
    const featArtist = featMatch[1].trim();
    artists.push(featArtist);
    title = title.replace(/\s*[\(\[]?\s*(?:feat\.?|ft\.?|featuring)\s+[^()\]]+[\)\]]?/gi, '').trim();
  }
  
  // wykryj remix/edit
  const hasRemix = /\b(remix|edit|mix)\b/i.test(title);
  const titleNoRemix = title.replace(/\b(remix|edit|mix|bootleg|mashup|vip)\b/gi, '').trim();
  
  // Warianty z nawiasami i bez
  const titleNoBrackets = title.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();

  const variants = [];
  
  // Z głównym artystą - pełny tytuł i bez nawiasów
  if (artists.length > 0 && title) {
    variants.push(`${artists[0]} ${title}`);
    if (titleNoBrackets !== title) {
      variants.push(`${artists[0]} ${titleNoBrackets}`);
    }
    variants.push(`track:"${titleNoBrackets || title}" artist:"${artists[0]}"`);
  }
  
  // Z wieloma artystami
  if (artists.length > 1 && title) {
    variants.push(`${artists[0]} ${artists[1]} ${title}`);
    if (titleNoBrackets !== title) {
      variants.push(`${artists[0]} ${artists[1]} ${titleNoBrackets}`);
    }
    variants.push(`artist:"${artists[0]}" artist:"${artists[1]}" track:"${titleNoBrackets || title}"`);
  }
  
  // Samo tytuł
  if (title) {
    variants.push(`${title}`);
    if (titleNoBrackets !== title) {
      variants.push(`${titleNoBrackets}`);
    }
  }
  
  // Wariant bez remix/edit
  if (hasRemix && titleNoRemix && artists.length > 0) {
    variants.push(`${artists[0]} ${titleNoRemix}`);
  }

  return _.uniq(
    variants
      .map((q) => q.replace(/\s{2,}/g, ' ').trim())
      .filter(Boolean)
  ).slice(0, 10); // zwiększone do 10 wariantów
}

/* === Scoring kandydatów === */
function similarity(a, b) {
  a = coreTitle(a);
  b = coreTitle(b);
  if (!a || !b) return 0;
  return stringSimilarity.compareTwoStrings(a.toLowerCase(), b.toLowerCase());
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
  const { localArtists, localTitle, localDurMs } = local;
  const titleSim = similarity(localTitle, sp.name);
  const artOverlap = artistOverlap(localArtists, sp.artists || []);
  const pen = durationPenalty(localDurMs, sp.duration_ms, opts.softMs ?? 2500, opts.hardMs ?? 8000);

  // Boost za bardzo bliski czas
  const durDiff = Math.abs((localDurMs || 0) - (sp.duration_ms || 0));
  const closeDurBoost =
    durDiff <= (opts.tightMs ?? 2000) ? 0.15 : durDiff <= (opts.looseMs ?? 5000) ? 0.07 : 0;

  // NOWE: Bonus za dopasowanie remix
  const localHasRemix = /\b(remix|edit)\b/i.test(localTitle);
  const spHasRemix = /\b(remix|edit)\b/i.test(sp.name);
  const remixBonus = (localHasRemix && spHasRemix) ? 0.05 : 0;

  // WAGI: 50% tytuł, 40% artysta, reszta = penalties/bonuses
  let base = 0.50 * titleSim + 0.40 * artOverlap;
  base = Math.max(0, Math.min(1, base - pen + closeDurBoost + remixBonus));
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
      minScore: 0.50,
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

    const localArtist = r.artist || '';
    const localArtists = splitArtists(localArtist);
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
              { localArtists, localTitle, localDurMs },
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