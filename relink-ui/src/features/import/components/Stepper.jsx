// @ts-check
/**
 * @param {{ steps: string[], current: number, done?: boolean[] }} props
 */
export default function Stepper({ steps = [], current = 0, done = [] }) {
  return (
    <div className="flex items-center gap-6">
      {steps.map((label, i) => {
        const isActive = i === current;
        const isDone = !!done[i];
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={[
                "grid h-6 w-6 place-items-center rounded-full border text-xs",
                isDone ? "bg-emerald-500 border-emerald-500 text-white" :
                isActive ? "bg-slate-900 border-slate-900 text-white" :
                "bg-white border-slate-300 text-slate-500",
              ].join(" ")}
            >
              {i + 1}
            </span>
            <span className="text-sm text-slate-700">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
