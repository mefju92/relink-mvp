// src/features/import/components/DataTable.jsx
// @ts-check

/** @typedef {import("../../../types").TrackRow} TrackRow */
/** @typedef {{ durationMs?: number, file?: File, spotifyId?: string }} ExtraRow */
/** @typedef {(TrackRow & ExtraRow)} UITrack */

/**
 * @param {{
 *  rows: UITrack[],
 *  allSelected?: boolean,
 *  onToggleRow: (id: string, val: boolean) => void,
 *  onToggleAll: (val: boolean) => void,
 * }} props
 */
export default function DataTable({
  rows = [],
  allSelected = false,
  onToggleRow = () => {},
  onToggleAll = () => {},
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50">
            <th className="w-10 text-center p-2">
              <input
                type="checkbox"
                checked={!!allSelected}
                onChange={(e) => onToggleAll(e.target.checked)}
                aria-label="Select all rows (filtered)"
              />
            </th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Title</th>
            <th className="text-left p-2">Artist</th>
            <th className="text-left p-2">Album</th>
            <th className="text-left p-2">Length</th>
            <th className="text-left p-2">Spotify</th>
            <th className="w-28 text-center p-2">Add to playlist</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[var(--border)]">
              <td className="text-center p-2">
                <input
                  type="checkbox"
                  checked={!!r.added}
                  onChange={(e) => onToggleRow(r.id, e.target.checked)}
                  aria-label={`Select ${r.title || "track"}`}
                />
              </td>
              <td className="p-2"><StatusBadge status={r.status} /></td>
              <td className="p-2">{r.title || "—"}</td>
              <td className="p-2">{r.artist || "—"}</td>
              <td className="p-2">{r.album || "—"}</td>
              <td className="p-2">{r.time || "—"}</td>
              <td className="p-2">
                {r.spotifyUrl ? (
                  <a
                    href={r.spotifyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 underline"
                  >
                    Open
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td className="text-center p-2">
                {/* jeśli chcesz przełącznik – użyj r.added lub własnego pola */}
                {/* Póki co zostawiamy pustą komórkę; zaznaczanie odbywa się checkboxem z lewej */}
                {/* <YourSwitch checked={!!r.added} onChange={(v)=>onToggleRow(r.id, v)} /> */}
              </td>
            </tr>
          ))}

          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="p-6 text-center text-slate-500 italic">
                No tracks to show
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** @param {{status?: TrackRow['status']}} p */
function StatusBadge({ status }) {
  if (status === "ok") {
    return (
      <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-green-700">
        Match
      </span>
    );
  }
  if (status === "warn") {
    return (
      <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-amber-700">
        No match
      </span>
    );
  }
  return <span>—</span>;
}
