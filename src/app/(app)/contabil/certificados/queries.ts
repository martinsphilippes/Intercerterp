import "server-only";
import type { Ctx } from "@/lib/core/ctx";
import type { Doc } from "@/lib/db/types";
import { CERT_STATUS, listCertificateRequests, listKnownCertificates, requestDisplayStatus, type KnownCertificate } from "@/domain/accounting";

/** Opções do filtro "Etapa" da aba Acompanhamento: recortes do domínio ("open"/"overdue") + cada situação. */
export const STAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "open", label: "Em atendimento" },
  { value: "overdue", label: "Cobrança vencida" },
  ...CERT_STATUS.map((s) => ({ value: s.value, label: s.label })),
];
const STAGE_VALUES = new Set(STAGE_OPTIONS.map((o) => o.value));

/** Valor do filtro de etapa vindo da URL; um valor desconhecido é ignorado (sem recorte). */
export function stageFilter(raw: string): string {
  return STAGE_VALUES.has(raw) ? raw : "";
}

/** Rótulo curto do botão "próxima ação" da lista — todos levam ao protocolo, onde se age. */
export function nextActionLabel(r: Doc): string {
  switch (requestDisplayStatus(r)) {
    case "awaiting_payment":
    case "overdue":
      return "Cobrança";
    case "validation":
    case "issuing":
    case "awaiting_authorization":
      return "Acompanhar";
    case "ready_to_issue":
    case "issue_failed":
      return "Emitir";
    case "ready_to_download":
      return "Baixar";
    default:
      return "Abrir";
  }
}

/** Ordem da lista: cobranças vencidas e prontos para baixar primeiro, depois do mais recente ao mais antigo. */
export function sortRequests(rows: Doc[]): Doc[] {
  const rank = (r: Doc) => {
    const d = requestDisplayStatus(r);
    return d === "overdue" || d === "ready_to_download" ? 0 : 1;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

/** Último certificado conhecido ativo de cada cliente (maior validade; sem validade informada por último). */
export function latestByClient(known: KnownCertificate[]): Map<string, KnownCertificate> {
  const out = new Map<string, KnownCertificate>();
  for (const k of known) {
    const cur = out.get(k.clientId);
    if (!cur || (k.validTo ?? "") > (cur.validTo ?? "")) out.set(k.clientId, k);
  }
  return out;
}

/** Solicitação em andamento mais recente por cliente (bloqueia uma nova solicitação para o mesmo cliente). */
export async function openRequestsByClient(ctx: Ctx): Promise<Map<string, Doc>> {
  const open = await listCertificateRequests(ctx, { status: "open" });
  const out = new Map<string, Doc>();
  for (const r of open) if (!out.has(r.clientId) || String(r.createdAt) > String(out.get(r.clientId)!.createdAt)) out.set(r.clientId, r);
  return out;
}

/** Certificados conhecidos (todos, inclusive os válidos) indexados pelo cliente — para a "validade atual" das listas. */
export async function knownByClient(ctx: Ctx, clientId?: string | null): Promise<Map<string, KnownCertificate>> {
  return latestByClient(await listKnownCertificates(ctx, { clientId: clientId || null }));
}

/** "Vence em 12 dias" / "Vence hoje" / "Vencido há 8 dias" — ou null sem validade informada. */
export function validityPhrase(daysLeft: number | null): string | null {
  if (daysLeft == null) return null;
  if (daysLeft < 0) return `Vencido há ${Math.abs(daysLeft).toLocaleString("pt-BR")} ${Math.abs(daysLeft) === 1 ? "dia" : "dias"}`;
  if (daysLeft === 0) return "Vence hoje";
  return `Vence em ${daysLeft.toLocaleString("pt-BR")} ${daysLeft === 1 ? "dia" : "dias"}`;
}
