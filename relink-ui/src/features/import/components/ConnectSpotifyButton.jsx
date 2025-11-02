// src/features/import/components/ConnectSpotifyButton.jsx
import { useEffect, useState } from "react";
import { supabase } from "../../../supabaseClient"; // 3x .. z /features/import/components
const API_BASE = import.meta.env.VITE_API_BASE || ""; // w prod ustawiasz pełny URL backendu

export default function ConnectSpotifyButton() {
  const [session, setSession] = useState(null);
  const [name, setName] = useState(null);
  const [loading, setLoading] = useState(true);

  // śledź sesję Supabase
  useEffect(() => {
    let unsub = null;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const sub = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    unsub = () => sub.data.subscription.unsubscribe();

    return () => unsub && unsub();
  }, []);

  // jeśli zalogowany – sprawdź status Spotify
  useEffect(() => {
    (async () => {
      if (!session) { setLoading(false); return; }
      try {
        const r = await fetch(`${API_BASE}/api/spotify/status`, {
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
        const j = await r.json();
        if (j.ok && j.connected) setName(j.name || "connected");
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  const signIn = () =>
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });

  const connectSpotify = () => {
    const jwt = session?.access_token || "";
    const frontend = window.location.origin;
    window.location.href =
      `${API_BASE}/spotify/login?token=${encodeURIComponent(jwt)}&frontend=${encodeURIComponent(frontend)}`;
  };

  if (!session) {
    return (
      <button
        type="button"
        onClick={signIn}
        className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        Sign in
      </button>
    );
  }

  if (name) {
    return <span className="text-sm">Spotify: {name}</span>;
  }

  return (
    <button
      type="button"
      onClick={connectSpotify}
      disabled={loading}
      className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700
                 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2
                 disabled:opacity-60"
    >
      {loading ? "Sprawdzam…" : "Connect Spotify"}
    </button>
  );
}
