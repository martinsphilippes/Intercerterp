import type { Ctx } from "@/lib/core/ctx";
import { BusinessError } from "@/lib/core/errors";
import type { Doc } from "@/lib/db/types";

/**
 * Gestão contábil — base comum.
 *
 * Conceitos (ver docs/regras-assumidas.md §21):
 *  - Escritório = empresa (`companies`) com kind "accounting". Tudo da carteira fica na empresa do escritório
 *    (isolamento por companyId); vários escritórios convivem na mesma instalação sem se enxergar.
 *  - Cliente contábil = registro próprio (`accounting_clients`) do escritório, PF ou PJ. NÃO é a empresa operacional do ERP.
 *  - Vínculo = o cliente pode apontar para uma empresa que usa o ERP (`linkedCompanyId`), mediante consentimento
 *    do administrador daquela empresa (código de vínculo). Com o vínculo ativo, o escritório lê a situação fiscal
 *    da empresa (somente leitura) e recebe automaticamente o pacote mensal de XMLs na caixa de entrada.
 */

export const CLIENT_STATUS = [
  { value: "onboarding", label: "Em implantação" },
  { value: "active", label: "Ativo" },
  { value: "offboarding", label: "Em encerramento" },
  { value: "closed", label: "Encerrado" },
] as const;

export const SERVICE_CATALOG = [
  { key: "accounting", label: "Contabilidade" },
  { key: "fiscal", label: "Escrita fiscal" },
  { key: "payroll", label: "Departamento pessoal" },
  { key: "corporate", label: "Societário e legalização" },
  { key: "consulting", label: "Consultoria" },
  { key: "irpf", label: "IRPF" },
  { key: "bpo", label: "BPO financeiro" },
  { key: "certificates", label: "Certidões e regularizações" },
] as const;

export const SERVICE_LABEL: Record<string, string> = Object.fromEntries(SERVICE_CATALOG.map((s) => [s.key, s.label]));

export const PEOPLE_KIND = [
  { value: "partner", label: "Sócio / titular" },
  { value: "legal_rep", label: "Representante legal" },
  { value: "attorney", label: "Procurador" },
  { value: "contact", label: "Contato" },
] as const;
export const PEOPLE_KIND_LABEL: Record<string, string> = Object.fromEntries(PEOPLE_KIND.map((p) => [p.value, p.label]));

export const DEPARTMENT_KIND = [
  { value: "fiscal", label: "Fiscal" },
  { value: "accounting", label: "Contábil" },
  { value: "payroll", label: "Departamento pessoal" },
  { value: "corporate", label: "Societário e legalização" },
  { value: "financial_bpo", label: "Financeiro (BPO)" },
  { value: "custom", label: "Outro" },
] as const;

export const GROUP_KIND = [
  { value: "economic", label: "Grupo econômico" },
  { value: "family", label: "Mesmos sócios / família" },
  { value: "commercial", label: "Agrupamento comercial" },
  { value: "other", label: "Outro" },
] as const;

export const LINK_STATUS_LABEL: Record<string, string> = {
  none: "Sem vínculo",
  pending: "Código emitido — aguardando a empresa aceitar",
  active: "Vinculado ao ERP",
  revoked: "Vínculo desfeito",
};

export function isAccountingFirm(company: Record<string, any> | null | undefined): boolean {
  return company?.kind === "accounting";
}

/** Garante que a empresa ativa é um escritório contábil (os recursos da carteira não existem nas empresas operacionais). */
export async function requireFirm(ctx: Ctx): Promise<Doc> {
  const company = await ctx.store.get("companies", ctx.companyId);
  if (!company || !isAccountingFirm(company)) throw new BusinessError("Este recurso é exclusivo de empresas do tipo escritório contábil.", "not_a_firm");
  return company;
}
