import { supabase } from '../supabaseClient';

export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export async function authHeaders() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return {};
    const t = data?.session?.access_token;
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

export async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`HTTP ${res.status}. Body starts with: ${text.slice(0,120)}`); }
}
