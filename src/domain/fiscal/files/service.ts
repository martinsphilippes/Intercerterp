import { listAll, sha256 } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { BusinessError, PermissionError, assert } from "@/lib/core/errors";
import { requireAction, requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { saveFile } from "@/lib/core/files";
import { getSetting, isFeatureOn, setSetting } from "@/lib/core/settings";
import { addMonths, monthStart, nowIso, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { FileRegistry, defaultInventoryDate, inventoryForFile, isPeriod, loadPeriodDocuments, monthPeriod, referenced, toLatin1, unitNames, type Pendency } from "./common";
import { buildSpedFiscal, spedFiscalFileName, type SpedApuracao } from "./sped-fiscal";
import { buildEfdContribuicoes, efdContribFileName, type ContribTotals, type EfdEstablishment } from "./efd-contribuicoes";
import { FILES_FEATURE, establishmentOf, isSimplesRegime, loadAccountant, loadFileParams } from "./settings";

/**
 * Arquivos fiscais (§41): prévia com pendências e totais, geração e guarda em Arquivos (`files`, kind `sped_fiscal` /
 * `efd_contribuicoes`, entityType `fiscal_file`), histórico e o último arquivo do período para o pacote contábil.
 * Permissão: consulta do Fiscal + operação "Gerar arquivos fiscais (SPED)" (`fiscal.files`); recurso `feature.arquivosFiscais`.
 */

export type FiscalFileKind = "sped_fiscal" | "efd_contribuicoes";

export const FILE_KIND_LABEL: Record<FiscalFileKind, string> = { sped_fiscal: "EFD ICMS/IPI (SPED Fiscal)", efd_contribuicoes: "EFD Contribuições (PIS/COFINS)" };

export interface FiscalFileRequest {
  kind: FiscalFileKind;
  /** AAAA-MM */
  period: string;
  /** SPED Fiscal: estabelecimento (filial); EFD Contribuições: ignorado (a matriz centraliza) */
  branchId?: string | null;
  finality?: "original" | "retificadora";
  /** data do inventário (bloco H): undefined = padrão (31/12 no arquivo de fevereiro); "" = sem inventário */
  inventoryDate?: string | null;
  /** saldo credor de ICMS do período anterior (centavos): ausente = o do arquivo gerado do mês anterior */
  creditCarry?: number | null;
  /** recibo da escrituração anterior (EFD Contribuições retificadora) */
  previousReceipt?: string | null;
}

export interface FiscalFileBuild {
  kind: FiscalFileKind;
  period: string;
  branchId: string | null;
  finality: "0" | "1";
  fileName: string;
  entityLabel: string;
  lines: string[];
  counts: Array<{ reg: string; qty: number }>;
  blocks: Array<{ block: string; lines: number }>;
  pendencies: Pendency[];
  /** impedimento (ex.: Simples na EFD Contribuições) — nada é gerado */
  blocked: string | null;
  inventoryDate: string | null;
  apuracao?: SpedApuracao;
  st?: Array<{ uf: string; value: number }>;
  difal?: Array<{ uf: string; difal: number; fcp: number }>;
  contrib?: ContribTotals & { regime: "cumulative" | "non_cumulative" };
  docs: { issued: number; entries: number; ctes: number; services: number; cancelled: number; disabled: number };
}

export const LOG_KEY = "fiscal.files.log";

export interface FileLogEntry {
  fileId: string;
  kind: FiscalFileKind;
  period: string;
  branchId: string | null;
  finality: "0" | "1";
  fileName: string;
  generatedAt: string;
  by: string;
  lines: number;
  errors: number;
  warnings: number;
  sha256: string;
  reused: boolean;
  /** SPED Fiscal: saldo credor a transportar (E110) — padrão do saldo anterior do mês seguinte */
  carryOut?: number;
  summary: string;
}

async function requireFiles(ctx: Ctx, branchId: string | null) {
  requirePerm(ctx, "fiscal", "view");
  requireAction(ctx, "fiscal.files");
  if (!(await isFeatureOn(ctx.store, ctx.companyId, branchId ?? ctx.branchId, FILES_FEATURE, true))) throw new BusinessError("Arquivos fiscais desligados em Administração › Parâmetros › Recursos.", "feature_off");
}

const canSeeBranch = (ctx: Ctx, branchId: string) => ctx.user.isAdmin || !(ctx.user.branchIds ?? []).length || ctx.user.branchIds.includes(branchId);

export async function fileLog(ctx: Ctx): Promise<FileLogEntry[]> {
  const v = await getSetting<FileLogEntry[]>(ctx.store, ctx.companyId, null, LOG_KEY, []);
  return Array.isArray(v) ? v : [];
}

/** Saldo credor do mês anterior: o "a transportar" do último arquivo gerado do estabelecimento naquele mês. */
async function previousCarry(ctx: Ctx, branchId: string, period: string): Promise<number> {
  const prev = addMonths(`${period}-01`, -1).slice(0, 7);
  const e = (await fileLog(ctx)).find((x) => x.kind === "sped_fiscal" && x.branchId === branchId && x.period === prev);
  return e?.carryOut ?? 0;
}

function periodPendencies(period: string): Pendency[] {
  const p = monthPeriod(period);
  const out: Pendency[] = [];
  if (p.to >= today()) out.push({ severity: "warning", code: "period_open", message: "Mês ainda em andamento: documentos emitidos até o fim do mês ficarão fora — gere o arquivo depois do encerramento." });
  return out;
}

const countDocs = (docs: Array<{ source?: string; sit: string; oper?: string }>, ctes: number, services: number) => ({
  issued: docs.filter((d) => d.source === "issued" && (d.sit === "00" || d.sit === "06")).length,
  entries: docs.filter((d) => d.source === "receipt").length,
  ctes,
  services,
  cancelled: docs.filter((d) => d.sit === "02" || d.sit === "04").length,
  disabled: docs.filter((d) => d.sit === "05").length,
});

/** Monta o arquivo (sem gravar): linhas, contagem, totais e pendências. */
export async function buildFiscalFile(ctx: Ctx, req: FiscalFileRequest): Promise<FiscalFileBuild> {
  assert(isPeriod(req.period), "Informe o período (mês/ano).");
  assert(monthStart(today()) >= `${req.period}-01`, "O período não pode ser futuro.");
  const finality: "0" | "1" = req.finality === "retificadora" ? "1" : "0";
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  const period = monthPeriod(req.period);
  const units = await unitNames(ctx.store, ctx.companyId);
  const { accountant, pendencies: accPend } = await loadAccountant(ctx.store, ctx.companyId);
  const regime = String(company.regime ?? "simples");

  if (req.kind === "sped_fiscal") {
    const branchId = req.branchId || ctx.branchId;
    if (!branchId) throw new BusinessError("Escolha o estabelecimento (filial): a EFD ICMS/IPI é entregue por estabelecimento.", "branch_required");
    await requireFiles(ctx, branchId);
    const branch = await ctx.store.getOrThrow("branches", branchId);
    assert(branch.companyId === ctx.companyId, "Filial de outra empresa.");
    if (!canSeeBranch(ctx, branchId)) throw new PermissionError("Você não tem acesso a esta filial.");
    const params = await loadFileParams(ctx.store, ctx.companyId, branchId);
    const { est, pendencies: estPend } = establishmentOf(company, branch);
    const pend: Pendency[] = [...periodPendencies(req.period), ...estPend, ...accPend];
    if (!est.ie) pend.push({ severity: "error", code: "establishment", message: `Estabelecimento ${branch.name}: inscrição estadual não informada.`, href: `/administracao/empresas/${company.id}` });
    if (["simples", "mei"].includes(regime)) pend.push({ severity: "warning", code: "simples", message: "Empresa do Simples Nacional: normalmente DISPENSADA da EFD ICMS/IPI (exceto exigência do estado, ex.: excesso de sublimite ou regime especial) — gere apenas se a SEFAZ exigir; ICMS das entradas sem crédito." });
    const reg = new FileRegistry(units);
    const data = await loadPeriodDocuments(ctx, { from: period.from, to: period.to, branchIds: [branchId], creditIcms: !["simples", "mei"].includes(regime), nonCumulative: regime === "real" }, reg);
    const invDate = req.inventoryDate === undefined || req.inventoryDate === null ? defaultInventoryDate(req.period) : req.inventoryDate || null;
    if (invDate) {
      assert(/^\d{4}-\d{2}-\d{2}$/.test(invDate), "Data do inventário inválida.");
      assert(invDate <= period.to && invDate <= today(), "A data do inventário não pode ser posterior ao fim do período nem futura.");
    } else if (req.period.slice(5, 7) === "02") pend.push({ severity: "warning", code: "inventory_missing", message: "Arquivo de fevereiro sem inventário (bloco H): o inventário de 31/12 do ano anterior é obrigatório no arquivo de fevereiro." });
    const inventory = invDate ? await inventoryForFile(ctx, [branchId], invDate, reg) : null;
    const creditCarry = req.creditCarry != null ? Math.max(0, Math.round(req.creditCarry)) : await previousCarry(ctx, branchId, req.period);
    const entryLines = data.docs.filter((d) => d.emit === "1").flatMap((d) => d.lines);
    const used = referenced(reg, {
      parts: [...data.docs.map((d) => (d.model === "65" ? null : d.partCode)), ...data.ctes.map((c) => c.partCode)],
      items: [...entryLines.map((l) => l.itemCode), ...(inventory?.rows ?? []).map((x) => x.itemCode)],
      units: [...entryLines.map((l) => l.unit), ...(inventory?.rows ?? []).map((x) => x.unit)],
    });
    const result = buildSpedFiscal({
      period, finality, profile: params.profile, activity: params.activity, establishment: est, accountant,
      participants: used.participants, units: used.units, items: used.items, docs: data.docs, ctes: data.ctes, inventory, creditCarry, recolhimento: params.recolhimento,
    });
    const owed = [...(result.apuracao.toPay > 0 ? [est.uf] : []), ...result.st.map((s) => s.uf), ...result.difal.map((d) => d.uf)];
    for (const uf of [...new Set(owed)]) if (!params.recolhimento[uf]) pend.push({ severity: "error", code: "recolhimento", message: `Código de receita do ICMS de ${uf} não cadastrado (E116/E250/E316) — Administração › Parâmetros › Fiscal.`, href: "/administracao/parametros" });
    pend.push({ severity: "warning", code: "cod_cta", message: "Contas contábeis (COD_CTA) e naturezas de operação (0400) não são informadas — confira com a contabilidade se o estado exige." });
    return {
      kind: "sped_fiscal", period: req.period, branchId, finality, fileName: spedFiscalFileName(est.cnpj, req.period, finality), entityLabel: `${branch.name} — CNPJ ${est.cnpj}`,
      lines: result.lines, counts: result.counts, blocks: result.blocks, pendencies: [...pend, ...reg.pendencies, ...result.checks], blocked: null, inventoryDate: invDate,
      apuracao: result.apuracao, st: result.st, difal: result.difal, docs: countDocs(data.docs, data.ctes.length, 0),
    };
  }

  // ── EFD Contribuições (empresa — matriz centraliza)
  await requireFiles(ctx, null);
  const branches = (await listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] })).filter((b) => b.status !== "inactive").sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")) || String(a.name).localeCompare(String(b.name)));
  if (branches.some((b) => !canSeeBranch(ctx, b.id))) throw new PermissionError("A EFD Contribuições reúne todos os estabelecimentos: exige acesso a todas as filiais da empresa.");
  const matriz = branches.find((b) => onlyDigitsEq(b.cnpj, company.cnpj)) ?? branches[0] ?? null;
  const { est: companyEst, pendencies: estPend } = establishmentOf(company, matriz);
  const base: FiscalFileBuild = {
    kind: "efd_contribuicoes", period: req.period, branchId: null, finality, fileName: efdContribFileName(company.cnpj ?? companyEst.cnpj, req.period, finality), entityLabel: `${company.name} — CNPJ ${company.cnpj ?? "—"} (todos os estabelecimentos)`,
    lines: [], counts: [], blocks: [], pendencies: [], blocked: null, inventoryDate: null, docs: { issued: 0, entries: 0, ctes: 0, services: 0, cancelled: 0, disabled: 0 },
  };
  if (isSimplesRegime(regime)) return { ...base, blocked: "Empresa optante pelo Simples Nacional não entrega a EFD Contribuições (PIS/COFINS são recolhidos no DAS). Nada foi gerado." };
  if (!["presumido", "real"].includes(regime)) return { ...base, blocked: `Regime tributário "${regime}" sem tratamento na EFD Contribuições: cadastre Lucro Presumido (cumulativo) ou Lucro Real (não cumulativo).` };
  const contribRegime = regime === "real" ? "non_cumulative" : "cumulative";
  const params = await loadFileParams(ctx.store, ctx.companyId, null);
  const pend: Pendency[] = [...periodPendencies(req.period), ...estPend, ...accPend];
  if (finality === "1" && !String(req.previousReceipt ?? "").trim()) pend.push({ severity: "error", code: "previous_receipt", message: "Retificadora: informe o número do recibo da escrituração anterior." });
  const establishments: EfdEstablishment[] = [];
  const allDocs: Array<{ source?: string; sit: string }> = [];
  let ctes = 0;
  let services = 0;
  for (const b of branches) {
    const reg = new FileRegistry(units);
    const data = await loadPeriodDocuments(ctx, { from: period.from, to: period.to, branchIds: [b.id], creditIcms: true, nonCumulative: contribRegime === "non_cumulative" }, reg);
    const { est, pendencies: bPend } = establishmentOf(company, b);
    pend.push(...bPend, ...reg.pendencies);
    // só o que é escriturado: saídas (receitas) e, no não cumulativo, entradas de terceiros — participantes/itens só dos usados
    const used = data.docs.filter((d) => d.oper === "1" || (contribRegime === "non_cumulative" && d.emit === "1"));
    const lines = used.flatMap((d) => (d.model === "65" ? [] : d.lines));
    const refs = referenced(reg, { parts: [...used.map((d) => (d.model === "65" ? null : d.partCode)), ...data.services.map((x) => x.partCode)], items: [...lines.map((l) => l.itemCode), ...data.services.map((x) => x.itemCode)], units: lines.map((l) => l.unit) });
    if (contribRegime === "non_cumulative" && data.ctes.length) pend.push({ severity: "warning", code: "cte_credit", message: `${b.name}: ${data.ctes.length} CT-e de frete de compra no período — o crédito de PIS/COFINS sobre o frete (bloco D) não é gerado; lance com a contabilidade.` });
    ctes += data.ctes.length;
    services += data.services.length;
    allDocs.push(...used);
    establishments.push({ branchId: b.id, establishment: est, participants: refs.participants, units: refs.units, items: refs.items, docs: used, services: data.services });
  }
  const result = buildEfdContribuicoes({ period, finality, previousReceipt: String(req.previousReceipt ?? ""), regime: contribRegime, activity: params.efdActivity, company: { ...companyEst, cnpj: onlyDigits(company.cnpj) || companyEst.cnpj }, accountant, establishments });
  pend.push({ severity: "warning", code: "cod_cta", message: "Contas contábeis (COD_CTA, registro 0500) não são informadas e receitas não tributadas usam a natureza genérica 999 (M410/M810) — confira com a contabilidade." });
  return {
    ...base, lines: result.lines, counts: result.counts, blocks: result.blocks, pendencies: [...pend, ...result.checks],
    contrib: { ...result.totals, regime: contribRegime }, docs: { ...countDocs(allDocs, ctes, services) },
  };
}

