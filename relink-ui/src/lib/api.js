// src/lib/api.js
import { supabase } from "../supabaseClient";

// Pozwala w env mieć zarówno https://.../api jak i https://...
const RAW = (import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
export const API_BASE = RAW.endsWith("/api") ? RAW.slice(0, -4) : RAW;   // https://relink-mvp.onrender.com
export const API      = `${API_BASE}/api`;                                // https://relink-mvp.onrender.com/api

export async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function safeJson(res) {
  const t = await res.text();
  try { return JSON.parse(t); }
  catch { throw new Error(`HTTP ${res.status}. Body starts with: ${t.slice(0, 120)}`); }
}
