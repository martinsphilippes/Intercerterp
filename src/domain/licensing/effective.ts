import { z } from "zod";
import { ALIAS_OF, INCLUDED_IN, KNOWN_CODES, UNITS_V2, type UnitV2 } from "@/lib/modules/units-v2.generated";

/**
 * Licença comercial (contrato Interos v2): retrato completo e versionado, cálculo PURO do estado efetivo de cada
 * unidade num instante (teste, vigência, carência e agendamentos são resolvidos localmente — sem consultar o Interos).
 *
 * Decisões do titular (26/11/2026):
 *  - carência de 7 dias depois do vencimento do contrato sem renovação; depois, somente leitura;
 *  - teste vencido: 7 dias de carência antes de suspender;
 *  - emissão fiscal nunca é bloqueada por limite (só aviso e evento);
 *  - unidade dependente de integração externa só é vendável depois da homologação (clientes atuais preservados).
 */
export const LICENSE_POLICY = { contractGraceDays: 7, trialGraceDays: 7, staleSyncDays: 3 } as const;

export const ITEM_STATES = ["active", "inactive", "trial", "activation_scheduled", "suspension_scheduled", "suspended", "expired", "read_only"] as const;
export type ItemState = (typeof ITEM_STATES)[number];
export const DISPLAY_MODES = ["hidden", "locked", "upsell"] as const;
export type DisplayMode = (typeof DISPLAY_MODES)[number];

const iso = z.string().refine((v) => !Number.isNaN(Date.parse(v)), "data/hora ISO-8601 inválida");
export const licenseSnapshotSchema = z.object({
  licenseVersion: z.number().int().positive(),
  companyId: z.string().min(1).max(64),
  product: z.literal("erp-intercert"),
  commercialStatus: z.enum(ITEM_STATES),
  activationAt: iso.nullish(),
  validUntil: iso.nullish(),
  trial: z.object({ until: iso.nullish() }).nullish(),
  branches: z.object({ mode: z.enum(["all", "list"]), branchIds: z.array(z.string()).max(500).default([]) }).nullish(),
  limits: z.object({ users: z.number().int().min(0).nullish(), devices: z.number().int().min(0).nullish(), branches: z.number().int().min(0).nullish(), fiscalDocumentsPerMonth: z.number().int().min(0).nullish() }).nullish(),
  display: z.enum(DISPLAY_MODES).nullish(),
  controlMode: z.enum(["legacy", "shadow", "enforced"]).nullish(),
  /**
   * Revisão REAL das divergências da linha de base (correção 9): exigida para passar a "enforced" quando há divergência
   * aberta. Quem revisou (pessoa) e a observação. Sem ela, o controle não muda e o retrato volta com aviso review_required.
   */
  baselineReview: z.object({ reviewedBy: z.string().trim().min(3).max(200), notes: z.string().max(1000).nullish() }).nullish(),
  items: z.array(z.object({
    code: z.string().regex(/^\d\d(\.\d\d){0,2}$/),
    state: z.enum(ITEM_STATES),
    until: iso.nullish(),
    effectiveAt: iso.nullish(),
    reason: z.string().max(300).nullish(),
    config: z.record(z.string(), z.unknown()).nullish(),
  })).max(500),
  issuedAt: iso,
});
export type LicenseSnapshot = z.infer<typeof licenseSnapshotSchema>;

export interface ResolvedItem {
  code: string;
  units: string[];
  note?: "alias" | "included" | "module" | null;
}
export interface ItemIssue {
  code: string;
  reason: "unknown_code" | "not_contractable" | "not_homologated" | "dependency_missing" | "kind_not_supported" | "duplicate_entitlement" | "alias_resolved" | "included_item" | "module_expanded" | "preserved_access" | "review_required" | "unknown_branch" | "no_branch_allowed";
  message: string;
}

const UNIT_BY_CODE = new Map(UNITS_V2.map((u) => [u.code, u]));
export const unitByCode = (code: string): UnitV2 | undefined => UNIT_BY_CODE.get(code);
export const unitByV1Key = (key: string): UnitV2 | undefined => UNITS_V2.find((u) => u.v1Key === key);

/** Código licenciado → unidades comerciais (alias → proprietário; incluído → unidade; módulo NN → suas unidades). */
export function resolveCode(code: string): { units: string[]; issue?: ItemIssue } {
  let c = code;
  let issue: ItemIssue | undefined;
  if (ALIAS_OF[c]) {
    issue = { code, reason: "alias_resolved", message: `${code} é alias de ${ALIAS_OF[c]}: licenciado pelo proprietário (sem cobrança dupla).` };
    c = ALIAS_OF[c];
  }
  if (UNIT_BY_CODE.has(c)) return { units: [c], issue };
  if (INCLUDED_IN[c]) return { units: [INCLUDED_IN[c]], issue: issue ?? { code, reason: "included_item", message: `${code} vem incluído na unidade ${INCLUDED_IN[c]}: licenciado por ela.` } };
  if (/^\d\d$/.test(c)) {
    // contratar o módulo NN inclui só as unidades PRINCIPAIS (includedInParent no catálogo); as adicionais exigem item
    // próprio — evita ligar (e cobrar) adicional sem querer (correção 12)
    const all = UNITS_V2.filter((u) => u.code.startsWith(`${c}.`));
    const units = all.filter((u) => u.includedInParent).map((u) => u.code);
    const addOns = all.filter((u) => !u.includedInParent).map((u) => u.code);
    if (units.length) return { units, issue: { code, reason: "module_expanded", message: `Módulo ${c}: unidades principais ${units.join(", ")}${addOns.length ? `; adicionais exigem item próprio (${addOns.join(", ")})` : ""}.` } };
  }
  if (KNOWN_CODES.includes(c)) return { units: [], issue: { code, reason: "not_contractable", message: `${code} não é unidade comercial (CORE, compartilhado, permissão ou recurso futuro).` } };
  return { units: [], issue: { code, reason: "unknown_code", message: `${code} não existe no catálogo v2.` } };
}

