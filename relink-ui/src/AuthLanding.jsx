import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'

export default function AuthLanding() {
  const nav = useNavigate()
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState(null) // {type:'ok'|'err', msg:string}

  // jeśli ktoś już zalogowany -> nie przenosimy automatycznie, zostajemy na logowaniu
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      /* no-op – zostawiamy stronę logowania na ekranie */
    })
  }, [])

  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 1400)
  }

  async function onSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        showToast('ok', 'Zalogowano')
        setTimeout(() => nav('/app'), 700)
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        showToast('ok', 'Sprawdź e-mail, aby potwierdzić')
      }
    } catch (err) {
      showToast('err', 'Nieprawidłowy e-mail lub hasło')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100svh',
      display: 'grid',
      placeItems: 'center',
      padding: '24px',
      fontFamily: 'system-ui, sans-serif'
    }}>
      {/* karta logowania w centrum */}
      <div style={{
        width: 'min(520px, 92vw)',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
        boxShadow: '0 6px 24px rgba(0,0,0,0.06)'
      }}>
        <h1 style={{ margin: '0 0 6px', textAlign: 'center' }}>
          Odtwórz z nami swoją dawną playlistę
        </h1>
        <p style={{ margin: '0 0 16px', textAlign: 'center', color: '#666' }}>
          Dopasujemy Twoje lokalne pliki do Spotify i zachowamy resztę w Twojej prywatnej chmurze.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setMode('login')}
            style={{
              flex: 1, padding: '8px 10px', borderRadius: 8,
              border: '1px solid #d1d5db',
              background: mode === 'login' ? '#111' : '#f5f5f5',
              color: mode === 'login' ? '#fff' : '#111'
            }}>
            Logowanie
          </button>
          <button
            onClick={() => setMode('register')}
            style={{
              flex: 1, padding: '8px 10px', borderRadius: 8,
              border: '1px solid #d1d5db',
              background: mode === 'register' ? '#111' : '#f5f5f5',
              color: mode === 'register' ? '#fff' : '#111'
            }}>
            Rejestracja
          </button>
        </div>

        <form onSubmit={onSubmit}>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="E-mail"
            required
            style={{
              width: '100%', padding: 10, borderRadius: 8,
              border: '1px solid #d1d5db', marginBottom: 8
            }}
          />
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Hasło"
            required
            style={{
              width: '100%', padding: 10, borderRadius: 8,
              border: '1px solid #d1d5db', marginBottom: 12
            }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              background: '#111', color: '#fff', border: '1px solid #111',
              opacity: loading ? 0.7 : 1
            }}>
            {loading ? 'Przetwarzam…' : (mode === 'login' ? 'Zaloguj się' : 'Zarejestruj się')}
          </button>
        </form>
      </div>

      {/* mini-toast (półprzezroczyste tło + kartka na środku) */}
      {toast && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
          display: 'grid', placeItems: 'center', zIndex: 50
        }}>
          <div style={{
            background: '#fff', padding: '16px 20px', borderRadius: 12,
            minWidth: 240, textAlign: 'center',
            border: `1px solid ${toast.type === 'ok' ? '#16a34a' : '#ef4444'}`
          }}>
            <b style={{ color: toast.type === 'ok' ? '#16a34a' : '#ef4444' }}>
              {toast.type === 'ok' ? 'Zalogowany' : 'Błąd'}
            </b>
            <div style={{ marginTop: 6 }}>{toast.msg}</div>
          </div>
        </div>
      )}
    </div>
  )
}
