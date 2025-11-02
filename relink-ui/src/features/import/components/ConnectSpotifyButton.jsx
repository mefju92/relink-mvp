// src/features/import/components/ConnectSpotifyButton.jsx
import { useEffect, useState } from 'react';
import { supabase } from '../../../supabaseClient'; // ⬅ named import (u Ciebie jest export const supabase)

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

export default function ConnectSpotifyButton() {
  const [name, setName] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) { setLoading(false); return; }

      try {
        const r = await fetch(`${API_BASE}/spotify/status`, {
          headers: { Authorization: `Bearer ${jwt}` }
        });
        const j = await r.json();
        if (j.ok && j.connected) setName(j.name || 'connected');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleClick = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const jwt = session?.access_token || '';
    const frontend = `${window.location.origin}/app`;

    window.location.href =
      `${API_BASE}/spotify/login?token=${encodeURIComponent(jwt)}&frontend=${encodeURIComponent(frontend)}`;
  };

  if (name) {
    return (
      <span className="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700">
        Spotify: <b>{name}</b>
      </span>
    );
  }

  return (
    <button onClick={handleClick} disabled={loading} className="btn btn-primary">
      {loading ? 'Sprawdzam…' : 'Połącz Spotify'}
    </button>
  );
}
