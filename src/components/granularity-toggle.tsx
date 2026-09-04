"use client";

import type { Granularity } from "@/lib/granularity";

const OPTIONS: { value: Granularity; label: string }[] = [
  { value: "dia", label: "Dias" },
  { value: "semana", label: "Semanas" },
  { value: "mes", label: "Meses" },
  { value: "ano", label: "Anos" },
];

export function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-zinc-300 bg-white p-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-950">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={
            opt.value === value
              ? "rounded-md bg-zinc-950 px-2.5 py-1 font-medium text-white dark:bg-zinc-50 dark:text-zinc-950"
              : "rounded-md px-2.5 py-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
