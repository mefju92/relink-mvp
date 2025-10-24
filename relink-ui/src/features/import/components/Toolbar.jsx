// @ts-check
/** @typedef {import("../../../types").FilterKey} FilterKey */
/** @typedef {{ total:number, matched:number, unmatched:number }} Counts */

/**
 * @typedef {{
 *  query: string,
 *  onQueryChange: (v: string) => void,
 *  counts: Counts,
 *  filter: FilterKey,
 *  onFilterChange: (v: FilterKey) => void,
 *  onSortClick: () => void,
 *  onSelectAll: () => void,
 *  onAddFiles: () => void,
 *  onAddFolder: () => void,
 *  onMatch: () => void,
 *  canMatch: boolean,
 *  isMatching: boolean,
 *  isSpotifyConnected: boolean
 * }} ToolbarProps
 */

/** @typedef {{ items: string[], activeIndex: number, onChange: (idx:number)=>void }} SegmentedProps */

/** @param {ToolbarProps} props */
export default function Toolbar({
  query = "",
  onQueryChange = () => {},
  counts = { total: 0, matched: 0, unmatched: 0 },
  filter = /** @type {FilterKey} */ ("all"),
  onFilterChange = () => {},
  onSortClick = () => {},
  onSelectAll = () => {},
  onAddFiles = () => {},
  onAddFolder = () => {},
  onMatch = () => {},
  canMatch = false,
  isMatching = false,
  isSpotifyConnected = false,
}) {
  const items = [
    `All (${counts.total ?? 0})`,
    `Matched (${counts.matched ?? 0})`,
    `Unmatched (${counts.unmatched ?? 0})`,
  ];
  const activeIndex = filter === "matched" ? 1 : filter === "unmatched" ? 2 : 0;

  // "Match tracks" aktywny tylko gdy są pliki i jest połączenie Spotify
  const matchDisabled = !canMatch || !isSpotifyConnected || isMatching;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Primary actions */}
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={onAddFiles}>
          Add files
        </button>
        <button type="button" className="btn btn-neutral" onClick={onAddFolder}>
          Add folder
        </button>
        <button
          type="button"
          className={`btn ${matchDisabled ? "btn-disabled" : "btn-primary"}`}
          onClick={onMatch}
          disabled={matchDisabled}
          aria-live="polite"
          title={
            !isSpotifyConnected
              ? "Connect Spotify to enable matching"
              : !canMatch
              ? "Add files to enable matching"
              : undefined
          }
        >
          {isMatching ? (<><Spinner /> Matching…</>) : "Match tracks"}
        </button>
      </div>

      {/* Search */}
      <div className="relative flex-1 min-w-[260px]">
        <input
          aria-label="Search"
          placeholder="Search…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="w-full rounded-xl border border-[var(--border)] bg-white px-10 py-2 outline-none focus-visible:ring-2"
        />
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <SearchIcon />
        </div>
      </div>

      {/* Filters */}
      <SegmentedControl
        items={items}
        activeIndex={activeIndex}
        onChange={(idx) => onFilterChange(idx === 1 ? "matched" : idx === 2 ? "unmatched" : "all")}
      />

      {/* Sort */}
      <div className="relative">
        <button type="button" className="btn btn-neutral" onClick={onSortClick}>
          Sort: Title <ChevronDown />
        </button>
      </div>

      {/* Select all (filtered) */}
      <button type="button" className="btn btn-neutral" onClick={onSelectAll}>
        Select all
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin border-2 border-slate-300 border-t-slate-600 rounded-full mr-2"
      aria-hidden="true"
    />
  );
}

/** @param {SegmentedProps} props */
function SegmentedControl({ items = [], activeIndex = 0, onChange }) {
  const handleChange = onChange ?? (() => {});
  return (
    <div role="tablist" aria-label="Filters" className="seg">
      {items.map((it, idx) => (
        <button
          key={it}
          type="button"
          role="tab"
          aria-pressed={idx === activeIndex}
          className="px-3"
          onClick={() => handleChange(idx)}
        >
          {it}
        </button>
      ))}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
function ChevronDown() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
