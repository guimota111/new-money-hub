"use client";

import { useState } from "react";

const inputClass =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

// Seletor de período dos filtros: mês (padrão) e ano navegam direto ao
// escolher; "personalizado" abre os campos de data e espera o Filtrar.
export function PeriodFilter({
  mode,
  mes,
  ano,
  de,
  ate,
}: {
  mode: string;
  mes: string;
  ano: string;
  de?: string;
  ate?: string;
}) {
  const [current, setCurrent] = useState(mode);

  return (
    <>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-zinc-500">Período</label>
        <select
          name="periodo"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            // mês/ano/total aplicam na hora (com o valor padrão); o
            // personalizado espera o usuário preencher as datas
            if (e.target.value !== "personalizado") e.currentTarget.form?.requestSubmit();
          }}
          className={inputClass}
        >
          <option value="mes">Mês</option>
          <option value="ano">Ano</option>
          <option value="personalizado">Personalizado</option>
          <option value="total">Total</option>
        </select>
      </div>
      {current === "mes" && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-500">Mês</label>
          <input
            type="month"
            name="mes"
            defaultValue={mes}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className={inputClass}
          />
        </div>
      )}
      {current === "ano" && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-zinc-500">Ano</label>
          <input
            type="number"
            name="ano"
            min={2000}
            max={2100}
            defaultValue={ano}
            className={`${inputClass} w-24`}
          />
        </div>
      )}
      {current === "personalizado" && (
        <>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-500">De</label>
            <input name="de" type="date" defaultValue={de ?? ""} className={inputClass} />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-zinc-500">Até</label>
            <input name="ate" type="date" defaultValue={ate ?? ""} className={inputClass} />
          </div>
        </>
      )}
    </>
  );
}
