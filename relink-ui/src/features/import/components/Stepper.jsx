// src/features/import/components/Stepper.jsx
// @ts-check

/**
 * @param {{steps: string[], current: number, done?: boolean[]}} p
 */
export default function Stepper({ steps = [], current = 1, done = [] }) {
  return (
    <nav aria-label="progress" className="flex items-center justify-center gap-6 py-2">
      {steps.map((label, idx) => {
        const isActive = current === idx + 1;
        const isDone = !!done[idx];
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={[
                "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
                isDone ? "bg-emerald-500 text-white border-emerald-500" :
                isActive ? "bg-slate-900 text-white border-slate-900" :
                "bg-white border-slate-300 text-slate-500"
              ].join(" ")}
              aria-label={`${label} ${isDone ? "done" : ""}`}
            >
              {isDone ? "✓" : idx + 1}
            </span>
            <span className="text-sm text-slate-700">{label}</span>
          </div>
        );
      })}
    </nav>
  );
}
