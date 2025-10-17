// relink-ui/src/features/import/components/StickyBar.jsx
export default function StickyBar({
  selected = 0,          // ile pozycji wybranych
  onUpload = () => {},
  onUndo = () => {},
  onDelete = () => {},
  onCreate = () => {},
}) {
  const disabled = selected === 0;

  return (
    <div
      role="region"
      aria-label="Action bar"
      className="sticky bottom-0 z-10 w-full border-t border-[var(--border)] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <button className="btn btn-neutral" onClick={onUpload}>
            <CloudIcon /> Upload to cloud ({selected})
          </button>
          <button className="btn btn-neutral" aria-label="Undo" title="Undo" onClick={onUndo}>
            <UndoIcon /> Undo
          </button>
        </div>

        <div className="flex items-center gap-3">
          <button
            className={`btn btn-danger ${disabled ? "btn-disabled" : ""}`}
            onClick={onDelete}
            disabled={disabled}
          >
            <TrashIcon /> Delete ({selected})
          </button>
          <button
            className={`btn btn-primary ${disabled ? "btn-disabled" : ""}`}
            onClick={onCreate}
            disabled={disabled}
          >
            <PlaylistIcon /> Create playlist ({selected})
          </button>
        </div>
      </div>
    </div>
  );
}

/* ——— Ikony (proste SVG) ——— */
function CloudIcon(){
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/>
  </svg>);
}
function UndoIcon(){
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
  </svg>);
}
function TrashIcon(){
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>);
}
function PlaylistIcon(){
  return (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="3" y1="6" x2="15" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="11" y2="18"/><circle cx="19" cy="18" r="3"/>
  </svg>);
}
