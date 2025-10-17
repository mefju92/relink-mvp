// @ts-check
/** @typedef {{ steps: string[], current: number }} StepperProps */
/** @param {StepperProps} props */
export default function Stepper({ steps = [], current = 0 }) { /* ... */ }

  return (
    <nav aria-label="Steps" className="hidden md:flex items-center gap-3 text-sm">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "active" : "next";
        return (
          <div key={s} className="flex items-center gap-3">
            <div
              className={`flex items-center gap-2 ${state === "active" ? "text-slate-900" : "text-slate-500"}`}
              {...(state === "active" ? { "aria-current": "step" } : {})}
            >
              <span
                className={`grid h-6 w-6 place-items-center rounded-full border ${
                  state === "done"
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : state === "active"
                    ? "border-slate-400"
                    : "border-slate-300 text-slate-500"
                }`}
              >
                {state === "done" ? <CheckIcon /> : i + 1}
              </span>
              <span className="font-semibold">{s}</span>
            </div>
            {i < steps.length - 1 && <span className="w-8 border-t border-dashed border-slate-300" />}
          </div>
        );
      })}
    </nav>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-emerald-700">
      <path d="M9 16.2l-3.5-3.5L4 14.2l5 5 12-12-1.4-1.4z" />
    </svg>
  );
}
