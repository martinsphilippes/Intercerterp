import forge from "node-forge";
import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { nowIso, today, diffDays } from "@/lib/dates";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { saveFile } from "@/lib/core/files";
import { peekNumber } from "@/lib/core/numbering";
import { isValidCnpj, onlyDigits } from "@/lib/core/text";
import { getFiscalConfig, numberKey, saveFiscalConfig } from "./service";

/**
 * Configurações fiscais (Tela 34): dados do emitente (empresa/filial), certificado A1 (somente metadados),
 * numeração, grupos tributários com vigência.
 */

export const REGIME_LABEL: Record<string, string> = { simples: "Simples Nacional", mei: "MEI", presumido: "Lucro Presumido", real: "Lucro Real" };
export const CRT_LABEL: Record<string, string> = { "1": "1 — Simples Nacional", "2": "2 — Simples Nacional (excesso de sublimite)", "3": "3 — Regime normal", "4": "4 — MEI" };

// ───────────────────────────── Emitente

export interface IssuerInput {
  company: { name: string; tradeName?: string | null; cnpj: string; ie?: string | null; im?: string | null; regime: string; crt: string; cnae?: string | null };
  branch?: { cnpj?: string | null; ie?: string | null; im?: string | null; uf?: string | null; cityCode?: string | null; cityName?: string | null; address?: Record<string, any> | null } | null;
}

export async function saveIssuer(ctx: Ctx, branchId: string | null, input: IssuerInput) {
  requireAction(ctx, "fiscal.configure");
  const cnpj = onlyDigits(input.company.cnpj);
  assert(input.company.name?.trim(), "Informe a razão social.");
  assert(isValidCnpj(cnpj), "CNPJ da empresa inválido.");
  assert(REGIME_LABEL[input.company.regime], "Regime tributário inválido.");
  assert(CRT_LABEL[input.company.crt], "CRT inválido.");
  const before = await ctx.store.getOrThrow("companies", ctx.companyId);
  const cpatch = { name: input.company.name.trim(), tradeName: input.company.tradeName?.trim() || null, cnpj, ie: input.company.ie?.trim() || null, im: input.company.im?.trim() || null, regime: input.company.regime, crt: input.company.crt, cnae: onlyDigits(input.company.cnae) || null };
  if (cnpj !== before.cnpj) {
    const dup = (await listAll(ctx.store, "companies", { filters: [["eq", "cnpj", cnpj]] })).find((c) => c.id !== ctx.companyId);
    assert(!dup, "Já existe outra empresa com este CNPJ.");
  }
  const after = await ctx.store.update("companies", ctx.companyId, cpatch);
  const d = diff(before, cpatch);
  if (Object.keys(d.after).length) await audit(ctx, { module: "fiscal", action: "issuer.company", entityType: "company", entityId: ctx.companyId, summary: "Dados fiscais da empresa atualizados", before: d.before, after: d.after });
  if (branchId && input.branch) {
    const b = await ctx.store.getOrThrow("branches", branchId);
    assert(b.companyId === ctx.companyId, "Filial de outra empresa.");
    const bcnpj = onlyDigits(input.branch.cnpj);
    if (bcnpj) assert(isValidCnpj(bcnpj), "CNPJ da filial inválido.");
    if (input.branch.uf) assert(/^[A-Z]{2}$/.test(input.branch.uf), "UF inválida.");
    if (input.branch.cityCode) assert(/^\d{7}$/.test(input.branch.cityCode), "Código IBGE do município deve ter 7 dígitos.");
    const bpatch = {
      cnpj: bcnpj || null,
      ie: input.branch.ie?.trim() || null,
      im: input.branch.im?.trim() || null,
      uf: input.branch.uf || null,
      cityCode: input.branch.cityCode || null,
      cityName: input.branch.cityName?.trim() || null,
      address: input.branch.address ? { ...(b.address ?? {}), ...input.branch.address, uf: input.branch.uf ?? b.address?.uf, cityCode: input.branch.cityCode ?? b.address?.cityCode, cityName: input.branch.cityName ?? b.address?.cityName } : b.address,
    };
    await ctx.store.update("branches", branchId, bpatch);
    const bd = diff(b, bpatch);
    if (Object.keys(bd.after).length) await audit(ctx, { module: "fiscal", action: "issuer.branch", entityType: "branch", entityId: branchId, summary: `Dados fiscais da filial ${b.name} atualizados`, before: bd.before, after: bd.after, branchId });
  }
  return after;
}

