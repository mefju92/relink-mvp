import 'dotenv/config';
import SpotifyWebApi from 'spotify-web-api-node';
import { fromCsv, toCsv } from './csv.js';
import fs from 'fs';

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[·•]/g, ' ')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*\[.*?\]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// prosty scoring: tytuł + artysta + długość
function scoreMatch(row, cand) {
  const t1 = normalize(row.title);
  const a1 = normalize(row.artist);
  const t2 = normalize(cand.name);
  const a2 = normalize(cand.artists.map(a => a.name).join(' '));

  let score = 0;
  if (t1 && t2) {
    if (t1 === t2) score += 0.6;
    else if (t2.includes(t1) || t1.includes(t2)) score += 0.4;
  }
  if (a1 && a2) {
    if (a1 === a2) score += 0.3;
    else if (a2.includes(a1) || a1.includes(a2)) score += 0.2;
  }
  const d1 = Number(row.duration_ms || 0);
  const d2 = Number(cand.duration_ms || 0);
  const delta = Math.abs(d2 - d1);
  if (d1 && d2 && delta <= 3000) score += 0.1;
  else if (d1 && d2 && delta <= 7000) score += 0.05;

  return score;
}

function buildQuery(row) {
  const t = (row.title || '').trim();
  const a = (row.artist || '').trim();
  if (t && a) return `${t} ${a}`;
  return t || a || '';
}

async function getAppSpotify() {
  const api = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  });
  const tok = await api.clientCredentialsGrant();
  api.setAccessToken(tok.body.access_token);
  return api;
}

export async function matchCommand() {
  const rows = await fromCsv('export/tracks.csv');
  if (!rows.length) {
    console.log('Brak danych w export/tracks.csv. Najpierw uruchom scan.');
    return;
  }

  const api = await getAppSpotify();
  const out = [];

  console.log('Szukam dopasowań w Spotify...');
  for (const row of rows) {
    const q = buildQuery(row);
    if (!q) {
      out.push({ ...row, spotify_track_id: '', spotify_url: '', match_score: 0, match_title: '', match_artist: '' });
      continue;
    }

    try {
      const resp = await api.searchTracks(q, { limit: 5 });
      const items = resp?.body?.tracks?.items || [];
      if (!items.length) {
        out.push({ ...row, spotify_track_id: '', spotify_url: '', match_score: 0, match_title: '', match_artist: '' });
        continue;
      }

      let best = null;
      let bestScore = -1;
      for (const it of items) {
        const s = scoreMatch(row, it);
        if (s > bestScore) { bestScore = s; best = it; }
      }
      const url = best?.external_urls?.spotify || '';
      const match_title = best?.name || '';
      const match_artist = (best?.artists || []).map(a => a.name).join(', ');

      out.push({
        ...row,
        spotify_track_id: best?.id || '',
        spotify_url: url,
        match_score: Number(bestScore.toFixed(3)),
        match_title,
        match_artist,
      });
    } catch (e) {
      out.push({ ...row, spotify_track_id: '', spotify_url: '', match_score: 0, match_title: '', match_artist: '' });
    }
  }

  await fs.promises.mkdir('export', { recursive: true });
  await toCsv('export/matches.csv', out);
  console.log('Gotowe: export/matches.csv');
}

export async function playlistCommand() {
  console.log('TODO: playlist — zrobimy po OAuth użytkownika.');
}