function onlyDigitsEq(a: unknown, b: unknown) {
  const d = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  return Boolean(d(a)) && d(a) === d(b);
}
const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Resumo legível dos totais (prévia, histórico e auditoria). */
export function fileSummary(b: FiscalFileBuild): string {
  if (b.apuracao) return `débitos ${formatMoney(b.apuracao.debits)}, créditos ${formatMoney(b.apuracao.credits)}, ICMS a recolher ${formatMoney(b.apuracao.toPay)}, saldo credor ${formatMoney(b.apuracao.carryOut)}`;
  if (b.contrib) return `PIS ${formatMoney(b.contrib.pisDue)} e COFINS ${formatMoney(b.contrib.cofinsDue)} a recolher (base ${formatMoney(b.contrib.pisBase)})`;
  return b.blocked ?? "";
}

export interface GenerateResult {
  fileId: string;
  fileName: string;
  reused: boolean;
  lines: number;
  errors: number;
  warnings: number;
  summary: string;
}

/**
 * Gera e guarda o arquivo (Arquivos). Pendências de erro exigem a confirmação `acceptPendencies` (o PVA tende a recusar o
 * arquivo); Simples na EFD Contribuições é bloqueado. Mesmo conteúdo do último arquivo do período → devolve o mesmo
 * arquivo (idempotente), sem criar outro.
 */
