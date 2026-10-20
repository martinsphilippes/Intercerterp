import { addMonths, monthStart, today } from "@/lib/dates";
import { lastYearEnd } from "@/domain/inventory-fiscal";
import type { SintegraFinalidade, SintegraNatureza, SintegraOptions } from "@/domain/fiscal/files/sintegra";

/** Parâmetros da tela Fiscal › Sintegra (GET) → opções do gerador. Mesma leitura na prévia e na geração. */
export interface SintegraScreenParams {
  branchId: string;
  period: string;
  finalidade: SintegraFinalidade;
  natureza: SintegraNatureza;
  withInventory: boolean;
  inventoryDate: string;
  /** "" = parâmetro da empresa/filial; "1"/"0" = escolha desta geração */
  nfce: "" | "1" | "0";
  ipi: boolean;
  contact: string;
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function readSintegraParams(get: (k: string) => string, fallbackBranchId: string): SintegraScreenParams {
  const prev = addMonths(monthStart(today()), -1).slice(0, 7);
  const period = PERIOD_RE.test(get("periodo")) ? get("periodo") : prev;
  const fin = get("finalidade");
  const nat = get("natureza");
  const nfce = get("nfce");
  const inv = get("inventario");
  return {
    branchId: get("filial") || fallbackBranchId,
    period,
    finalidade: (["1", "2", "3", "5"].includes(fin) ? fin : "1") as SintegraFinalidade,
    natureza: (["1", "2", "3"].includes(nat) ? nat : "3") as SintegraNatureza,
    withInventory: inv === "1" || inv === "on",
    inventoryDate: DATE_RE.test(get("database")) ? get("database") : lastYearEnd(`${period}-01`),
    nfce: nfce === "1" || nfce === "0" ? nfce : "",
    ipi: get("ipi") === "1" || get("ipi") === "on",
    contact: get("contato").slice(0, 60),
  };
}

export function toSintegraOptions(p: SintegraScreenParams): SintegraOptions {
  return {
    branchId: p.branchId,
    period: p.period,
    finalidade: p.finalidade,
    natureza: p.natureza,
    inventoryDate: p.withInventory ? p.inventoryDate : null,
    includeNfce: p.nfce === "" ? null : p.nfce === "1",
    ipiContributor: p.ipi,
    contact: p.contact || null,
  };
}
