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

/** Etapas de uma solicitação de certificado digital (Tela 67). "overdue" não é situação: é a cobrança vencida dentro de "awaiting_payment". */
export const CERT_STATUS = [
  { value: "awaiting_payment", label: "Aguardando pagamento", step: 1 },
  { value: "validation", label: "Validação do titular", step: 2 },
  { value: "ready_to_issue", label: "Pronto para emitir", step: 3 },
  { value: "issuing", label: "Emissão em andamento", step: 3 },
  { value: "issue_failed", label: "Falha na emissão", step: 3 },
  { value: "awaiting_authorization", label: "Aguardando autorização", step: 4 },
  { value: "ready_to_download", label: "Pronto para baixar", step: 4 },
  { value: "downloaded", label: "Download realizado", step: 4 },
  { value: "cancelled", label: "Cancelada", step: 0 },
] as const;
export type CertStatus = (typeof CERT_STATUS)[number]["value"];
export const CERT_STATUS_LABEL: Record<string, string> = Object.fromEntries(CERT_STATUS.map((s) => [s.value, s.label]));
/** Situações em que a solicitação ainda está em atendimento (aparece na fila e bloqueia nova solicitação para o mesmo cliente). */
export const CERT_OPEN_STATUSES: string[] = CERT_STATUS.filter((s) => !["downloaded", "cancelled"].includes(s.value)).map((s) => s.value);

export const CERT_KIND = [
  { value: "new", label: "Nova emissão" },
  { value: "renewal", label: "Renovação" },
] as const;
export const CERT_KIND_LABEL: Record<string, string> = Object.fromEntries(CERT_KIND.map((k) => [k.value, k.label]));

export const VALIDATION_MODE = [
  { value: "video", label: "Videoconferência" },
  { value: "in_person", label: "Presencial" },
] as const;
export const VALIDATION_MODE_LABEL: Record<string, string> = Object.fromEntries(VALIDATION_MODE.map((m) => [m.value, m.label]));

export const CHARGE_CHANNEL = [
  { value: "email", label: "E-mail" },
  { value: "whatsapp", label: "WhatsApp (envio manual)" },
  { value: "phone", label: "Telefone (registro manual)" },
  { value: "other", label: "Outro canal (registro manual)" },
] as const;
export const CHARGE_CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CHARGE_CHANNEL.map((c) => [c.value, c.label]));

export const CERT_SOURCE_LABEL: Record<string, string> = {
  issued: "Emitido pelo Intercert",
  manual: "Informado pelo escritório",
  erp: "Certificado de emissão da empresa (ERP)",
};

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
