// src/components/ConnectSpotifyButton.jsx
import { useEffect, useState } from 'react';
import { supabase } from '../../../supabaseClient';

export default function ConnectSpotifyButton() {
  const [name, setName] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const jwt = session?.access_token;
      if (!jwt) { setLoading(false); return; }

      const r = await fetch('/api/spotify/status', {
        headers: { Authorization: `Bearer ${jwt}` }
      });
      const j = await r.json();
      if (j.ok && j.connected) setName(j.name || 'connected');
      setLoading(false);
    })();
  }, []);

  const handleClick = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const jwt = session?.access_token;
    const frontend = window.location.origin; // dokąd wraca OAuth
    window.location.href =
      `/spotify/login?token=${encodeURIComponent(jwt || '')}&frontend=${encodeURIComponent(frontend)}`;
  };

  if (name) return <span>Spotify: {name}</span>;
  return (
    <button onClick={handleClick} disabled={loading}>
      {loading ? 'Sprawdzam…' : 'Connect Spotify'}
    </button>
  );
}
