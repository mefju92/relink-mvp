// @ts-check
/**
 * @param {{ steps: string[], current?: number, done?: boolean[] }} p
 */
export default function Stepper({ steps = [], current = 0, done = [] }) {
  return (
    <div className="w-full py-2">
      <ul className="mx-auto flex w-full max-w-[720px] items-center justify-center gap-8">
        {steps.map((label, i) => {
          const isDone = !!done[i];
          const isActive = i === current;
          return (
            <li key={label} className="flex items-center gap-2 text-sm">
              <span
                className={[
                  "grid h-6 w-6 place-items-center rounded-full border",
                  isDone
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : isActive
                    ? "border-slate-700 text-slate-900"
                    : "border-slate-300 text-slate-400",
                ].join(" ")}
                aria-label={isDone ? "done" : `step ${i + 1}`}
              >
                {isDone ? "✓" : i + 1}
              </span>
              <span className={isActive ? "font-medium" : "text-slate-500"}>
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
