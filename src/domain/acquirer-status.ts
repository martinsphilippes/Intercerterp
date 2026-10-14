/** Situações das linhas do arquivo da adquirente (FIN-24) — módulo puro, usado também no navegador. */

export type AcquirerStatus = "matched" | "applied" | "already_settled" | "divergent" | "not_found" | "ambiguous" | "future" | "duplicate" | "invalid" | "error";

export const ACQUIRER_STATUS_LABEL: Record<AcquirerStatus, string> = {
  matched: "Casada (a baixar)",
  applied: "Baixada",
  already_settled: "Já liquidada",
  divergent: "Divergente",
  not_found: "Sem correspondência",
  ambiguous: "Ambígua",
  future: "Crédito futuro",
  duplicate: "Repetida no arquivo",
  invalid: "Inválida",
  error: "Erro na baixa",
};

export const ACQUIRER_STATUS_TONE: Record<AcquirerStatus, "good" | "warn" | "bad" | "info" | "neutral"> = {
  matched: "info", applied: "good", already_settled: "neutral", divergent: "bad", not_found: "warn", ambiguous: "warn", future: "neutral", duplicate: "warn", invalid: "bad", error: "bad",
};

/** Situações que entram no relatório de divergências (além das casadas com diferença de taxa/data/bandeira). */
export const DIVERGENT_STATUSES: AcquirerStatus[] = ["divergent", "not_found", "ambiguous", "duplicate", "invalid", "error"];
