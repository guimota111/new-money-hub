"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const SCRIPT_URL = "https://cdn.pluggy.ai/pluggy-connect/latest/pluggy-connect.js";

interface PluggyItemData {
  item?: { id?: string; connector?: { name?: string } };
}

declare global {
  interface Window {
    PluggyConnect?: new (options: Record<string, unknown>) => { init: () => void };
  }
}

function loadWidgetScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.PluggyConnect) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("falha ao carregar o widget")));
      return;
    }
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("falha ao carregar o widget"));
    document.head.appendChild(script);
  });
}

export function PluggyConnectButton({
  getToken,
  save,
}: {
  getToken: () => Promise<string>;
  save: (itemId: string, label: string) => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const [connectToken] = await Promise.all([getToken(), loadWidgetScript()]);
      if (!window.PluggyConnect) throw new Error("widget indisponível");
      new window.PluggyConnect({
        connectToken,
        includeSandbox: false,
        onSuccess: async (itemData: PluggyItemData) => {
          const itemId = itemData?.item?.id;
          if (!itemId) {
            setError("Conexão criada, mas não recebemos o id do item.");
            setBusy(false);
            return;
          }
          const bankName = itemData?.item?.connector?.name ?? "Banco";
          await save(itemId, bankName);
          setBusy(false);
          router.refresh();
        },
        onError: (e: unknown) => {
          setError(e instanceof Error ? e.message : "Erro na conexão com o banco.");
          setBusy(false);
        },
        onClose: () => setBusy(false),
      }).init();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao abrir o widget.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {busy ? "Abrindo..." : "Conectar banco"}
      </button>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
