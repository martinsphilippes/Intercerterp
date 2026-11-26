import type { Doc, Store } from "@/lib/db/types";
import { createCompanyWithDefaults } from "../../setup";

/** CNPJ da empresa da plataforma na demonstração (Intercert Certificação). */
export const DEMO_PLATFORM_CNPJ = "20301510000106";

/**
 * Empresa da PLATAFORMA na demonstração (multiempresa, docs/multiempresa/arquitetura.md §4): é nela que trabalham a
 * gestão da rede (`network.manage`) e a equipe de certificação (`certification.operate`) — operações que alcançam outras
 * empresas e por isso só valem na empresa marcada como plataforma. Idempotente (mesma chave da criação original).
 */
export async function ensureDemoPlatform(store: Store): Promise<{ company: Doc; branch: Doc }> {
  const plat = await createCompanyWithDefaults(store, {
    name: "Intercert Certificação Digital Ltda (DEMO)", tradeName: "Intercert Certificação (DEMO)", cnpj: DEMO_PLATFORM_CNPJ, uf: "CE", cityName: "Juazeiro do Norte",
    cityCode: "2307304", kind: "certification", key: "demo-intercert-platform",
  });
  let company = plat.company;
  if (!company.isDemo || !company.isPlatform) company = await store.update("companies", company.id, { isDemo: true, isPlatform: true });
  return { company, branch: plat.branch };
}
