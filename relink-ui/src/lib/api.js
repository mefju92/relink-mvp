// src/lib/api.js
import { supabase } from "../supabaseClient";

export const API_BASE = import.meta.env.VITE_API_BASE; // np. https://relink-mvp.onrender.com/api

export async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok:false, error:text || `HTTP ${res.status}` }; }
}
