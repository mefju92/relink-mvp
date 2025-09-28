// relink-ui/src/App.jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthLanding from './AuthLanding'
import Importer from './Importer'
import AuthCallback from './AuthCallback'

const apiBase = (
  import.meta.env?.VITE_API_BASE ||
  import.meta.env?.VITE_API_URL ||
  'https://relink-mvp.onrender.com'
).replace(/\/+$/, '')

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AuthLanding />} />
        <Route path="/app" element={<Importer apiBase={apiBase} />} />
        {/* jeśli używasz linków e-mail z Supabase */}
        <Route path="/auth/callback" element={<AuthCallback />} />
        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
