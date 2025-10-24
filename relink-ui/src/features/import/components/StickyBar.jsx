// @ts-check
/**
 * @typedef {Object} Props
 * @property {number} selected
 * @property {() => Promise<void> | void} onUpload
 * @property {() => void} onUndo
 * @property {() => Promise<void> | void} onDelete
 * @property {string} playlistName
 * @property {(v: string) => void} onPlaylistNameChange
 * @property {boolean} canCreate
 * @property {() => Promise<void> | void} onCreate
 */

/** @param {Props} props */
export default function StickyBar({
  selected,
  onUpload,
  onUndo,
  onDelete,
  playlistName,
  onPlaylistNameChange,
  canCreate,
  onCreate,
}) {
  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-[var(--border)] bg-white/95 px-4 py-3 backdrop-blur">
      <div className="text-sm text-slate-600">{selected} selected</div>

      <div className="flex items-center gap-2">
        <button className="btn btn-neutral" onClick={onUpload}>Upload to cloud</button>
        <button className="btn btn-neutral" onClick={onUndo}>Undo</button>
        <button className="btn btn-danger" onClick={onDelete}>Delete</button>

        <input
          value={playlistName}
          onChange={(e) => onPlaylistNameChange(e.target.value)}
          placeholder="Playlist name"
          className="w-56 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none"
        />
        <button
          className={`btn ${canCreate ? "btn-primary" : "btn-disabled"}`}
          disabled={!canCreate}
          onClick={onCreate}
        >
          Create playlist
        </button>
      </div>
    </div>
  );
}
