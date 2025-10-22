// relink-ui/src/features/import/components/DataTable.jsx
// @ts-check
import { useEffect, useRef, useState } from "react";
/** @typedef {import("../../../types").TrackRow} TrackRow */

/**
 * @typedef {{
 *   rows: TrackRow[],
 *   onToggleRow: (id: string, val: boolean) => void,
 *   onToggleAll: (val: boolean) => void,
 *   allSelected: boolean
 * }} Props
 */

/** @param {Props} props */
export default function DataTable({ rows = [], onToggleRow, onToggleAll, allSelected = false }) {
  // --- sticky header shadow ---
  const wrapRef = useRef(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onScroll = () => setStuck(el.scrollTop > 0);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div ref={wrapRef} className="relative overflow-auto">
      <table className="table">
        <thead>
          <tr className="row">
            <th className={`th sticky-left w-[56px] px-4 text-left ${stuck ? "shadow-stuck" : ""}`}>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-[var(--border)] text-[var(--primary)] focus-visible:ring-2"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={(e) => onToggleAll?.(e.currentTarget.checked)}
                />
              </label>
            </th>
            <th className={`th w-[160px] text-left px-3 ${stuck ? "shadow-stuck" : ""}`}>Status</th>
            <th className={`th text-left px-3 ${stuck ? "shadow-stuck" : ""}`}>Title</th>
            <th className={`th w-[220px] text-left px-3 ${stuck ? "shadow-stuck" : ""}`}>Artist</th>
            <th className={`th w-[220px] text-left px-3 ${stuck ? "shadow-stuck" : ""}`}>Album</th>
            <th className={`th w-[90px] text-left px-3 ${stuck ? "shadow-stuck" : ""}`}>Length</th>
            <th className={`th w-[180px] text-left px-3 ${stuck ? "shadow-stuck" : ""}`}>Spotify</th>
            <th className={`th sticky-right w-[140px] text-left px-4 ${stuck ? "shadow-stuck" : ""}`}>
              Add to playlist
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className="row hover:bg-slate-50/80">
              <td className="td sticky-left px-4">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-[var(--border)] text-[var(--primary)] focus-visible:ring-2"
                  aria-label={`Select row ${i + 1}`}
                  checked={!!r.added}
                  onChange={(e) => onToggleRow?.(r.id ?? String(i), e.currentTarget.checked)}
                />
              </td>

              <td className="td px-3">
                {r.status === "warn" ? (
                  <span className="badge-warn"><WarnIcon /> No match</span>
                ) : (
                  <span className="chip"><CheckIcon /> Matched</span>
                )}
              </td>

              <td className="td px-3 font-medium text-slate-900 cursor-pointer hover:underline">
                {r.title}
              </td>
              <td className="td px-3 text-slate-700">{r.artist || "—"}</td>
              <td className="td px-3 text-slate-700">{r.album || "—"}</td>
              <td className="td px-3 text-slate-700">{r.time || "—"}</td>

              <td className="td px-3">
                {r.spotifyUrl ? (
                  <a
                    className="text-emerald-700 hover:underline"
                    href={r.spotifyUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View on Spotify"
                  >
                    View on Spotify
                  </a>
                ) : (
                  "—"
                )}
              </td>

             <td className="td sticky-right px-4">
  <label className="switch">
    <input
      type="checkbox"
      checked={!!r.added}
      onChange={(e) => onToggleRow?.(r.id ?? String(i), e.currentTarget.checked)}
      aria-label={`Add "${r.title}" to playlist`}
    />
    <span className="sw-track"><span className="sw-thumb" /></span>
  </label>
</td>

            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ——— Ikony ——— */
function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" className="text-[var(--warning-text)]" fill="currentColor">
      <path d="M1 21h22L12 2 1 21zm12-3h-2v2h2v-2zm0-8h-2v6h2V10z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-emerald-700">
      <path d="M9 16.2l-3.5-3.5L4 14.2l5 5 12-12-1.4-1.4z" />
    </svg>
  );
}
