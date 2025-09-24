// relink-ui/src/AuthCallback.jsx
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

/** Parsuje #hash do obiektu { key: value } */
function parseHash() {
  const raw = window.location.hash?.replace(/^#/, '') || '';
  return Object.fromEntries(new URLSearchParams(raw));
}

export default function AuthCallback() {
  const [msg, setMsg] = useState('Kończę logowanie…');

  useEffect(() => {
    (async () => {
      try {
        // 1) Najpierw spróbuj standardowego flow (code w URL)
        //    Działa m.in. dla OAuth, e-mail potwierdzeń (v2).
        await supabase.auth.exchangeCodeForSession(window.location.href);
      } catch {
        // ignorujemy – spróbujemy ścieżki #access_token
      }

      // 2) Czy mamy już sesję?
      let { data } = await supabase.auth.getSession();
      if (!data?.session) {
        // 3) Stary wariant: link z #access_token w hashu
        const hash = parseHash();
        if (hash.access_token && hash.refresh_token) {
          try {
            await supabase.auth.setSession({
              access_token: hash.access_token,
              refresh_token: hash.refresh_token,
            });
            ({ data } = await supabase.auth.getSession());
          } catch {
            /* no-op */
          }
        }
      }

      setMsg('Zalogowano. Przekierowanie…');
      // wracamy na stronę główną
      window.location.replace('/');
    })();
  }, []);

  return (
    <div style={{minHeight:'100vh', display:'grid', placeItems:'center', fontFamily:'system-ui'}}>
      <div style={{textAlign:'center'}}>
        <h2>{msg}</h2>
        <p>Jeśli nic się nie dzieje, <a href="/">kliknij tutaj</a>.</p>
      </div>
    </div>
  );
}
