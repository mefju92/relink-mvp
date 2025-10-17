// relink-ui/src/features/import/components/Toolbar.jsx
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
 *  onSelectAll: () => void
 * }} ToolbarProps
 */

/** @param {ToolbarProps} props */
export default function Toolbar({
  query = "",
  onQueryChange = () => {},
  counts = { total: 0, matched: 0, unmatched: 0 },
  filter = "all",
  onFilterChange = () => {},
  onSortClick = () => {},
  onSelectAll = () => {},
}) {
  const items = [
    `All (${counts.total ?? 0})`,
    `Matched (${counts.matched ?? 0})`,
    `Unmatched (${counts.unmatched ?? 0})`,
  ];
  const activeIndex = filter === "matched" ? 1 : filter === "unmatched" ? 2 : 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
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
        <button className="btn btn-neutral" aria-haspopup="listbox" aria-expanded="false" onClick={onSortClick}>
          Sort: Title <ChevronDown />
        </button>
      </div>

      {/* Select all (filtered) */}
      <button className="btn btn-neutral" aria-label="Select all (filtered)" onClick={onSelectAll}>
        Select all
      </button>
    </div>
  );
}

/* ------- SegmentedControl ------- */
function SegmentedControl({ items = [], activeIndex = 0, onChange = () => {} }) {
  return (
    <div role="tablist" aria-label="Filters" className="seg">
      {items.map((it, idx) => (
        <button
          key={it}
          role="tab"
          aria-pressed={idx === activeIndex}
          className="px-3"
          onClick={() => onChange(idx)}
        >
          {it}
        </button>
      ))}
    </div>
  );
}

/* ------- Icons ------- */
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
