/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  // dopisz tu inne zmienne jeśli używasz:
  // readonly VITE_SUPABASE_URL: string;
  // readonly VITE_SUPABASE_ANON_KEY: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
