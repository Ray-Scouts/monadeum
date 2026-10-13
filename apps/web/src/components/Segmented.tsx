"use client";

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full flex-wrap rounded-[22px] border border-line-soft bg-surface-2 p-[3px]">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className="tap-y rounded-full px-4 py-1.5 text-[13px] text-muted aria-pressed:bg-surface aria-pressed:text-fg aria-pressed:shadow-[0_1px_0_var(--line)]"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
