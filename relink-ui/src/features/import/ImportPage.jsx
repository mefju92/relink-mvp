// relink-ui/src/features/import/ImportPage.jsx
// @ts-check
/** @typedef {import("../../types").TrackRow} TrackRow */
/** @typedef {import("../../types").FilterKey} FilterKey */
/** @typedef {import("../../types").SortKey}   SortKey */

import EmptyState from "./components/EmptyState.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import DataTable from "./components/DataTable.jsx";
import Stepper from "./components/Stepper.jsx";
import Toolbar from "./components/Toolbar.jsx";
import StickyBar from "./components/StickyBar.jsx";

const API = import.meta.env.VITE_API_URL;

export default function ImportPage() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("title");
  const [isMatching, setIsMatching] = useState(false);

  // pickery plików/folderów (jak wcześniej) …
  const filesRef = useRef(null);
  const folderRef = useRef(null);
  function openFiles()  { filesRef.current?.click(); }
  function openFolder() { folderRef.current?.click(); }

  function toRow(file) {
    const id = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : String(Date.now() + Math.random());
    return /** @type {TrackRow} */({
      id, status: "warn", title: file.name, artist: "", album: "", time: "", spotifyUrl: "", added: false,
    });
  }
  function onFilesSelected(ev) {
    const input = ev.target;
    // @ts-ignore
    const files = Array.from(input?.files || []);
    if (!files.length) return;
    setRows(prev => [...prev, ...files.map(toRow)]);
    // @ts-ignore
    input.value = "";
  }

  // filter + sort
  const filtered = useMemo(() => {
    let list = rows;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((r) =>
        (r.title || "").toLowerCase().includes(q) ||
        (r.artist || "").toLowerCase().includes(q) ||
        (r.album || "").toLowerCase().includes(q)
      );
    }
    if (filter === "matched") list = list.filter((r) => r.status === "ok");
    if (filter === "unmatched") list = list.filter((r) => r.status === "warn");
    list = [...list].sort((a, b) => String(a?.[sort] ?? "").localeCompare(String(b?.[sort] ?? "")));
    return list;
  }, [rows, query, filter, sort]);

  const counts = useMemo(() => ({
    total: rows.length,
    matched: rows.filter((r) => r.status === "ok").length,
    unmatched: rows.filter((r) => r.status === "warn").length,
    selected: rows.filter((r) => r.added).length,
  }), [rows]);

  const allSelected = filtered.length > 0 && filtered.every((r) => r.added);

  // selection
  function toggleRow(id, val) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, added: val } : r)));
  }
  function toggleAllOnFiltered(val) {
    const ids = new Set(filtered.map((r) => r.id));
    setRows((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, added: val } : r)));
  }

  // --- MATCHING ---
  function parseTimeToSec(t) {
    if (!t) return undefined;
    const m = /^(\d+):(\d{2})$/.exec(t.trim());
    if (!m) return undefined;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  function fmtMs(ms) {
    if (!ms && ms !== 0) return "";
    const s = Math.round(ms / 1000);
    const mm = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  async function runMatching() {
    if (!rows.length || isMatching) return;
    setIsMatching(true);
    try {
      const payload = {
        tracks: rows.map((r) => ({
          id: r.id,
          title: r.title,
          artist: r.artist || "",
          durationSec: parseTimeToSec(r.time) ?? undefined,
        })),
      };

      const res = await fetch(`${API}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json(); // { matches: [...] }

      const byId = new Map((data?.matches || []).map((m) => [m?.id || m?.localId || m?.title, m]));
      setRows((prev) =>
        prev.map((r) => {
          const m = byId.get(r.id) || byId.get(r.title);
          if (!m || !m.spotify) {
            return { ...r, status: "warn", spotifyUrl: "" };
          }
          const sp = m.spotify;
          return {
            ...r,
            status: "ok",
            spotifyUrl: sp.url || r.spotifyUrl,
            artist: r.artist || sp.artist || r.artist,
            album: r.album || sp.album || r.album,
            time: r.time || fmtMs(sp.durationMs),
            matchScore: m.score,
          };
        })
      );
    } catch (e) {
      console.error("Matching error", e);
      // tu możesz dorzucić lekki toast/alert
    } finally {
      setIsMatching(false);
    }
  }

  // actions (upload/delete/playlist) – jak wcześniej…
  async function uploadToCloud() { /* ... */ }
  async function deleteSelected() { /* ... */ }
  async function createPlaylist(name) { /* ... */ }

  const showEmpty = rows.length === 0 && !query;

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      {/* Hidden inputs */}
      <input ref={filesRef} type="file" className="sr-only" multiple accept="audio/*" onChange={onFilesSelected} />
      <input ref={folderRef} type="file" className="sr-only" multiple onChange={onFilesSelected} webkitdirectory="" directory="" />

      <div className="mx-auto max-w-[1440px] px-8 py-6">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-bold">ReLink</h1>
          <Stepper steps={["Files","Matching","Review","Playlists"]} current={1} />
          <span className="chip">Connected: GodWhale</span>
        </header>

        <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-card relative">
          <div className="border-b border-[var(--border)] p-4">
            <Toolbar
              query={query}
              onQueryChange={setQuery}
              counts={counts}
              filter={filter}
              onFilterChange={setFilter}
              onSortClick={() => setSort("title")}
              onSelectAll={() => toggleAllOnFiltered(true)}
              onAddFiles={openFiles}
              onAddFolder={openFolder}
              onMatch={runMatching}
              canMatch={rows.length > 0}
              isMatching={isMatching}
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
                selected={counts.selected}
                onUpload={uploadToCloud}
                onUndo={() => window.history.back()}
                onDelete={deleteSelected}
                onCreate={() => createPlaylist("ReLink Import")}
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

/* EmptyState jak wcześniej (możesz zostawić bez zmian) */