// ───────────────────────────── Numeração

export async function numberingStatus(ctx: Ctx, branchId: string, cfg: Doc | null) {
  const nfeSeries = String(cfg?.nfeSeries ?? 1);
  const nfceSeries = String(cfg?.nfceSeries ?? 1);
  const terminals = await listAll(ctx.store, "terminals", { filters: [["eq", "branchId", branchId]] });
  const rows: Array<{ model: string; series: string; next: number; source: string }> = [];
  rows.push({ model: "nfe", series: nfeSeries, next: (await peekNumber(ctx.store, numberKey(ctx.companyId, branchId, "nfe", nfeSeries))) + 1, source: "Configuração" });
  const seen = new Set<string>();
  for (const s of [nfceSeries, ...terminals.map((t) => String(t.nfceSeries ?? nfceSeries))]) {
    if (seen.has(s)) continue;
    seen.add(s);
    const terms = terminals.filter((t) => String(t.nfceSeries ?? nfceSeries) === s).map((t) => t.code);
    rows.push({ model: "nfce", series: s, next: (await peekNumber(ctx.store, numberKey(ctx.companyId, branchId, "nfce", s))) + 1, source: terms.length ? `Terminais ${terms.join(", ")}` : "Configuração" });
  }
  rows.push({ model: "nfse", series: String(cfg?.nfseSeries ?? "1"), next: (await peekNumber(ctx.store, `rps:${branchId}`)) + 1, source: "RPS" });
  return rows;
}

/** Ajusta o próximo número (somente para frente — nunca reutiliza números já atribuídos). */
export async function setNextNumber(ctx: Ctx, branchId: string, model: "nfe" | "nfce" | "nfse", series: string, next: number) {
  requireAction(ctx, "fiscal.configure");
  assert(Number.isInteger(next) && next >= 1 && next <= 999999999, "Número inválido.");
  const key = model === "nfse" ? `rps:${branchId}` : numberKey(ctx.companyId, branchId, model, series);
  const id = detId("counter", key);
  const cur = await peekNumber(ctx.store, key);
  if (next - 1 < cur) throw new BusinessError(`O próximo número não pode ser menor que ${cur + 1} (números já atribuídos não são reutilizados; use inutilização para lacunas).`);
  if (await ctx.store.get("counters", id)) await ctx.store.update("counters", id, { value: next - 1 });
  else {
    try {
      await ctx.store.create("counters", { key, value: next - 1 }, id);
    } catch (e) {
      if (!isConflict(e)) throw e;
      await ctx.store.update("counters", id, { value: next - 1 });
    }
  }
  await audit(ctx, { module: "fiscal", action: "numbering.set", entityType: "branch", entityId: branchId, summary: `Numeração ${model.toUpperCase()} série ${series}: próximo número ${next} (antes ${cur + 1})`, branchId });
}

// ───────────────────────────── Certificado A1

export interface CertificateInfo {
  subject: string;
  cnpj: string | null;
  issuer: string;
  serial: string;
  validFrom: string;
  validTo: string;
}

