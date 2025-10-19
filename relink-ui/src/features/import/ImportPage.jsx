// src/features/import/ImportPage.jsx
// @ts-check
/** @typedef {import("../../types").TrackRow} TrackRow */
/** @typedef {import("../../types").FilterKey} FilterKey */
/** @typedef {import("../../types").SortKey}   SortKey */

import EmptyState from "./components/EmptyState.jsx";
import { useMemo, useRef, useState } from "react";
import DataTable from "./components/DataTable.jsx";
import Stepper from "./components/Stepper.jsx";
import Toolbar from "./components/Toolbar.jsx";
import StickyBar from "./components/StickyBar.jsx";

const API = import.meta.env.VITE_API_URL;

export default function ImportPage() {
const [rows, setRows]   = useState(/** @type {TrackRow[]} */([]));
const [query, setQuery] = useState("");
const [filter, setFilter] = useState(/** @type {FilterKey} */("all"));
const [sort, setSort]     = useState(/** @type {SortKey} */("title"));

  const [isMatching, setIsMatching] = useState(false);

  // pickery plików/folderów
  const filesRef = useRef(/** @type {HTMLInputElement|null} */(null));
  const folderRef = useRef(/** @type {HTMLInputElement|null} */(null));
  function openFiles()  { filesRef.current?.click(); }
  function openFolder() { folderRef.current?.click(); }

// usuń całą funkcję toRow(...) – nie będzie już potrzebna

/** @param {import('react').ChangeEvent<HTMLInputElement>} ev */
async function onFilesSelected(ev) {
  const input = ev.currentTarget;
  const files = Array.from(input?.files || []);
  if (!files.length) return;

  const rowsToAdd = await Promise.all(
    files.map(async (file) => {
      const { artist, title } = cleanFilename(file.name);
      const durSec = await getAudioDurationSec(file).catch(() => undefined);
      const id = typeof crypto?.randomUUID === "function"
        ? crypto.randomUUID()
        : String(Date.now() + Math.random());

      return /** @type {TrackRow} */ ({
        id,
        status: "warn",
        title,
        artist,
        album: "",
        time: durSec ? secToMMSS(durSec) : "",
        spotifyUrl: "",
        added: false,
      });
    })
  );

  setRows((prev) => [...prev, ...rowsToAdd]);
  input.value = ""; // reset
}

async function deleteSelected() {
  // jeżeli masz backend – wyślij tam listę rekordów do skasowania
  const toDelete = rows.filter(r => r.added);
  if (toDelete.length === 0) return;

  try {
    if (API) {
      await fetch(`${API}/files`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: toDelete.map(r => r.id) }),
      });
    }
  } catch (e) {
    console.warn("Delete API failed, removing locally only.", e);
  } finally {
    // zawsze zdejmij ze stanu, żeby UI reagował natychmiast
    setRows(prev => prev.filter(r => !r.added));
  }
}

async function createPlaylist(name) {
  const selected = rows.filter(r => r.added);
  if (selected.length === 0) return;

  const payload = {
    name,
    // pod backend – dajemy wszystko co mamy; backend wybierze co chce
    tracks: selected.map(r => ({
      id: r.id,
      title: r.title,
      artist: r.artist || "",
      spotifyUrl: r.spotifyUrl || "",
      durationSec: r.time ? Number(r.time.split(":")[0]) * 60 + Number(r.time.split(":")[1]) : undefined,
    })),
  };

  try {
    if (!API) {
      console.warn("VITE_API_URL nie ustawione – tylko loguję payload:", payload);
      return;
    }
    const res = await fetch(`${API}/playlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    // UX: po sukcesie wyczyść zaznaczenia
    setRows(prev => prev.map(r => r.added ? { ...r, added: false } : r));
  } catch (e) {
    console.error("Create playlist failed", e);
  }
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
            matchScore: m.score, // pole dodatkowe – OK
          };
        })
      );
    } catch (e) {
      console.error("Matching error", e);
      // TODO: dodać toast/alert
    } finally {
      setIsMatching(false);
    }
  }

  // helpers
function cleanFilename(name) {
  // usuń rozszerzenie
  const noExt = name.replace(/\.[a-z0-9]{2,4}$/i, "");
  // usuń śmieci typu "official video", "copy (1)", itp., ale zostaw info o remixie/wersji
  const keepTag = (t="") => /mix|remix|edit|extended|radio|version|alt/i.test(t);
  const stripped = noExt
    .replace(/\s*copy\s*\(\d+\)/ig, "")
    .replace(/\s*(official|audio|video|lyrics|hq|hd)\b/ig, "")
    .replace(/\s*[\[\(]([^)\]]+)[\]\)]/g, (_, t) => keepTag(t) ? ` (${t})` : "") // tylko ważne tagi
    .replace(/\s{2,}/g, " ")
    .trim();

  // "Artist - Title"
  const parts = stripped.split(/\s-\s/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }
  return { artist: "", title: stripped };
}

function secToMMSS(sec) {
  const s = Math.round(sec || 0);
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// proste pobranie długości z HTMLAudioElement (bez dodatkowych bibliotek)
function getAudioDurationSec(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    a.src = url;
    a.onloadedmetadata = () => {
      const d = isFinite(a.duration) ? a.duration : 0;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    a.onerror = () => { URL.revokeObjectURL(url); resolve(undefined); };
  });
}


  // actions (upload/delete/playlist) – wypełnij swoimi endpointami
  async function uploadToCloud() { /* ... */ }
  async function deleteSelected() { /* ... */ }
  async function createPlaylist(name) { /* ... */ }

  const showEmpty = rows.length === 0 && !query;

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      {/* Hidden inputs */}
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
        {.../** @type {any} */ ({ webkitdirectory: "", directory: "" })}
      />

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
