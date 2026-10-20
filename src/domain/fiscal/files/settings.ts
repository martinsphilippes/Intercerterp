import type { Doc, Store } from "@/lib/db/types";
import { getSetting } from "@/lib/core/settings";
import { isValidCnpj, isValidCpf, onlyDigits } from "@/lib/core/text";
import { BusinessError } from "@/lib/core/errors";
import { fmtText, type Pendency } from "./common";

/** Recurso (Parâmetros › Recursos) e parâmetros dos arquivos fiscais (§41). */
export const FILES_FEATURE = "arquivosFiscais";

export const FILE_SETTINGS = {
  profile: "fiscal.sped.profile",
  activity: "fiscal.sped.activity",
  recolhimento: "fiscal.sped.recolhimento",
  efdActivity: "fiscal.efd.activity",
  accountantName: "fiscal.files.accountantName",
  accountantCpf: "fiscal.files.accountantCpf",
  accountantCrc: "fiscal.files.accountantCrc",
  accountantCnpj: "fiscal.files.accountantCnpj",
  accountantEmail: "fiscal.files.accountantEmail",
  accountantPhone: "fiscal.files.accountantPhone",
  accountantZip: "fiscal.files.accountantZip",
  accountantStreet: "fiscal.files.accountantStreet",
  accountantNumber: "fiscal.files.accountantNumber",
  accountantDistrict: "fiscal.files.accountantDistrict",
  accountantCityCode: "fiscal.files.accountantCityCode",
} as const;

/** Recolhimento do ICMS por UF (E116/E250/E316): código de receita da UF e dia do vencimento no mês seguinte. */
export type UfRecolhimento = Record<string, { code: string; day: number }>;

const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