/** Lê titular/validade do .pfx com a senha informada (a senha nunca é gravada). */
export function parsePfx(data: Buffer, password: string): CertificateInfo {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(data.toString("binary")));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (/mac|password|Invalid/i.test(msg)) throw new BusinessError("Senha do certificado incorreta ou arquivo inválido.", "cert_password");
    throw new BusinessError(`Arquivo .pfx inválido: ${msg}`, "cert_invalid");
  }
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certs = bags.map((b) => b.cert).filter(Boolean) as forge.pki.Certificate[];
  assert(certs.length, "Nenhum certificado encontrado no arquivo.");
  // certificado do titular: o que não é emissor de nenhum outro da cadeia
  const leaf = certs.find((c) => !certs.some((o) => o !== c && o.issuer.hash === c.subject.hash)) ?? certs[0];
  const cn = String(leaf.subject.getField("CN")?.value ?? "");
  const fromCn = cn.match(/(\d{14})\s*$/)?.[1] ?? null;
  let cnpj: string | null = fromCn;
  // OID ICP-Brasil 2.16.76.1.3.3 (CNPJ) na extensão subjectAltName
  if (!cnpj) {
    const san: any = leaf.getExtension("subjectAltName");
    for (const alt of san?.altNames ?? []) {
      const v = String(alt.value ?? "");
      const m = v.match(/(\d{14})/);
      if (m) cnpj = m[1];
    }
  }
  return {
    subject: leaf.subject.attributes.map((a) => `${a.shortName ?? a.name}=${a.value}`).join(", "),
    cnpj,
    issuer: String(leaf.issuer.getField("CN")?.value ?? leaf.issuer.attributes.map((a) => a.value).join(", ")),
    serial: leaf.serialNumber,
    validFrom: leaf.validity.notBefore.toISOString(),
    validTo: leaf.validity.notAfter.toISOString(),
  };
}

export function certificateDaysLeft(cert: { validTo?: string } | null | undefined, ref = today()): number | null {
  if (!cert?.validTo) return null;
  return diffDays(ref, cert.validTo.slice(0, 10));
}

export async function uploadCertificate(ctx: Ctx, branchId: string | null, input: { fileName: string; data: Buffer; password: string; passwordRef: string }) {
  requireAction(ctx, "fiscal.configure");
  assert(/\.(pfx|p12)$/i.test(input.fileName), "Envie o certificado A1 no formato .pfx ou .p12.");
  assert(input.data.length > 100 && input.data.length < 200_000, "Arquivo de certificado com tamanho inválido.");
  assert(input.password, "Informe a senha do certificado (usada somente para ler a validade; não é gravada).");
  const ref = input.passwordRef.trim();
  assert(/^[A-Z][A-Z0-9_]{2,80}$/.test(ref), "Informe o NOME da variável de ambiente que guarda a senha (ex.: CERT_A1_SENHA).");
  const info = parsePfx(input.data, input.password);
  const company = await ctx.store.getOrThrow("companies", ctx.companyId);
  const branch = branchId ? await ctx.store.get("branches", branchId) : null;
  const expected = onlyDigits(branch?.cnpj ?? company.cnpj);
  const warnings: string[] = [];
  if (info.cnpj && expected && info.cnpj.slice(0, 8) !== expected.slice(0, 8)) warnings.push(`CNPJ do certificado (${info.cnpj}) não pertence à empresa (${expected}).`);
  if (new Date(info.validTo).getTime() < Date.now()) warnings.push("Certificado vencido.");
  const f = await saveFile(ctx, { bucket: "documents", name: input.fileName, mime: "application/x-pkcs12", data: input.data, entityType: "fiscal_config", entityId: detId("fiscalcfg", `${ctx.companyId}|${branchId ?? "*"}`), kind: "certificate_a1", branchId });
  const certificate = { ...info, fileId: f.id, fileName: input.fileName, sha256: f.sha256, passwordRef: ref, passwordRefDefined: Boolean(process.env[ref]), uploadedAt: nowIso(), uploadedBy: ctx.user.name, warnings };
  const cfg = await getFiscalConfig(ctx.store, ctx.companyId, branchId);
  await saveFiscalConfig(ctx, branchId, { ...(cfg && cfg.branchId === branchId ? {} : { provider: cfg?.provider ?? "simulated", environment: cfg?.environment ?? "homologacao" }), certificate });
  await audit(ctx, { module: "fiscal", action: "certificate.upload", entityType: "fiscal_config", entityId: cfg?.id ?? null, summary: `Certificado A1 carregado: ${info.subject.slice(0, 120)} — válido até ${info.validTo.slice(0, 10).split("-").reverse().join("/")}`, after: { subject: info.subject, validTo: info.validTo, passwordRef: ref }, branchId });
  return certificate;
}

// ───────────────────────────── Grupos tributários (com vigência)

