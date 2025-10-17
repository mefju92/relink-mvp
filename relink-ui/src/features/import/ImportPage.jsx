// @ts-check
/** @typedef {import("../../types").TrackRow} TrackRow */
/** @typedef {import("../../types").FilterKey} FilterKey */
/** @typedef {import("../../types").SortKey}   SortKey */

import { useEffect, useMemo, useState } from "react";
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
  useEffect(() => {
    setRows([
      { id: "1", status: "warn", title: "Lights Out (Original Mix).mp3", artist: "4 Strings", album: "Lights Out", time: "4:32", spotifyUrl: "", added: false },
      { id: "2", status: "ok",   title: "Youngblood (Alt Version).mp3",   artist: "5 Seconds Of Summer", album: "Youngblood", time: "3:27", spotifyUrl: "#", added: true },
    ]);
  }, []);

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

  function toggleRow(id, val)   { setRows((prev) => prev.map((r) => (r.id === id ? { ...r, added: val } : r))); }
  function toggleAll(val)       { setRows((prev) => prev.map((r) => ({ ...r, added: val }))); }
  async function uploadToCloud(){ /* ... jak masz ... */ }
  async function deleteSelected(){
    const ids = rows.filter((r) => r.added).map((r) => r.id);
    await fetch(`${API}/files`, { method:"DELETE", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ ids }) });
    setRows((prev) => prev.filter((r) => !r.added));
  }
  async function createPlaylist(name){ /* ... jak masz ... */ }

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-[1440px] px-8 py-6">
        {/* Header + Stepper */}
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-bold">ReLink</h1>
          <Stepper steps={["Files","Matching","Review","Playlists"]} current={1} />
          <span className="chip">Connected: GodWhale</span>
        </header>

        {/* Card: Toolbar + Table + StickyBar */}
        <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-card">
          <div className="border-b border-[var(--border)] p-4">
            <Toolbar
              query={query}
              onQueryChange={setQuery}
              counts={counts}
              filter={filter}
              onFilterChange={setFilter}
              onSortClick={() => setSort("title")}
              onSelectAll={() => toggleAll(true)}
            />
          </div>

          <DataTable
            rows={filtered}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            allSelected={allSelected}
          />

          <StickyBar
            selected={counts.selected}
            onUpload={uploadToCloud}
            onUndo={() => window.history.back()}
            onDelete={deleteSelected}
            onCreate={() => createPlaylist("ReLink Import")}
          />
        </section>
      </div>
    </div>
  );
}
