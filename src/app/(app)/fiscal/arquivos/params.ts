import { addMonths, monthStart, today } from "@/lib/dates";
import { sp, type SearchParams } from "@/lib/list";
import type { FiscalFileKind, FiscalFileRequest } from "@/domain/fiscal/files/service";

/** Parâmetros da tela Arquivos fiscais (mesma leitura na prévia e na geração). */
export interface FilesQuery {
  kind: FiscalFileKind;
  period: string;
  branchId: string | null;
  finality: "original" | "retificadora";
  /** "" = padrão; "none" = sem inventário; AAAA-MM-DD = data */
  inventory: string;
  /** texto informado (ex.: "1234,56"); vazio = do arquivo do mês anterior */
  carry: string;
  previousReceipt: string;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseMoneyText(v: string): number | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const n = Number(t.replace(/\s|R\$/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export function filesQuery(params: SearchParams | Record<string, string>, defaultBranchId: string | null): FilesQuery {
  const get = (k: string) => (typeof (params as any)[k] === "string" ? String((params as any)[k]) : sp(params as SearchParams, k));
  const kind = get("arquivo") === "efd_contribuicoes" ? "efd_contribuicoes" : "sped_fiscal";
  const prev = addMonths(monthStart(today()), -1).slice(0, 7);
  const period = PERIOD.test(get("periodo")) ? get("periodo") : prev;
  const inv = get("inventario");
  return {
    kind,
    period,
    branchId: get("filial") || defaultBranchId,
    finality: get("finalidade") === "retificadora" ? "retificadora" : "original",
    inventory: inv === "none" || /^\d{4}-\d{2}-\d{2}$/.test(inv) ? inv : "",
    carry: get("saldo"),
    previousReceipt: get("recibo").slice(0, 60),
  };
}

export function toRequest(q: FilesQuery): FiscalFileRequest {
  return {
    kind: q.kind,
    period: q.period,
    branchId: q.kind === "sped_fiscal" ? q.branchId : null,
    finality: q.finality,
    inventoryDate: q.inventory === "" ? undefined : q.inventory === "none" ? "" : q.inventory,
    creditCarry: parseMoneyText(q.carry),
    previousReceipt: q.previousReceipt || null,
  };
}
