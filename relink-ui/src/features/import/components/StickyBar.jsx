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
  onUndo = () => {},
  onDelete = () => {},
  onCreate = () => {},
  playlistName = "ReLink Import",
  onPlaylistNameChange = () => {},
  canCreate = false,
}) {
  return (
    <div className="sticky bottom-0 z-10 mt-4 border-t border-[var(--border)] bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="chip">{selected} selected</span>
          <button className="btn btn-neutral" onClick={onUpload} disabled={selected === 0}>
            Upload to cloud ({selected})
          </button>
          <button className="btn btn-neutral" onClick={onUndo}>Undo</button>
          <button className="btn btn-danger" onClick={onDelete} disabled={selected === 0}>
            Delete ({selected})
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={playlistName}
            onChange={(e) => onPlaylistNameChange(e.target.value)}
            placeholder="Playlist name"
            className="w-[240px] rounded-xl border border-[var(--border)] px-3 py-2 text-sm outline-none focus-visible:ring-2"
          />
          <button
            className={`btn ${canCreate ? "btn-success" : "btn-disabled"}`}
            onClick={onCreate}
            disabled={!canCreate}
            title={!canCreate ? "Select matched tracks and set a name" : undefined}
          >
            Create playlist ({selected})
          </button>
        </div>
      </div>
    </div>
  );
}
