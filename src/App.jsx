import { useMemo, useState } from 'react';
import * as mm from 'music-metadata-browser';

export default function App() {
  const [files, setFiles] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [matching, setMatching] = useState(false);
  const [results, setResults] = useState([]);
  const [minScore, setMinScore] = useState(0.58);
  const [playlistUrl, setPlaylistUrl] = useState(null);

  async function handlePick(e) {
    const list = Array.from(e.target.files || []);
    setFiles(list);
    setResults([]);
    setPlaylistUrl(null);

    const audio = list.filter(f =>
      /\.(mp3|flac|m4a|wav|ogg)$/i.test(f.name)
    );

    const parsed = [];
    for (const f of audio) {
      try {
        const meta = await mm.parseBlob(f);
        const common = meta.common || {};
        const format = meta.format || {};
        parsed.push({
          title: common.title || f.name.replace(/\.[^.]+$/, ''),
          artist: (common.artists && common.artists[0]) || common.artist || '',
          album: common.album || '',
          durationMs: Math.round((format.duration || 0) * 1000),
          size: f.size,
          name: f.name,
        });
      } catch {
        parsed.push({
          title: f.name.replace(/\.[^.]+$/, ''),
          artist: '',
          album: '',
          durationMs: 0,
          size: f.size,
          name: f.name,
        });
      }
    }
    setTracks(parsed);
  }

  async function runMatch() {
    setMatching(true);
    setResults([]);
    setPlaylistUrl(null);
    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks, minScore }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'match failed');
      setResults(j.results);
    } catch (e) {
      alert('Błąd dopasowania: ' + e.message);
    } finally {
      setMatching(false);
    }
  }

  async function createPlaylist() {
    const matched = results.filter(r => r.spotifyId);
    if (!matched.length) return alert('Brak dopasowań do dodania.');
    try {
      const res = await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matched }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error || 'playlist failed');
      setPlaylistUrl(j.playlistUrl);
    } catch (e) {
      alert('Błąd playlisty: ' + e.message);
    }
  }

  const stats = useMemo(() => {
    const ok = results.filter(r => r.spotifyId).length;
    return { ok, total: results.length };
  }, [results]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        ReLink MVP (Spotify)
      </h1>
      <p style={{ opacity: 0.8, marginBottom: 16 }}>
        Wybierz folder lub pliki audio → odczytamy tagi w przeglądarce, dopasujemy do Spotify, a potem stworzymy playlistę.
      </p>

      <div style={{
        display: 'grid', gap: 12, gridTemplateColumns: '1fr', marginBottom: 16
      }}>
        <input
          type="file"
          multiple
          // pozwala wybrać folder (Chrome/Edge)
          webkitdirectory="true"
          onChange={handlePick}
        />

        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>Minimalny score: {minScore.toFixed(2)}</span>
          <input
            type="range"
            min="0.40"
            max="0.80"
            step="0.01"
            value={minScore}
            onChange={(e) => setMinScore(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={!tracks.length || matching} onClick={runMatch}>
            {matching ? 'Dopasowuję…' : `Skanuj i dopasuj (${tracks.length})`}
          </button>
          <button
            disabled={!results.some(r => r.spotifyId)}
            onClick={createPlaylist}
          >
            Utwórz playlistę
          </button>
          {playlistUrl && (
            <a href={playlistUrl} target="_blank" rel="noreferrer">Otwórz playlistę</a>
          )}
        </div>
      </div>

      {!!tracks.length && (
        <div style={{ marginTop: 8, marginBottom: 8 }}>
          <b>Pliki:</b> {tracks.length}
        </div>
      )}

      {!!results.length && (
        <div style={{ marginTop: 8, marginBottom: 8 }}>
          <b>Dopasowania:</b> {stats.ok}/{stats.total}
        </div>
      )}

      <div style={{ border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
        <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse' }}>
          <thead style={{ background: '#fafafa' }}>
            <tr>
              <th align="left">Plik / Tytuł</th>
              <th align="left">Artysta</th>
              <th align="right">Czas</th>
              <th align="left">Spotify</th>
              <th align="right">Score</th>
            </tr>
          </thead>
          <tbody>
            {(results.length ? results : tracks).map((row, i) => {
              const r = results.length ? row : null;
              const t = results.length ? row.input : row;
              return (
                <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                  <td>{t.name} <div style={{ opacity: .7 }}>{t.title}</div></td>
                  <td>{t.artist || '-'}</td>
                  <td align="right">
                    {t.durationMs ? (t.durationMs/1000).toFixed(0)+'s' : '-'}
                  </td>
                  <td>
                    {r?.spotifyId ? (
                      <a href={r.spotifyUrl} target="_blank" rel="noreferrer">
                        {r.name} — {r.artists}
                      </a>
                    ) : results.length ? '—' : ''}
                  </td>
                  <td align="right">{r ? r.score.toFixed(3) : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12, opacity: 0.7, marginTop: 12 }}>
        Tip: Jeśli brakuje dopasowań, zwiększ tolerancję w backendzie (funkcja durationScore) lub obniż Minimalny score.
      </p>
    </div>
  );
}
