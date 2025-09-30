// src/SpotifyConnect.jsx
import { useEffect, useState } from 'react';

// kompatybilnie z różnymi exportami w Twoim supabaseClient.js
import _supabaseDefault, { supabase as _supabaseNamed } from './supabaseClient';
const supabase = _supabaseNamed || _supabaseDefault;

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5174';

export default function SpotifyConnect() {
  const [name, setName] = useState(null);
  const [disabled, setDisabled] = useState(false);

  // usuń ?spotify=ok|error z URL po powrocie z OAuth
  function cleanupQuery() {
    const url = new URL(window.location.href);
    if (url.searchParams.has('spotify')) {
      url.searchParams.delete('spotify');
      url.searchParams.delete('reason');
      window.history.replaceState({}, '', url.toString());
    }
  }

  async function getJwt() {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  }

  async function fetchStatus() {
    const jwt = await getJwt();
    if (!jwt) { setName(null); return; }
    try {
      const r = await fetch(`${API_BASE}/api/spotify/status`, {
        headers: { Authorization: `Bearer ${jwt}` }
      });
      const j = await r.json();
      setName(j?.ok && j.connected ? (j.name || 'Spotify') : null);
    } catch {
      setName(null);
    }
  }

  useEffect(() => {
    cleanupQuery();
    fetchStatus();
    // po powrocie z innej karty/okna też odśwież status
    const onFocus = () => fetchStatus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  async function connectSpotify() {
    const jwt = await getJwt();
    if (!jwt) {
      alert('Najpierw zaloguj się w aplikacji (Supabase), potem połącz Spotify.');
      return;
    }
    setDisabled(true);
    const frontend = window.location.origin;
    window.location.href =
      `${API_BASE}/spotify/login?frontend=${encodeURIComponent(frontend)}&token=${encodeURIComponent(jwt)}`;
  }

  return (
    <button
      onClick={name ? undefined : connectSpotify}
      className="btn btn-success"
      disabled={!!name || disabled}
      title={name ? 'Połączono ze Spotify' : 'Połącz ze Spotify'}
      style={{ minWidth: 140 }}
    >
      {name || 'Spotify'}
    </button>
  );
}
