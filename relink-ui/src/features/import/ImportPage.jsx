// @ts-check
/** @typedef {import("../../types").TrackRow} TrackRow */
/** @typedef {import("../../types").FilterKey} FilterKey */
/** @typedef {import("../../types").SortKey}   SortKey */



import { useEffect, useMemo, useState } from "react";
import DataTable from "./components/DataTable.jsx"; // ważne: .jsx

const API = import.meta.env.VITE_API_URL; // np. http://localhost:5174

export default function ImportPage() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");     // "all" | "matched" | "unmatched"
  const [sort, setSort] = useState("title");       // "title" | "artist" | "album" | "time"

  // demo – w prawdziwym kodzie: fetch z backendu lub rezultat skanowania
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

    // prosty sort po wybranym kluczu
    list = [...list].sort((a, b) => {
      const va = a?.[sort] ?? "";
      const vb = b?.[sort] ?? "";
      return String(va).localeCompare(String(vb));
    });

    return list;
  }, [rows, query, filter, sort]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      matched: rows.filter((r) => r.status === "ok").length,
      unmatched: rows.filter((r) => r.status === "warn").length,
      selected: rows.filter((r) => r.added).length,
    }),
    [rows]
  );

  function toggleRow(id, val) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, added: val } : r)));
  }
  function toggleAll(val) {
    setRows((prev) => prev.map((r) => ({ ...r, added: val })));
  }

  // Hooki do backendu – podmień URL-e na swoje endpointy
  async function scanAndMatch(folderPath) {
    const res = await fetch(`${API}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: folderPath }),
    });
    const data = await res.json();
    setRows(data);
  }

  async function createPlaylist(name) {
    const ids = rows.filter((r) => r.added).map((r) => r.id);
    await fetch(`${API}/playlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, ids }),
    });
  }

  async function uploadToCloud() {
    const ids = rows.filter((r) => r.added).map((r) => r.id);
    await fetch(`${API}/cloud/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  }

  async function deleteSelected() {
    const ids = rows.filter((r) => r.added).map((r) => r.id);
    await fetch(`${API}/files`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setRows((prev) => prev.filter((r) => !r.added));
  }

  const allSelected = filtered.length > 0 && filtered.every((r) => r.added);

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-[1440px] px-8 py-6">
        {/* prosty toolbar (możesz podmienić na komponent Toolbar.jsx) */}
        <div className="mb-3 flex items-center gap-3">
          <div className="relative">
            <input
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-[360px] rounded-xl border border-[var(--border)] bg-white px-3 py-2 outline-none focus-visible:ring-2"
            />
          </div>

          <div className="seg" role="tablist" aria-label="Filters">
            <button aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
              All ({counts.total})
            </button>
            <button aria-pressed={filter === "matched"} onClick={() => setFilter("matched")}>
              Matched ({counts.matched})
            </button>
            <button aria-pressed={filter === "unmatched"} onClick={() => setFilter("unmatched")}>
              Unmatched ({counts.unmatched})
            </button>
          </div>

          <button className="btn btn-neutral" onClick={() => setSort("title")}>
            Sort: Title
          </button>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-white shadow-card">
          <DataTable
            rows={filtered}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            allSelected={allSelected}
          />

          {/* Sticky action bar (możesz podmienić na StickyBar.jsx) */}
          <div className="sticky bottom-0 z-10 w-full border-t border-[var(--border)] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <button className="btn btn-neutral" onClick={uploadToCloud}>
                  Upload to cloud ({counts.selected})
                </button>
              </div>
              <div className="flex items-center gap-3">
                <button className="btn btn-danger" onClick={deleteSelected} disabled={!counts.selected}>
                  Delete ({counts.selected})
                </button>
                <button
                  className={`btn btn-primary ${!counts.selected ? "btn-disabled" : ""}`}
                  onClick={() => createPlaylist("ReLink Import")}
                  disabled={!counts.selected}
                >
                  Create playlist ({counts.selected})
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