export interface Effective {
  on: boolean;
  /** depois de desligado: consulta histórica ou oculto */
  history: "read" | "none";
  state: ItemState;
  /** aviso para a interface e o Interos (carência em curso etc.) */
  notice?: string;
  /** próxima transição local (para a rotina) */
  nextAt?: string | null;
}

const addDays = (t: string, d: number) => new Date(Date.parse(t) + d * 86400000).toISOString();
const DAY = 86400000;

/** Estado efetivo de um item (sem o limite da empresa). */
export function itemEffective(item: { state: ItemState; until?: string | null; effectiveAt?: string | null }, now: Date): Effective {
  const t = now.getTime();
  switch (item.state) {
    case "active":
      return { on: true, history: "read", state: "active" };
    case "trial": {
      if (!item.until || t <= Date.parse(item.until)) return { on: true, history: "read", state: "trial", nextAt: item.until ?? null };
      const graceEnd = addDays(item.until, LICENSE_POLICY.trialGraceDays);
      if (t <= Date.parse(graceEnd)) return { on: true, history: "read", state: "trial", notice: `Teste vencido em ${item.until.slice(0, 10)}: carência até ${graceEnd.slice(0, 10)}.`, nextAt: graceEnd };
      return { on: false, history: "read", state: "suspended", notice: "Teste encerrado sem contratação." };
    }
    case "activation_scheduled":
      if (item.effectiveAt && t >= Date.parse(item.effectiveAt)) return { on: true, history: "read", state: "active" };
      return { on: false, history: "none", state: "activation_scheduled", nextAt: item.effectiveAt ?? null };
    case "suspension_scheduled":
      if (item.effectiveAt && t >= Date.parse(item.effectiveAt)) return { on: false, history: "read", state: "suspended" };
      return { on: true, history: "read", state: "suspension_scheduled", nextAt: item.effectiveAt ?? null };
    case "suspended":
    case "expired":
    case "read_only":
      return { on: false, history: "read", state: item.state };
    case "inactive":
    default:
      return { on: false, history: "read", state: "inactive" };
  }
}

/** Limite da empresa: estado comercial, ativação, vigência (com carência) e teste. */
export function companyCap(s: Pick<LicenseSnapshot, "commercialStatus" | "activationAt" | "validUntil" | "trial">, now: Date): { allowOn: boolean; state: ItemState; notice?: string; nextAt?: string | null } {
  const t = now.getTime();
  if (s.activationAt && t < Date.parse(s.activationAt)) return { allowOn: false, state: "activation_scheduled", nextAt: s.activationAt };
  const base = itemEffective({ state: s.commercialStatus, until: s.trial?.until ?? null, effectiveAt: null }, now);
  if (s.commercialStatus === "trial" && !s.trial?.until) return { allowOn: true, state: "trial" };
  if (!base.on) return { allowOn: false, state: base.state, notice: base.notice };
  if (s.validUntil && t > Date.parse(s.validUntil)) {
    const graceEnd = addDays(s.validUntil, LICENSE_POLICY.contractGraceDays);
    if (t <= Date.parse(graceEnd)) return { allowOn: true, state: base.state, notice: `Vigência encerrada em ${s.validUntil.slice(0, 10)} sem renovação recebida: carência até ${graceEnd.slice(0, 10)}, depois somente leitura.`, nextAt: graceEnd };
    return { allowOn: false, state: "read_only", notice: "Vigência encerrada sem renovação: somente leitura." };
  }
  const next = [base.nextAt, s.validUntil].filter(Boolean).sort()[0] ?? null;
  return { allowOn: true, state: base.state, notice: base.notice, nextAt: next };
}

/** Desejo por chave v1 a partir do retrato (sem regras de homologação nem dependências — aplicadas no serviço). */
export function desiredByUnit(snapshot: LicenseSnapshot, now: Date): { desired: Map<string, Effective & { config?: Record<string, unknown> | null }>; issues: ItemIssue[]; nextAt: string | null; cap: ReturnType<typeof companyCap> } {
  const cap = companyCap(snapshot, now);
  const desired = new Map<string, Effective & { config?: Record<string, unknown> | null }>();
  const issues: ItemIssue[] = [];
  const nexts: string[] = [];
  if (cap.nextAt) nexts.push(cap.nextAt);
  for (const it of snapshot.items) {
    const r = resolveCode(it.code);
    if (r.issue) issues.push(r.issue);
    const eff = itemEffective(it, now);
    if (eff.nextAt) nexts.push(eff.nextAt);
    const capped: Effective = cap.allowOn ? eff : { ...eff, on: false, state: cap.state, notice: cap.notice ?? eff.notice };
    for (const u of r.units) {
      const prev = desired.get(u);
      if (prev) issues.push({ code: it.code, reason: "duplicate_entitlement", message: `Unidade ${u} licenciada mais de uma vez no retrato: vale o estado mais permissivo, sem cobrança dupla.` });
      if (!prev || (!prev.on && capped.on)) desired.set(u, { ...capped, config: it.config ?? prev?.config ?? null });
    }
  }
  const nextAt = nexts.filter((x) => Date.parse(x) > now.getTime()).sort()[0] ?? null;
  return { desired, issues, nextAt, cap };
}

export const DAY_MS = DAY;
