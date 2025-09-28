// relink-ui/src/App.jsx
import React from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { supabase } from './supabaseClient';
import AuthLanding from './AuthLanding';
import Importer from './Importer';
import AuthCallback from './AuthCallback';

// 1) API base z env lub fallback na Render
const apiBase = (import.meta.env?.VITE_API_URL || 'https://relink-mvp.onrender.com').replace(/\/+$/, '');

// --- Route guard: wpuszcza tylko zalogowanych ---
function RequireAuth({ children }) {
  const navigate = useNavigate();
  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    let alive = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data?.session) {
        navigate('/', { replace: true });        // brak sesji -> wracamy do logowania
      } else if (alive) {
        setChecking(false);
      }
    })();

    // reaguj na wylogowanie w locie
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => {
      if (!session) navigate('/', { replace: true });
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [navigate]);

  if (checking) return null; // krótka chwila, nic nie renderujemy
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* STRONA LOGOWANIA */}
        <Route path="/" element={<AuthLanding apiBase={apiBase} />} />

        {/* IMPORTER – tylko dla zalogowanych */}
        <Route
          path="/app"
          element={
            <RequireAuth>
              <Importer apiBase={apiBase} />
            </RequireAuth>
          }
        />

        {/* Docelowa strona po linkach z maili Supabase */}
        <Route path="/auth/callback" element={<AuthCallback />} />

        {/* Fallback */}
        <Route
          path="*"
          element={<AuthLanding apiBase={apiBase} />}
        />
      </Routes>
    </BrowserRouter>
  );
}
