// src/lib/api.js
import { supabase } from "../supabaseClient"; // jeśli nie używasz supabase – usuń i zwracaj {} w authHeaders

export const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, ""); // bez końcowego '/'

export async function authHeaders() {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export async function safeJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`HTTP ${res.status}. Body starts with: ${text.slice(0,120)}`); }
}