export async function generateFiscalFile(ctx: Ctx, req: FiscalFileRequest & { acceptPendencies?: boolean }): Promise<GenerateResult> {
  const b = await buildFiscalFile(ctx, req);
  if (b.blocked) throw new BusinessError(b.blocked, "blocked");
  const errors = b.pendencies.filter((p) => p.severity === "error");
  const warnings = b.pendencies.filter((p) => p.severity === "warning").length;
  if (errors.length && !req.acceptPendencies) throw new BusinessError(`Há ${errors.length} pendência(s) que o PVA deve recusar (ex.: ${errors[0].message}). Corrija ou marque "gerar mesmo assim".`, "pendencies");
  const data = toLatin1(b.lines);
  const hash = sha256(data);
  const entityId = `${b.period}:${b.branchId ?? "empresa"}`;
  const prev = (await listAll(ctx.store, "files", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", b.kind], ["eq", "entityId", entityId]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 1))[0];
  const summary = fileSummary(b);
  let file: Doc;
  let reused = false;
  if (prev && prev.sha256 === hash && prev.name === b.fileName) {
    file = prev;
    reused = true;
  } else {
    file = await saveFile(ctx, { bucket: "documents", name: b.fileName, mime: "text/plain", data, entityType: "fiscal_file", entityId, kind: b.kind, branchId: b.branchId });
  }
  const entry: FileLogEntry = {
    fileId: file.id, kind: b.kind, period: b.period, branchId: b.branchId, finality: b.finality, fileName: b.fileName, generatedAt: nowIso(), by: ctx.user.name, lines: b.lines.length,
    errors: errors.length, warnings, sha256: hash, reused, ...(b.apuracao ? { carryOut: b.apuracao.carryOut } : {}), summary,
  };
  const log = await fileLog(ctx);
  await setSetting(ctx.store, ctx.companyId, null, LOG_KEY, [entry, ...log].slice(0, 100), ctx.user.id);
  await audit(ctx, {
    module: "fiscal", action: "files.generate", entityType: "file", entityId: file.id, branchId: b.branchId,
    summary: `${FILE_KIND_LABEL[b.kind]} ${b.period.slice(5, 7)}/${b.period.slice(0, 4)} ${reused ? "gerada novamente (mesmo conteúdo do último arquivo)" : "gerada"}: ${b.lines.length} linhas; ${summary}${errors.length ? `; ${errors.length} pendência(s) aceita(s)` : ""}`.slice(0, 480),
    after: { kind: b.kind, period: b.period, branchId: b.branchId, finality: b.finality, lines: b.lines.length, errors: errors.length, warnings, sha256: hash },
  });
  return { fileId: file.id, fileName: b.fileName, reused, lines: b.lines.length, errors: errors.length, warnings, summary };
}

/** Histórico de arquivos gerados (com download pelo armazenamento de Arquivos). */
export async function fiscalFileHistory(ctx: Ctx): Promise<FileLogEntry[]> {
  requirePerm(ctx, "fiscal", "view");
  requireAction(ctx, "fiscal.files");
  return (await fileLog(ctx)).filter((e) => !e.branchId || canSeeBranch(ctx, e.branchId));
}

/**
 * Último arquivo gerado de cada período × estabelecimento no intervalo (pacote contábil): EFD ICMS/IPI da filial pedida
 * (ou de todas) e a EFD Contribuições da empresa. Só leitura; sem arquivo gerado, nada é devolvido.
 */
export async function latestFilesForPackage(ctx: Ctx, f: { from: string; to: string; branchId: string | null }): Promise<Doc[]> {
  const months = new Set<string>();
  for (let m = f.from.slice(0, 7); m <= f.to.slice(0, 7); m = addMonths(`${m}-01`, 1).slice(0, 7)) months.add(m);
  const files = await listAll(ctx.store, "files", { filters: [["eq", "companyId", ctx.companyId], ["eq", "kind", ["sped_fiscal", "efd_contribuicoes"]]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 2000);
  const latest = new Map<string, Doc>();
  for (const x of files) {
    const [period, scope] = String(x.entityId ?? "").split(":");
    if (!months.has(period)) continue;
    if (x.kind === "sped_fiscal" && f.branchId && scope !== f.branchId) continue;
    const k = `${x.kind}|${x.entityId}`;
    if (!latest.has(k)) latest.set(k, x);
  }
  return [...latest.values()].sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.entityId).localeCompare(String(b.entityId)));
}
