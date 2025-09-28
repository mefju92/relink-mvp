// relink-ui/src/AuthLanding.jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'

function Modal({ text, onClose, ok = false }) {
  return (
    <div style={{minHeight:'100vh', display:'grid', placeItems:'center', padding:'32px 16px'}}>
    <div style={{width: 'min(720px, 96vw)'}}>

      {/* >>> TU ZOSTAWIASZ CAŁĄ SWOJĄ OBECNĄ ZAWARTOŚĆ STRONY LOGOWANIA <<< */}

    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000
      }}
    >
      <div
        role="dialog"
        aria-live="assertive"
        onClick={(e) => e.stopPropagation()}
        style={{
          minWidth: 300,
          maxWidth: 420,
          background: '#fff',
          borderRadius: 12,
          padding: '18px 20px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
          textAlign: 'center',
          border: ok ? '2px solid #16a34a' : '2px solid #ef4444'
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
          {ok ? 'Zalogowany' : 'Błąd logowania'}
        </div>
        <div style={{ color: '#444', marginBottom: 14 }}>{text}</div>
        <button
          autoFocus
          onClick={onClose}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #ddd',
            background: '#111',
            color: '#fff'
          }}
        >
          OK
        </button>
      </div>
    </div>
       </div>
  </div>
  )
}

export default function AuthLanding({ onAuthed, apiBase }) {
  const nav = useNavigate()
  const [tab, setTab] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(null) // { text, ok }

  // jeśli user już zalogowany -> od razu do importera
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession()
      if (data?.session) {
        onAuthed?.(data.session)
        nav('/app', { replace: true })
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error || !data?.session) {
        setModal({ text: 'Nieprawidłowy e-mail lub hasło.', ok: false })
        return
      }
      onAuthed?.(data.session)
      setModal({ text: 'Zalogowano pomyślnie. Przekierowuję…', ok: true })
      setTimeout(() => nav('/app', { replace: true }), 900)
    } finally {
      setLoading(false)
    }
  }

  // prosta rejestracja (opcjonalnie)
  async function handleRegister(e) {
    e.preventDefault()
    if (!email || !password) return
    setLoading(true)
    try {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setModal({ text: error.message || 'Nie udało się utworzyć konta.', ok: false })
      } else {
        setModal({
          text: 'Konto utworzone. Sprawdź e-mail (potwierdzenie), a potem zaloguj się.',
          ok: true
        })
        setTab('login')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        padding: '24px 16px'
      }}
    >
      <div style={{ width: '100%', maxWidth: 960 }}>
        {/* Nagłówek wyśrodkowany */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ margin: 0, fontSize: 38 }}>
            Odtwórz z nami swoją dawną playlistę
          </h1>
          <p style={{ marginTop: 8, color: '#555' }}>
            Dopasujemy Twoje lokalne pliki do Spotify, stworzymy playlistę i zachowamy resztę w Twojej prywatnej chmurze.
          </p>
        </div>

        {/* Jedna kolumna – wyłącznie formularz logowania/rejestracji */}
        <div
          style={{
            maxWidth: 440,
            margin: '0 auto',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 16
          }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button
              onClick={() => setTab('login')}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: tab === 'login' ? '#111' : '#f3f4f6',
                color: tab === 'login' ? '#fff' : '#111',
                flex: 1
              }}
            >
              Logowanie
            </button>
            <button
              onClick={() => setTab('register')}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #d1d5db',
                background: tab === 'register' ? '#111' : '#f3f4f6',
                color: tab === 'register' ? '#fff' : '#111',
                flex: 1
              }}
            >
              Rejestracja
            </button>
          </div>

          <form onSubmit={tab === 'login' ? handleLogin : handleRegister}>
            <label style={{ display: 'block', fontSize: 12, color: '#666' }}>E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ width: '100%', padding: 10, marginBottom: 8 }}
            />
            <label style={{ display: 'block', fontSize: 12, color: '#666' }}>Hasło</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ width: '100%', padding: 10, marginBottom: 12 }}
            />

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #111',
                background: '#111',
                color: '#fff',
                fontWeight: 600
              }}
            >
              {tab === 'login' ? (loading ? 'Loguję…' : 'Zaloguj się') : (loading ? 'Rejestruję…' : 'Utwórz konto')}
            </button>
          </form>
        </div>
      </div>

      {modal && <Modal text={modal.text} ok={modal.ok} onClose={() => setModal(null)} />}
    </div>
  )
}