/** "SP=046-2;20" por linha (UF = código da receita ; dia do vencimento). Dia ausente = 20. */
export function parseRecolhimento(raw: string): UfRecolhimento {
  const out: UfRecolhimento = {};
  for (const part of String(raw ?? "").split(/[\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = /^([A-Za-z]{2})\s*=\s*([\w.\-/]{1,20})\s*(?:[;,]\s*(?:dia\s*)?(\d{1,2}))?$/i.exec(part);
    if (!m) throw new BusinessError(`Linha inválida "${part}": use UF=CÓDIGO;DIA (ex.: SP=046-2;20).`, "invalid");
    const uf = m[1].toUpperCase();
    if (!UFS.includes(uf)) throw new BusinessError(`UF inválida: ${uf}.`, "invalid");
    const day = m[3] ? Number(m[3]) : 20;
    if (day < 1 || day > 31) throw new BusinessError(`Dia de vencimento inválido para ${uf}: ${day}.`, "invalid");
    out[uf] = { code: m[2], day };
  }
  return out;
}

export function formatRecolhimento(v: UfRecolhimento | null | undefined): string {
  return Object.entries(v ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([uf, x]) => `${uf}=${x.code};${x.day}`)
    .join("\n");
}

export interface FileParams {
  profile: "A" | "B" | "C";
  activity: "0" | "1";
  efdActivity: string;
  recolhimento: UfRecolhimento;
}

export async function loadFileParams(store: Store, companyId: string, branchId: string | null): Promise<FileParams> {
  const g = <T>(k: string, d: T) => getSetting<T>(store, companyId, branchId, k, d);
  const profile = await g<string>(FILE_SETTINGS.profile, "A");
  const activity = await g<string>(FILE_SETTINGS.activity, "1");
  const rec = await g<UfRecolhimento | null>(FILE_SETTINGS.recolhimento, {});
  return {
    profile: profile === "B" || profile === "C" ? profile : "A",
    activity: activity === "0" ? "0" : "1",
    efdActivity: String(await g<string>(FILE_SETTINGS.efdActivity, "2")),
    recolhimento: rec && typeof rec === "object" ? rec : {},
  };
}

export interface Accountant {
  name: string;
  cpf: string;
  crc: string;
  cnpj: string;
  zip: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  phone: string;
  email: string;
  cityCode: string;
}

/**
 * Contabilista (registro 0100): parâmetros da empresa (Parâmetros › Fiscal) e, no que faltar, o escritório
 * vinculado pelo Portal do Contador (empresa do escritório: CNPJ, endereço, telefone, e-mail) e a integração "Área da
 * contabilidade" (nome do contato e e-mail).
 */
export async function loadAccountant(store: Store, companyId: string): Promise<{ accountant: Accountant; pendencies: Pendency[] }> {
  // valores de texto podem voltar como número do armazenamento json (ex.: CPF só com dígitos): sempre como texto
  const g = async (k: string) => String((await getSetting<unknown>(store, companyId, null, k, "")) ?? "");
  const { getIntegration } = await import("../../integrations");
  const integ = await getIntegration(store, companyId, null, "accounting").catch(() => null);
  const firmId = integ?.config?.linkedFirmCompanyId as string | undefined;
  let firm: Doc | null = null;
  if (firmId) {
    const { unscoped } = await import("@/lib/db/scoped-store");
    firm = await unscoped(store).get("companies", firmId).catch(() => null);
  }
  const fa = firm?.address ?? {};
  const pick = async (k: string, fb: unknown) => fmtText((await g(k)) || (fb as string) || "", 255);
  const a: Accountant = {
    name: await pick(FILE_SETTINGS.accountantName, integ?.config?.accountantName),
    cpf: onlyDigits(await g(FILE_SETTINGS.accountantCpf)),
    crc: fmtText(await g(FILE_SETTINGS.accountantCrc), 15),
    cnpj: onlyDigits((await g(FILE_SETTINGS.accountantCnpj)) || String(firm?.cnpj ?? "")),
    zip: onlyDigits((await g(FILE_SETTINGS.accountantZip)) || String(fa.zip ?? "")),
    street: await pick(FILE_SETTINGS.accountantStreet, fa.street),
    number: await pick(FILE_SETTINGS.accountantNumber, fa.number),
    complement: fmtText(fa.complement, 60),
    district: await pick(FILE_SETTINGS.accountantDistrict, fa.district),
    phone: onlyDigits((await g(FILE_SETTINGS.accountantPhone)) || String(firm?.phone ?? "")),
    email: await pick(FILE_SETTINGS.accountantEmail, integ?.config?.accountantEmail || firm?.email),
    cityCode: onlyDigits((await g(FILE_SETTINGS.accountantCityCode)) || String(fa.cityCode ?? "")),
  };
  const href = "/administracao/parametros";
  const pendencies: Pendency[] = [];
  const miss = (cond: boolean, what: string) => cond && pendencies.push({ severity: "error", code: "accountant", message: `Contabilista (registro 0100): ${what} — Administração › Parâmetros › Fiscal.`, href });
  miss(!a.name, "nome não informado");
  miss(!a.cpf || !isValidCpf(a.cpf), "CPF ausente ou inválido");
  miss(!a.crc, "CRC não informado");
  miss(Boolean(a.cnpj) && !isValidCnpj(a.cnpj), "CNPJ do escritório inválido");
  miss(!a.email, "e-mail não informado");
  miss(!/^\d{7}$/.test(a.cityCode), "município (IBGE) não informado");
  return { accountant: a, pendencies };
}

export interface Establishment {
  name: string;
  tradeName: string;
  cnpj: string;
  uf: string;
  ie: string;
  cityCode: string;
  im: string;
  suframa: string;
  zip: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  phone: string;
  email: string;
}

/** Dados do estabelecimento (filial) com a razão social da empresa. */
export function establishmentOf(company: Doc, branch: Doc | null): { est: Establishment; pendencies: Pendency[] } {
  const a = branch?.address ?? company.address ?? {};
  const est: Establishment = {
    name: fmtText(company.name, 100),
    tradeName: fmtText(company.tradeName || company.name, 60),
    cnpj: onlyDigits(branch?.cnpj ?? company.cnpj),
    uf: String(a.uf ?? branch?.uf ?? "").toUpperCase(),
    ie: String(branch?.ie ?? company.ie ?? "").replace(/[^0-9A-Za-z]/g, ""),
    cityCode: onlyDigits(a.cityCode ?? branch?.cityCode ?? ""),
    im: fmtText(branch?.im ?? company.im, 20),
    suframa: "",
    zip: onlyDigits(a.zip ?? ""),
    street: fmtText(a.street, 60),
    number: fmtText(a.number, 10),
    complement: fmtText(a.complement, 60),
    district: fmtText(a.district, 60),
    phone: onlyDigits(branch?.phone ?? company.phone ?? "").slice(0, 11),
    email: fmtText(branch?.email ?? company.email, 115),
  };
  const href = branch ? `/administracao/empresas/${company.id}` : "/fiscal/configuracoes";
  const pendencies: Pendency[] = [];
  const miss = (cond: boolean, what: string) => cond && pendencies.push({ severity: "error", code: "establishment", message: `Estabelecimento ${branch?.name ?? company.name}: ${what}.`, href });
  miss(!est.cnpj || !isValidCnpj(est.cnpj), "CNPJ ausente ou inválido");
  miss(!est.uf, "UF não informada");
  miss(!/^\d{7}$/.test(est.cityCode), "município (IBGE) não informado");
  return { est, pendencies };
}

export const isSimplesRegime = (regime: string | null | undefined) => ["simples", "mei", "simples_excesso"].includes(String(regime ?? "simples"));
