// src/features/import/components/StickyBar.jsx
// @ts-check

/**
 * @param {{
 *  selected: number,
 *  onUpload: () => void,
 *  onUndo: () => void,
 *  onDelete: () => void,
 *  onCreate: () => void,
 *  playlistName: string,
 *  onPlaylistNameChange: (v: string) => void,
 *  canCreate: boolean
 * }} p
 */
export default function StickyBar({
  selected = 0,
  onUpload = () => {},
  onUndo   = () => {},
  onDelete = () => {},
  onCreate = () => {},
  playlistName = "",
  onPlaylistNameChange = () => {},
  canCreate = false,
}) {
  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-[var(--border)] bg-white/90 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <button className="btn btn-neutral" onClick={onUpload} disabled={selected === 0}>
          Upload to cloud ({selected})
        </button>
        <button className="btn btn-neutral" onClick={onUndo}>
          Undo
        </button>
        <button className={`btn ${selected ? "btn-danger" : "btn-disabled"}`} onClick={onDelete} disabled={!selected}>
          Delete ({selected})
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          value={playlistName}
          onChange={(e) => onPlaylistNameChange(e.target.value)}
          placeholder="Playlist name"
          className="w-[260px] rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none"
        />
        <button
          className={`btn ${canCreate ? "btn-primary" : "btn-disabled"}`}
          onClick={onCreate}
          disabled={!canCreate}
        >
          Create playlist ({selected})
        </button>
      </div>
    </div>
  );
}
