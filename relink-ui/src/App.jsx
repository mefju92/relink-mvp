// relink-ui/src/App.jsx
import { useCallback, useState } from 'react';
import { supabase } from './supabaseClient';
import AuthLanding from './AuthLanding';
import Importer from './Importer';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:5174';

export default function App() {
  const [view, setView] = useState('landing'); // 'landing' | 'app'

  const handleAuthed = useCallback((_session) => {
    // Użytkownik zalogowany – zostawiamy na „landing”, bo tam jest też przycisk „Otwórz importera”
    // Jeśli chcesz automatycznie przenieść do importera:
    // setView('app');
  }, []);

  // Prosty router na podstawie ścieżki
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  if (path.startsWith('/app')) return <Importer />;

  return (
    <AuthLanding onAuthed={handleAuthed} apiBase={apiBase} />
  );


+ import AuthCallback from './AuthCallback';

<Routes>
  <Route path="/" element={<AuthLanding onAuthed={handleAuthed} apiBase={apiBase} />} />
+ <Route path="/auth/callback" element={<AuthCallback />} />
  <Route path="/app" element={<Importer apiBase={apiBase} />} />
</Routes>
}