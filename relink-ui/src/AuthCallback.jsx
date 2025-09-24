import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        // v2: jeśli link ma ?code=..., to to zadziała
        await supabase.auth.exchangeCodeForSession(window.location.href);
      } catch {
        // fallback dla linków z #access_token
        if (supabase.auth.setSessionFromUrl) {
          await supabase.auth.setSessionFromUrl();
        }
      } finally {
        navigate('/app', { replace: true });
      }
    })();
  }, [navigate]);

  return <p>Logowanie…</p>;
}
