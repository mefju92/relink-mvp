import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AuthLanding from './AuthLanding';
import Importer from './Importer';
import AuthCallback from './AuthCallback';

const apiBase = import.meta.env.VITE_API_URL;

export default function App() {
  const [session, setSession] = React.useState(null);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AuthLanding onAuthed={setSession} apiBase={apiBase} />} />
        <Route path="/app" element={<Importer apiBase={apiBase} />} />
        {/* strona docelowa po kliknięciu w link z maila Supabase */}
        <Route path="/auth/callback" element={<AuthCallback />} />
        {/* (opcjonalnie) fallback */}
        <Route path="*" element={<AuthLanding onAuthed={setSession} apiBase={apiBase} />} />
      </Routes>
    </BrowserRouter>
  );
}
