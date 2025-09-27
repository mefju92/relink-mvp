import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AuthLanding from './AuthLanding';
import Importer from './Importer';
import AuthCallback from './AuthCallback';

// Używamy reverse-proxy Netlify -> Render.
// Bazowy URL zostawiamy pusty, dzięki czemu wołamy względnie: "/api/..."
const apiBase = '';

export default function App() {
  const [session, setSession] = React.useState(null);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AuthLanding onAuthed={setSession} apiBase={apiBase} />} />
        <Route path="/app" element={<Importer apiBase={apiBase} />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="*" element={<AuthLanding onAuthed={setSession} apiBase={apiBase} />} />
      </Routes>
    </BrowserRouter>
  );
}
