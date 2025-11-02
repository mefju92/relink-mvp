// src/features/import/ImportPage.jsx
// @ts-check
/** @typedef {import("../../types").TrackRow} TrackRow */
/** @typedef {{ durationMs?: number, file?: File, spotifyId?: string }} ExtraRow */
/** @typedef {(TrackRow & ExtraRow)} UITrack */
/** @typedef {import("../../types").FilterKey} FilterKey */
/** @typedef {import("../../types").SortKey}   SortKey */

import { useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "./components/EmptyState.jsx";
import DataTable from "./components/DataTable.jsx";
import Stepper from "./components/Stepper.jsx";
import Toolbar from "./components/Toolbar.jsx";
import StickyBar from "./components/StickyBar.jsx";
import ConnectSpotifyButton from './components/ConnectSpotifyButton';
// ...
<ConnectSpotifyButton />


import { API_BASE, authHeaders, safeJson } from "../../lib/api";
import { cleanTitle, cleanArtist, readTagFromName, measureDurationMs, msToMMSS } from "../../lib/tracks";
import { supabase } from "../../supabaseClient";

export default function ImportPage() {
  /** @type {[UITrack[], import('react').Dispatch<import('react').SetStateAction<UITrack[]>>]} */
  const [rows, setRows] = useState([]);
  const [query, setQuery]   = useState("");
  const [filter, setFilter] = useState(/** @type {FilterKey} */("all"));
  const [sort, setSort]     = useState(/** @type {SortKey}   */("title"));

  const [isMatching, setIsMatching] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [playlistDone, setPlaylistDone] = useState(false);

  const [spName, setSpName] = useState(/** @type {string|null} */(null));
  const isSpotifyConnected = !!spName;

  // token Supabase do linku logowania
  const [authToken, setAuthToken] = useState("");
  const loginFrontend = `${window.location.origin}/app?spotify=ok`;
  const loginHref = authToken
    ? `${API_BASE}/spotify/login?frontend=${encodeURIComponent(loginFrontend)}&token=${encodeURIComponent(authToken)}`
    : "";

  // pickery plików/folderów
  /** @type {import('react').RefObject<HTMLInputElement>} */ const filesRef  = useRef(null);
  /** @type {import('react').RefObject<HTMLInputElement>} */ const folderRef = useRef(null);
  const openFiles  = () => filesRef.current?.click();
  const openFolder = () => folderRef.current?.click();

  // ---------------- Auth token (Supabase) ----------------
  useEffect(() => {
    let cancel = false;

    async function loadToken() {
      const { data } = await supabase.auth.getSession();
      if (!cancel) setAuthToken(data.session?.access_token || "");
    }
    loadToken();

    const sub = supabase.auth.onAuthStateChange((_evt, sess) => {
      setAuthToken(sess?.access_token || "");
    });

    return () => {
      cancel = true;
      sub.data.subscription.unsubscribe();
    };
  }, []);

  // ---------------- Spotify status ----------------
  async function refreshSpotifyStatus() {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_BASE}/spotify/status`, { headers });
      const txt = await res.text();
      // DEBUG – podejrzyj w Network/Console co wraca; usuń później
      console.log("[spotify/status]", res.status, txt);

      let data = null;
      try { data = JSON.parse(txt); } catch {}
      setSpName(data?.connected ? (data?.name || "Connected") : null);
    } catch {
      setSpName(null);
    }
  }

  // mount + powrót z ?spotify=ok + retry (sesja potrafi dojść chwilę później)
  useEffect(() => {
    let cancelled = false;

    const once = async () => {
      await refreshSpotifyStatus();
      if (cancelled) return;
      for (let i = 0; i < 3 && !cancelled && !spName; i++) {
        await wait(400);
        await refreshSpotifyStatus();
      }
    };

    // wyczyść znacznik z URL po powrocie
    const url = new URL(window.location.href);
    if (url.searchParams.get("spotify") === "ok") {
      url.searchParams.delete("spotify");
      window.history.replaceState({}, "", url.toString());
    }

    once();

    const sub = supabase.auth.onAuthStateChange(() => refreshSpotifyStatus());
    const onFocus = () => refreshSpotifyStatus();
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      cancelled = true;
      sub.data.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function disconnectSpotify() {
    if (!confirm("Odłączyć Spotify?")) return;
    try {
      const res = await fetch(`${API_BASE}/spotify/disconnect`, {
        method: "POST",
        headers: { ...(await authHeaders()) },
      });
      const data = await safeJson(res);
      if (!data?.ok) throw new Error(data?.error || "disconnect failed");
      setSpName(null);
      alert("Spotify disconnected");
    } catch (e) {
      alert(e?.message || "Disconnect failed");
    }
  }

  // ---------------- Files -> rows ----------------
  /** @param {File} file */
  async function toRow(file) {
    const { artist, title } = readTagFromName(file.name);
    const durationMs = await measureDurationMs(file);
    return /** @type {UITrack} */({
      id: crypto.randomUUID?.() || String(Date.now() + Math.random()),
      file,
      title,
      artist,
      album: "",
      time: msToMMSS(durationMs || 0),
      durationMs,
      status: "warn",
      spotifyUrl: "",
      spotifyId: "",
      added: false,
    });
  }

  /** @param {import('react').ChangeEvent<HTMLInputElement>} ev */
  async function onFilesSelected(ev) {
    const files = Array.from(ev.currentTarget.files || []);
    if (!files.length) return;
    const mapped = /** @type {UITrack[]} */(await Promise.all(files.map(toRow)));
    setRows(prev => [...prev, ...mapped]);
    setPlaylistDone(false);
    ev.currentTarget.value = ""; // reset inputa
  }

  // ---------------- Filtering & sorting ----------------
  const filtered = useMemo(() => {
    let list = rows;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(r =>
        (r.title  || "").toLowerCase().includes(q) ||
        (r.artist || "").toLowerCase().includes(q) ||
        (r.album  || "").toLowerCase().includes(q)
      );
    }
    if (filter === "matched")   list = list.filter(r => r.status === "ok");
    if (filter === "unmatched") list = list.filter(r => r.status === "warn");
    return [...list].sort((a, b) => String(a?.[sort] ?? "").localeCompare(String(b?.[sort] ?? "")));
  }, [rows, query, filter, sort]);

  // wybór wierszy
  function toggleRow(id, val) {
    setRows(prev => prev.map(r => (r.id === id ? { ...r, added: val } : r)));
  }
  function toggleAllOnFiltered(val) {
    const ids = new Set(filtered.map(r => r.id));
    setRows(prev => prev.map(r => (ids.has(r.id) ? { ...r, added: val } : r)));
  }
  const allSelected = filtered.length > 0 && filtered.every(r => r.added);

  // ---------------- Matching ----------------
  async function runMatching() {
    if (!rows.length || isMatching || !isSpotifyConnected) return;
    setIsMatching(true);
    try {
      const payload = {
        tracks: rows.map(r => ({
          title: cleanTitle(r.title || ""),
          artist: cleanArtist(r.artist || ""),
          durationMs: r.durationMs || 0,
        })),
      };

      // 1) start
      const start = await fetch(`${API_BASE}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(payload),
      });
      const startData = await safeJson(start);
      if (!start.ok || startData?.ok === false) {
        const msg = startData?.error || `HTTP ${start.status}`;
        throw new Error(`Match start failed: ${msg}`);
      }

      // 2) polling
      for (;;) {
        const res  = await fetch(`${API_BASE}/match/progress`, { headers: { ...(await authHeaders()) } });
        const data = await safeJson(res);

        if (!data.exists) break;
        if (data.error) throw new Error(data.error);
        if (!data.done) { await wait(600); continue; }

        // 3) wyniki
        const results = data.results?.results || [];
        setRows(prev => prev.map((r, i) => {
          const m = results[i];
          if (!m || !m.matched) {
            return { ...r, status: "warn", spotifyUrl: "", spotifyId: "" };
          }
          return {
            ...r,
            status: "ok",
            spotifyUrl: m.spotifyUrl || r.spotifyUrl,
            spotifyId: m.spotifyId || r.spotifyId,
            artist:    r.artist || m.artists || r.artist,
            album:     r.album  || m.album   || r.album,
            time:      r.time   || (m.durationMs ? msToMMSS(m.durationMs) : r.time),
          };
        }));
        break;
      }
    } catch (e) {
      console.error(e);
      alert(e.message || "Matching failed");
    } finally {
      setIsMatching(false);
    }
  }

  // ---------------- Upload / Delete / Playlist ----------------
  async function uploadToCloud() {
    const files = rows.filter(r => r.added && r.file).map(r => r.file);
    if (!files.length) return alert("Zaznacz pliki do chmury.");

    const form = new FormData();
    files.forEach(f => form.append("files", f, f.name));

    try {
      const res  = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        headers: { ...(await authHeaders()) },
        body: form,
      });
      const data = await safeJson(res);
      if (!res.ok || data?.ok === false) throw new Error(data.error || "upload failed");
      alert(`Przeniesiono ${data.files?.filter(x => x.ok).length ?? files.length} plików`);
    } catch (e) {
      alert(e.message || "Upload failed");
    }
  }

  async function deleteSelected() {
    const ids = rows.filter(r => r.added).map(r => r.id);
    if (!ids.length) return;
    setRows(prev => prev.filter(r => !ids.includes(r.id)));
    try {
      await fetch(`${API_BASE}/files`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ ids }),
      });
    } catch (e) {
      console.warn("Delete API failed:", e);
    }
  }

  async function createPlaylist(name) {
    const uris = rows.filter(r => r.added && r.spotifyId).map(r => `spotify:track:${r.spotifyId}`);
    if (!uris.length) return alert("Zaznacz dopasowane utwory.");
    if (!name.trim()) return alert("Podaj nazwę playlisty.");
    try {
      const res  = await fetch(`${API_BASE}/playlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ name, trackUris: uris }),
      });
      const data = await safeJson(res);
      if (!res.ok || data?.ok === false) throw new Error(data.error || "playlist failed");
      setPlaylistDone(true);
      if (data.playlistUrl) window.open(data.playlistUrl, "_blank", "noreferrer");
      else alert("Playlist utworzona.");
    } catch (e) {
      alert(e.message || "Create playlist failed");
    }
  }

  // ---------------- Stepper (kropki) ----------------
  const filesDone     = rows.length > 0;
  const matchingDone  = rows.some(r => r.status === "ok");
  const playlistsDone = playlistDone;

  // Uwaga: Stepper jest 1-based
  const currentStep = !filesDone ? 1 : !matchingDone ? 2 : 3;

  const showEmpty = rows.length === 0 && !query;
  const selectedMatched = rows.filter(r => r.added && r.status === "ok");

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      {/* Hidden inputs */}
      <input ref={filesRef} type="file" className="sr-only" multiple accept="audio/*" onChange={onFilesSelected} />
      <input
        ref={folderRef}
        type="file"
        className="sr-only"
        multiple
        onChange={onFilesSelected}
        {.../** @type {any} */ ({ webkitdirectory: "", directory: "" })}
      />

      <div className="mx-auto max-w-[1440px] px-8 py-6">
        {/* Header: tytuł + connect/disconnect */}
        <header className="relative z-10 flex items-center justify-between">
          <h1 className="text-xl font-bold">ReLink</h1>

          <div className="flex items-center gap-3">
            {isSpotifyConnected ? (
              <>
                <span className="chip">Connected: {spName}</span>
                <button type="button" className="btn btn-neutral" onClick={disconnectSpotify}>
                  Disconnect
                </button>
              </>
            ) : (
              <a
                className={`btn ${authToken ? "btn-primary" : "btn-disabled"}`}
                href={authToken ? loginHref : undefined}
                onClick={(e) => { if (!authToken) e.preventDefault(); }}
                title={authToken ? "Connect your Spotify account" : "Loading auth…"}
              >
                Connect Spotify
              </a>
            )}
          </div>
        </header>

        {/* Stepper – na środku własny wiersz */}
        <div className="mt-4 flex justify-center">
          <Stepper
            steps={["Files", "Matching", "Playlists"]}
            current={currentStep}
            done={[filesDone, matchingDone, playlistsDone]}
          />
        </div>

        <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-card relative">
          <div className="border-b border-[var(--border)] p-4">
            <Toolbar
              query={query}
              onQueryChange={setQuery}
              counts={{
                total: rows.length,
                matched: rows.filter(r => r.status === "ok").length,
                unmatched: rows.filter(r => r.status === "warn").length,
              }}
              filter={filter}
              onFilterChange={(v) => setFilter(v)}
              onSortClick={() => setSort("title")}
              onSelectAll={() => toggleAllOnFiltered(true)}
              onAddFiles={openFiles}
              onAddFolder={openFolder}
              onMatch={runMatching}
              canMatch={rows.length > 0}
              isMatching={isMatching}
              isSpotifyConnected={isSpotifyConnected}
            />
          </div>

          {showEmpty ? (
            <EmptyState onAddFiles={openFiles} onAddFolder={openFolder} />
          ) : (
            <>
              <DataTable
                rows={filtered}
                onToggleRow={toggleRow}
                onToggleAll={toggleAllOnFiltered}
                allSelected={allSelected}
              />
              <StickyBar
                selected={rows.filter(r => r.added).length}
                onUpload={uploadToCloud}
                onUndo={() => window.history.back()}
                onDelete={deleteSelected}
                playlistName={playlistName}
                onPlaylistNameChange={setPlaylistName}
                canCreate={isSpotifyConnected && selectedMatched.length > 0 && !!playlistName.trim()}
                onCreate={() => createPlaylist(playlistName)}
              />
            </>
          )}

          {isMatching && (
            <div className="absolute inset-0 grid place-items-center bg-white/60 backdrop-blur-sm">
              <div className="rounded-xl border border-[var(--border)] bg-white px-4 py-3 text-sm text-slate-600 shadow-card">
                <span className="inline-block h-4 w-4 animate-spin border-2 border-slate-300 border-t-slate-600 rounded-full mr-2" />
                Matching in progress…
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** utils */
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }
