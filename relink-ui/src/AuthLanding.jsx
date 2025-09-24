// relink-ui/src/AuthLanding.jsx
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export default function AuthLanding({ onAuthed, apiBase }) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) onAuthed(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) onAuthed(session);
    });
    return () => sub.subscription.unsubscribe();
  }, [onAuthed]);

  async function signup(e) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error } = await supabase.auth.signUp({
      email,
      password: pass,
      options: {
        emailRedirectTo: window.location.origin, // po kliknięciu w e-mail
      },
    });
    setLoading(false);
    if (error) setMsg(`Błąd rejestracji: ${error.message}`);
    else setMsg('Rejestracja OK. Sprawdź skrzynkę i potwierdź adres e-mail.');
  }

  async function login(e) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const { error, data } = await supabase.auth.signInWithPassword({ email, password: pass });
    setLoading(false);
    if (error) setMsg(`Błąd logowania: ${error.message}`);
    else {
      setMsg('Zalogowano.');
      // poproś backend o „bootstrap” chmury (folder w storage)
      const token = data.session?.access_token;
      try {
        await fetch(`${apiBase}/api/bootstrap`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) { /* no-op w MVP */ }
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  async function connectSpotify() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const url = `${apiBase}/spotify/login`;
    // backend zweryfikuje token z Bearer
    window.location.href = url + `?frontend=${encodeURIComponent(window.location.origin)}`;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div style={{maxWidth: 940, width: '100%'}}>
        <h1 style={{fontSize: 36, fontWeight: 800, marginBottom: 12}}>
          Odtwórz z nami swoją dawną playlistę 🎵
        </h1>
        <p style={{color: '#666', marginBottom: 28}}>
          Dopasujemy Twoje lokalne pliki do Spotify, stworzymy playlistę i zachowamy resztę w Twojej prywatnej chmurze.
        </p>

        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:24}}>
          <div style={{border:'1px solid #eee', padding: 20, borderRadius:12}}>
            <div style={{display:'flex', gap:8, marginBottom:12}}>
              <button
                onClick={() => setMode('login')}
                style={{padding:'6px 12px', borderRadius:8, border:'1px solid #ddd', background: mode==='login'?'#f4f4f4':'#fff'}}
              >Logowanie</button>
              <button
                onClick={() => setMode('signup')}
                style={{padding:'6px 12px', borderRadius:8, border:'1px solid #ddd', background: mode==='signup'?'#f4f4f4':'#fff'}}
              >Rejestracja</button>
            </div>

            <form onSubmit={mode==='login'?login:signup}>
              <label style={{display:'block', fontSize:12, color:'#555'}}>E-mail</label>
              <input value={email} onChange={e=>setEmail(e.target.value)}
                required type="email" placeholder="twoj@email.pl"
                style={{width:'100%', padding:'10px 12px', border:'1px solid #ddd', borderRadius:8, marginBottom:10}}
              />
              <label style={{display:'block', fontSize:12, color:'#555'}}>Hasło</label>
              <input value={pass} onChange={e=>setPass(e.target.value)}
                required type="password" placeholder="••••••••"
                style={{width:'100%', padding:'10px 12px', border:'1px solid #ddd', borderRadius:8, marginBottom:14}}
              />
              <button disabled={loading}
                style={{width:'100%', padding:'12px 14px', borderRadius:8, border:'none', background:'#111', color:'#fff', fontWeight:700}}>
                {mode==='login' ? 'Zaloguj się' : 'Zarejestruj się'}
              </button>
            </form>

            {msg && <p style={{marginTop:12, color:'#333'}}>{msg}</p>}

            <hr style={{margin:'16px 0'}}/>

            <button onClick={connectSpotify}
              style={{width:'100%', padding:'10px 12px', borderRadius:8, border:'1px solid #1DB954', color:'#1DB954', background:'#fff', fontWeight:700}}>
              Połącz konto Spotify
            </button>

            <button onClick={logout}
              style={{marginTop:8, width:'100%', padding:'10px 12px', borderRadius:8, border:'1px solid #ddd', background:'#fff'}}>
              Wyloguj
            </button>
          </div>

          <div style={{border:'1px solid #eee', padding: 20, borderRadius:12}}>
            <h3 style={{marginTop:0}}>Już zalogowany?</h3>
            <p style={{color:'#555'}}>Przejdź do importu i dopasowania.</p>
            <a href="/app"
              style={{display:'inline-block', marginTop:8, padding:'10px 14px', background:'#111', color:'#fff', borderRadius:8, textDecoration:'none'}}>
              Otwórz importera
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
