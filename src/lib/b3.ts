// Parser do extrato de movimentação da B3 (xlsx exportado em b3.com.br) e
// regras compartilhadas de interpretação (proventos e posição).
import * as XLSX from "xlsx";

export interface B3Movement {
  direction: "credito" | "debito";
  movement_type: string;
  ticker: string | null;
  product: string;
  institution: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_value: number | null;
  moved_at: string;
}

// tipos que alteram a posição em custódia; "Atualização" é só evento
export const POSITION_TYPES = new Set(["Transferência - Liquidação", "Compra"]);

export function parseTicker(product: string): string | null {
  const m = /^([A-Z]{4}\d{1,2}[A-Z]?)\s*-\s/.exec(product);
  if (m) return m[1];
  if (product.startsWith("Tesouro")) return product.trim();
  return null;
}

function parseDate(v: unknown): string {
  if (typeof v === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v).trim());
  if (!m) throw new Error(`data inválida no extrato: ${v}`);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseNum(v: unknown): number | null {
  if (v == null || v === "-" || v === "") return null;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseB3Xlsx(buffer: ArrayBuffer): B3Movement[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("planilha vazia");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });

  const header = (rows[0] ?? []).map((c) => String(c ?? ""));
  if (!header[0]?.startsWith("Entrada") || !header[2]?.startsWith("Movimenta")) {
    throw new Error(
      "Formato não reconhecido — exporte a Movimentação em b3.com.br (Extratos > Movimentação > Exportar).",
    );
  }

  return rows
    .slice(1)
    .filter((r) => r.length > 1 && r[3] != null)
    .map((r) => {
      const product = String(r[3]).trim();
      return {
        direction: String(r[0]).toLowerCase().startsWith("cred") ? "credito" : "debito",
        movement_type: String(r[2]).trim(),
        ticker: parseTicker(product),
        product,
        institution: r[4] ? String(r[4]).trim() : null,
        quantity: parseNum(r[5]),
        unit_price: parseNum(r[6]),
        total_value: parseNum(r[7]),
        moved_at: parseDate(r[1]),
      } satisfies B3Movement;
    });
}

// categoria de receita de um provento; null se a linha não é provento
export function incomeCategorySlug(m: B3Movement): string | null {
  if (m.direction !== "credito" || m.total_value == null) return null;
  if (m.movement_type === "Dividendo") return "dividendos";
  if (m.movement_type === "Juros Sobre Capital Próprio") return "jcp";
  if (m.movement_type === "Rendimento") {
    if (m.ticker && /11$/.test(m.ticker)) return "rendimento_fii";
    if (m.product.startsWith("Tesouro")) return "rendimento_renda_fixa";
    return "outros";
  }
  return null;
}

// chave de dedup de uma movement (o extrato não tem id único)
export function movementKey(m: {
  moved_at: string;
  direction: string;
  movement_type: string;
  ticker: string | null;
  quantity: number | string | null;
  total_value: number | string | null;
}): string {
  return [
    m.moved_at,
    m.direction,
    m.movement_type,
    m.ticker ?? "",
    m.quantity != null ? Number(m.quantity) : "",
    m.total_value != null ? Number(m.total_value) : "",
  ].join("|");
}
