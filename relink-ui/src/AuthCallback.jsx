// relink-ui/src/AuthCallback.jsx
import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

/** Parsuje #hash do obiektu { key: value } */
function parseHash() {
  const raw = window.location.hash?.replace(/^#/, '') || ''
  return Object.fromEntries(new URLSearchParams(raw))
}

/** Czyści hash z paska adresu (żeby nie wyciekały tokeny) */
function clearHash() {
  const { pathname, search } = window.location
  window.history.replaceState(null, '', pathname + search)
}

export default function AuthCallback() {
  const [msg, setMsg] = useState('Kończę logowanie…')

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href)
        const next = url.searchParams.get('next') || '/app'

        // 1) Standardowy flow (OAuth/magic link)
        try {
          await supabase.auth.exchangeCodeForSession(window.location.href)
        } catch {
          // Brak code w URL — spróbujemy z #access_token
        }

        // 2) Czy mamy sesję?
        let { data } = await supabase.auth.getSession()

        // 3) Starszy wariant: #access_token w hashu
        if (!data?.session) {
          const hash = parseHash()
          if (hash.access_token && hash.refresh_token) {
            try {
              await supabase.auth.setSession({
                access_token: hash.access_token,
                refresh_token: hash.refresh_token,
              })
              ;({ data } = await supabase.auth.getSession())
            } catch {
              /* ignore */
            }
          }
        }

        if (data?.session) {
          clearHash()
          setMsg('Zalogowano. Przekierowanie…')
          // -> prosto do importera (albo na "next" jeśli był podany w URL)
          window.location.replace(next)
          return
        }

        // Brak sesji – pokaż błąd
        setMsg('Nie udało się dokończyć logowania.')
      } catch (e) {
        setMsg('Błąd logowania.')
        console.error(e)
      }
    })()
  }, [])

  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', fontFamily:'system-ui' }}>
      <div style={{ textAlign:'center', maxWidth: 520, padding: 16 }}>
        <h2 style={{ marginBottom: 8 }}>{msg}</h2>
        <p>
          Jeśli nic się nie dzieje,&nbsp;
          <a href="/app">przejdź do importera</a>
          &nbsp;lub&nbsp;
          <a href="/">wróć na stronę główną</a>.
        </p>
      </div>
    </div>
  )
}
