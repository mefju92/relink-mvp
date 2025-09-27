import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

export default function AuthLanding({ onAuthed, apiBase }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [msg, setMsg] = useState(null)
  const [loading, setLoading] = useState(false)

  // wstępne pobranie sesji + nasłuch
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session) onAuthed?.(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session) onAuthed?.(session)
    })
    return () => sub?.subscription?.unsubscribe?.()
  }, [onAuthed])

  async function signup(e) {
    e.preventDefault()
    setLoading(true); setMsg(null)
    const { error } = await supabase.auth.signUp({
      email,
      password: pass,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    setLoading(false)
    if (error) setMsg(`Błąd rejestracji: ${error.message}`)
    else setMsg('Rejestracja OK. Sprawdź skrzynkę i potwierdź adres e-mail.')
  }

  async function login(e) {
    e.preventDefault()
    setLoading(true); setMsg(null)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass })
    setLoading(false)
    if (error) setMsg(`Błąd logowania: ${error.message}`)
    else {
      setMsg('Zalogowano.')
      if (data?.session) onAuthed?.(data.session)
    }
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.reload()
  }

  // Najpewniejsza ścieżka: bezpośrednio do backendu (Render)
  function connectSpotify() {
    const frontend = window.location.origin
    const url = `${apiBase}/spotify/login?frontend=${encodeURIComponent(frontend)}`
    window.location.href = url
  }

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px', fontFamily: 'system-ui,sans-serif' }}>
      <h1 style={{ margin: '0 0 8px' }}>Odtwórz z nami swoją dawną playlistę 🎵</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Dopasujemy Twoje lokalne pliki do Spotify, stworzymy playlistę i zachowamy resztę w Twojej prywatnej chmurze.
      </p>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
        {/* LEWA – logowanie/rejestracja */}
        <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
          <div style={{ marginBottom: 10 }}>
            <button
              onClick={() => setMode('login')}
              style={{
                padding: '6px 10px',
                marginRight: 8,
                background: mode === 'login' ? '#222' : '#eee',
                color: mode === 'login' ? '#fff' : '#000',
                border: '1px solid #ccc',
                borderRadius: 6,
                cursor: 'pointer'
              }}
            >
              Logowanie
            </button>
            <button
              onClick={() => setMode('signup')}
              style={{
                padding: '6px 10px',
                background: mode === 'signup' ? '#222' : '#eee',
                color: mode === 'signup' ? '#fff' : '#000',
                border: '1px solid #ccc',
                borderRadius: 6,
                cursor: 'pointer'
              }}
            >
              Rejestracja
            </button>
          </div>

          <form onSubmit={mode === 'login' ? login : signup}>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#666' }}>E-mail</label>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="twoj@email.pl"
                style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
                type="email"
                required
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#666' }}>Hasło</label>
              <input
                value={pass}
                onChange={e => setPass(e.target.value)}
                style={{ width: '100%', padding: 8, border: '1px solid #ddd', borderRadius: 6 }}
                type="password"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: '1px solid #111',
                background: '#111',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              {loading ? 'Przetwarzam…' : (mode === 'login' ? 'Zaloguj się' : 'Zarejestruj się')}
            </button>
          </form>

          <button
            onClick={connectSpotify}
            style={{
              width: '100%',
              padding: '10px 14px',
              marginTop: 10,
              borderRadius: 8,
              border: '1px solid #1DB954',
              color: '#1DB954',
              background: '#fff',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Połącz konto Spotify
          </button>

          <button
            onClick={logout}
            style={{
              width: '100%',
              padding: '10px 14px',
              marginTop: 10,
              borderRadius: 8,
              border: '1px solid #ddd',
              background: '#fff',
              cursor: 'pointer'
            }}
          >
            Wyloguj
          </button>

          {msg && <div style={{ marginTop: 10, color: '#c00' }}>{msg}</div>}
        </div>

        {/* PRAWA – skrót do importera */}
        <div style={{ border: '1px solid #eee', padding: 16, borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>Już zalogowany?</h3>
          <p style={{ color: '#555' }}>Przejdź do importu i dopasowania.</p>
          <a
            href="/app"
            style={{
              display: 'inline-block',
              marginTop: 8,
              padding: '10px 14px',
              background: '#111',
              color: '#fff',
              borderRadius: 8,
              textDecoration: 'none'
            }}
          >
            Otwórz importera
          </a>
        </div>
      </div>
    </div>
  )
}
