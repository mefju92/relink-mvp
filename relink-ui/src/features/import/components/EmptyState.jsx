// @ts-check

export default function EmptyState({ onAddFiles, onAddFolder }) {
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
      <p className="text-xs text-slate-500">
        Folder picker works best in Chromium-based browsers.
      </p>
    </div>
  );
}