export interface TaxGroupInput {
  name: string;
  regime: string;
  cfopInternal: string;
  cfopInterstate: string;
  cfopReturn?: string | null;
  cstCsosn: string;
  icmsRateBps: number;
  icmsBaseReductionBps?: number;
  fcpRateBps?: number;
  pisCst: string;
  pisRateBps: number;
  cofinsCst: string;
  cofinsRateBps: number;
  ipiCst?: string | null;
  ipiRateBps?: number;
  validFrom?: string | null;
  validTo?: string | null;
  active: boolean;
  notes?: string | null;
}

function checkTaxGroup(i: TaxGroupInput) {
  assert(i.name?.trim(), "Informe o nome do grupo.");
  for (const [k, v] of [["CFOP interno", i.cfopInternal], ["CFOP interestadual", i.cfopInterstate]] as const) assert(/^[567]\d{3}$/.test(v ?? ""), `${k} inválido (saída: 5xxx/6xxx/7xxx).`);
  if (i.cfopReturn) assert(/^[123]\d{3}$/.test(i.cfopReturn), "CFOP de devolução inválido (entrada: 1xxx/2xxx).");
  assert(/^\d{2,3}$/.test(i.cstCsosn ?? ""), "CST/CSOSN inválido.");
  assert(/^\d{2}$/.test(i.pisCst ?? "") && /^\d{2}$/.test(i.cofinsCst ?? ""), "CST de PIS/COFINS inválido.");
  for (const v of [i.icmsRateBps, i.pisRateBps, i.cofinsRateBps, i.ipiRateBps ?? 0, i.fcpRateBps ?? 0, i.icmsBaseReductionBps ?? 0]) assert(Number.isInteger(v) && v >= 0 && v <= 10000, "Alíquotas devem estar entre 0% e 100%.");
  if (i.validFrom && i.validTo) assert(i.validFrom <= i.validTo, "Início da vigência deve ser anterior ao fim.");
}

export async function saveTaxGroup(ctx: Ctx, id: string | null, input: TaxGroupInput) {
  requireAction(ctx, "fiscal.configure");
  checkTaxGroup(input);
  const data = { ...input, name: input.name.trim(), cfopReturn: input.cfopReturn || null, ipiCst: input.ipiCst || null, validFrom: input.validFrom || null, validTo: input.validTo || null, notes: input.notes?.trim() || null };
  if (id) {
    const before = await ctx.store.getOrThrow("tax_groups", id);
    assert(before.companyId === ctx.companyId, "Grupo de outra empresa.");
    const after = await ctx.store.update("tax_groups", id, data);
    const d = diff(before, data);
    await audit(ctx, { module: "fiscal", action: "tax_group.update", entityType: "tax_group", entityId: id, summary: `Grupo tributário "${data.name}" alterado`, before: d.before, after: d.after });
    return after;
  }
  const doc = await ctx.store.create("tax_groups", { ...data, companyId: ctx.companyId, createdBy: ctx.user.id });
  await audit(ctx, { module: "fiscal", action: "tax_group.create", entityType: "tax_group", entityId: doc.id, summary: `Grupo tributário "${data.name}" criado`, after: data });
  return doc;
}

export async function taxGroupUsage(ctx: Ctx, id: string) {
  const products = await listAll(ctx.store, "products", { filters: [["eq", "companyId", ctx.companyId], ["eq", "taxGroupId", id]] });
  const configs = await listAll(ctx.store, "fiscal_configs", { filters: [["eq", "companyId", ctx.companyId], ["eq", "defaultTaxGroupId", id]] });
  return { products: products.length, configs: configs.length };
}

export async function deleteTaxGroup(ctx: Ctx, id: string) {
  requireAction(ctx, "fiscal.configure");
  const g = await ctx.store.getOrThrow("tax_groups", id);
  assert(g.companyId === ctx.companyId, "Grupo de outra empresa.");
  const u = await taxGroupUsage(ctx, id);
  if (u.products || u.configs) throw new BusinessError(`Grupo em uso por ${u.products} produto(s) e ${u.configs} configuração(ões). Inative-o ou encerre a vigência em vez de excluir.`);
  await ctx.store.delete("tax_groups", id);
  await audit(ctx, { module: "fiscal", action: "tax_group.delete", entityType: "tax_group", entityId: id, summary: `Grupo tributário "${g.name}" excluído` });
}
