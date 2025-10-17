// relink-ui/src/features/import/ImportPage.jsx
// @ts-check
/** @typedef {import("../../types").TrackRow} TrackRow */
/** @typedef {import("../../types").FilterKey} FilterKey */
/** @typedef {import("../../types").SortKey}   SortKey */

import { useEffect, useMemo, useRef, useState } from "react";
import DataTable from "./components/DataTable.jsx";
import Stepper from "./components/Stepper.jsx";
import Toolbar from "./components/Toolbar.jsx";
import StickyBar from "./components/StickyBar.jsx";

const API = import.meta.env.VITE_API_URL;

export default function ImportPage() {
  const [rows, setRows] = useState([]);           // ✅ brak danych demo
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("title");

  // pickery plików/folderów
  const filesRef = useRef(null);
  const folderRef = useRef(null);

  function openFiles()  { filesRef.current?.click(); }
  function openFolder() { folderRef.current?.click(); }

  function toRow(file) {
    const id = typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : String(Date.now() + Math.random());
    return /** @type {TrackRow} */({
      id,
      status: "warn",                 // dopóki nie zmatchowane
      title: file.name,
      artist: "",
      album: "",
      time: "",
      spotifyUrl: "",
      added: false,
    });
  }

  /** @param {Event} ev */
  function onFilesSelected(ev) {
    const input = ev.target;
    // @ts-ignore
    const files = Array.from(input?.files || []);
    if (!files.length) return;
    setRows(prev => [...prev, ...files.map(toRow)]);
    // pozwól wybrać te same pliki ponownie
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

    list = [...list].sort((a, b) =>
      String(a?.[sort] ?? "").localeCompare(String(b?.[sort] ?? ""))
    );
    return list;
  }, [rows, query, filter, sort]);

  // counts
  const counts = useMemo(() => ({
    total: rows.length,
    matched: rows.filter((r) => r.status === "ok").length,
    unmatched: rows.filter((r) => r.status === "warn").length,
    selected: rows.filter((r) => r.added).length,
  }), [rows]);

  const allSelected = filtered.length > 0 && filtered.every((r) => r.added);

  // selection helpers
  function toggleRow(id, val) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, added: val } : r)));
  }
  function toggleAllOnFiltered(val) {
    const ids = new Set(filtered.map((r) => r.id));
    setRows((prev) => prev.map((r) => (ids.has(r.id) ? { ...r, added: val } : r)));
  }

  // actions (podłącz swoje API kiedy gotowe)
  async function uploadToCloud() {
    const ids = rows.filter((r) => r.added).map((r) => r.id);
    if (!ids.length) return;
    await fetch(`${API}/cloud/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  }
  async function deleteSelected() {
    const ids = rows.filter((r) => r.added).map((r) => r.id);
    if (!ids.length) return;
    await fetch(`${API}/files`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setRows((prev) => prev.filter((r) => !r.added));
  }
  async function createPlaylist(name) {
    const ids = rows.filter((r) => r.added).map((r) => r.id);
    if (!ids.length) return;
    await fetch(`${API}/playlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ids }),
    });
  }

  const showEmpty = rows.length === 0 && !query;

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      {/* Hidden file inputs */}
      <input
        ref={filesRef}
        type="file"
        className="sr-only"
        multiple
        accept="audio/*"
        onChange={onFilesSelected}
      />
      <input
        ref={folderRef}
        type="file"
        className="sr-only"
        multiple
        onChange={onFilesSelected}
        // Uwaga: folder picker – działa w Chromium/Edge
        webkitdirectory=""
        directory=""
      />

      <div className="mx-auto max-w-[1440px] px-8 py-6">
        {/* Header + Stepper */}
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-bold">ReLink</h1>
          <Stepper steps={["Files","Matching","Review","Playlists"]} current={1} />
          <span className="chip">Connected: GodWhale</span>
        </header>

        <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-card">
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
        </section>
      </div>
    </div>
  );
}

/** Empty state – czysta, dostępna, zachęca do akcji */
function EmptyState({ onAddFiles, onAddFolder }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="rounded-2xl border border-[var(--border)] bg-white p-6">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor" className="text-slate-300">
          <path d="M10 4H4a2 2 0 0 0-2 2v11a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V8a2 2 0 0 0-2-2h-7l-3-2z"/>
        </svg>
      </div>
      <h2 className="text-lg font-semibold">No tracks yet</h2>
      <p className="text-slate-600 max-w-[520px]">
        Add music files or a folder with audio to start matching and building playlists.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={onAddFiles}>Add files</button>
        <button type="button" className="btn btn-neutral" onClick={onAddFolder}>Add folder</button>
      </div>
      <p id="folder-help" className="text-xs text-slate-500">
        Folder picker works best in Chromium-based browsers.
      </p>
    </div>
  );
}
