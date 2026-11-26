import type { ModuleKey, PermissionMatrix } from "@/lib/permissions";

/**
 * Módulos contratados (definidos pelo Interos no provisionamento — contrato §5).
 *
 * Cada módulo comercial libera módulos do ERP (permissões) e recursos (`feature.*`). Empresa SEM contrato registrado
 * (as que já existiam antes do multiempresa) continua com tudo o que tem hoje: o contrato só restringe quem o tem.
 * A restrição é aplicada num ponto central — o perfil efetivo do usuário (`toCtxUser`) e a leitura de recursos
 * (`isFeatureOn`) —, então menu, telas, ações e APIs obedecem juntos.
 */

export interface ContractModule {
  key: string;
  label: string;
  /** módulos do ERP liberados por este módulo comercial */
  modules: ModuleKey[];
  /** recursos (`feature.<chave>`) que só valem com este módulo */
  features: string[];
  /** tipos de empresa em que o módulo faz sentido */
  kinds: Array<"retail" | "accounting" | "certification">;
}

export const CONTRACT_MODULES: ContractModule[] = [
  { key: "pdv", label: "PDV e caixa", modules: ["pdv", "cash"], features: [], kinds: ["retail"] },
  { key: "vendas", label: "Vendas, orçamentos, pedidos e comissões", modules: ["sales"], features: [], kinds: ["retail"] },
  { key: "estoque", label: "Estoque, depósitos e inventário", modules: ["stock"], features: [], kinds: ["retail"] },
  { key: "compras", label: "Compras e recebimento de mercadorias", modules: ["purchases"], features: [], kinds: ["retail"] },
  { key: "financeiro", label: "Financeiro (contas a pagar e receber, conciliação)", modules: ["finance"], features: [], kinds: ["retail", "accounting", "certification"] },
  { key: "fiscal", label: "Fiscal (NF-e, NFC-e, NFS-e e arquivos fiscais)", modules: ["fiscal"], features: [], kinds: ["retail", "accounting", "certification"] },
  { key: "relatorios", label: "Relatórios gerenciais", modules: ["reports"], features: [], kinds: ["retail"] },
  { key: "comercio_digital", label: "Comércio digital (loja virtual própria)", modules: [], features: ["comercioDigital"], kinds: ["retail"] },
  { key: "gestao_contabil", label: "Gestão contábil (carteira de clientes do escritório)", modules: ["accounting"], features: [], kinds: ["accounting"] },
  { key: "rede_certificacao", label: "Rede de certificação digital", modules: [], features: ["redeCertificacao"], kinds: ["certification", "accounting"] },
];

/**
 * Tradução oficial (pendência 4 da integração): o contrato de REFERÊNCIA são as unidades comerciais do catálogo v2;
 * o módulo amplo do provisionamento é um atalho que equivale a estas chaves v1 (e, por elas, às unidades v2 publicadas
 * no catálogo: `translations.provisioningModules`). Cadastros, implantação e plataforma são sempre disponíveis.
 */
export const CONTRACT_MODULE_V1_KEYS: Record<string, string[]> = {
  pdv: ["caixa.operacao", "vendas.pdv", "vendas.devolucoes", "pdv.recebimento_crediario", "pdv.reserva_prevenda", "vendas.pdv_offline"],
  vendas: ["vendas.documentos", "vendas.comissoes"],
  estoque: ["estoque.gestao", "estoque.transferencias", "estoque.inventario", "estoque.lotes", "estoque.inventario_fiscal"],
  compras: ["compras.reposicao", "compras.pedidos", "compras.cotacoes", "compras.aprovacoes", "compras.recebimento", "compras.nota_a_confirmar", "compras.cte", "compras.precificacao"],
  financeiro: [
    "financeiro.contas_receber", "financeiro.inadimplencia", "financeiro.cobranca_whatsapp", "financeiro.carne", "financeiro.contas_pagar", "financeiro.baixa_lote",
    "financeiro.fluxo_caixa", "financeiro.conciliacao", "financeiro.cartoes", "financeiro.taxas_adquirente", "financeiro.relatorios", "financeiro.fechamento_periodo", "financeiro.exportacao_dominio",
  ],
  fiscal: ["fiscal.nfce", "fiscal.nfe", "fiscal.nfse", "fiscal.livro_entradas", "fiscal.sped", "fiscal.sintegra", "fiscal.tributacao_avancada", "fiscal.reforma_tributaria", "fiscal.mdfe"],
  relatorios: ["relatorios.gerenciais", "relatorios.curva_abc", "gestao.metas"],
  comercio_digital: ["ecommerce.loja", "ecommerce.promocoes", "ecommerce.banco", "ecommerce.canais", "ecommerce.marketplaces"],
  gestao_contabil: ["contabil.carteira", "contabil.entregas", "contabil.certificados"],
  rede_certificacao: ["rede.parceiro", "rede.vendas", "rede.vouchers_cupons", "rede.renovacoes", "rede.financeiro"],
};

/**
 * Chaves v1 habilitadas por um contrato amplo (provisionamento), para o tipo de empresa: cadastros e implantação
 * (sempre disponíveis) + as chaves de cada módulo contratado — só as VENDÁVEIS hoje (decisão do titular: dependente de
 * integração externa só depois da homologação) e com as dependências fechadas (o que ficaria sem dependência sai).
 */
export async function v1KeysForContract(modules: string[], kind: string): Promise<string[]> {
  const { MODULES_CATALOG, MODULE_MAP } = await import("@/lib/modules/catalog");
  const { UNITS_V2 } = await import("@/lib/modules/units-v2.generated");
  const { missingDependencies } = await import("@/lib/modules/graph");
  const notSellable = new Set(UNITS_V2.filter((u) => u.v1Key && !u.sellable).map((u) => u.v1Key!));
  const usable = (k: string) => {
    const d = MODULE_MAP.get(k);
    return Boolean(d && d.availability !== "planned" && (d.classification === "commercial" || d.classification === "optional_function") && d.kinds.includes(kind as any) && !notSellable.has(k));
  };
  const keys = new Set<string>(MODULES_CATALOG.filter((m) => (m.family === "cadastros" || m.family === "implantacao") && usable(m.key)).map((m) => m.key));
  for (const area of modules) for (const k of CONTRACT_MODULE_V1_KEYS[area] ?? []) if (usable(k)) keys.add(k);
  for (let guard = 0; guard < 50; guard++) {
    const miss = missingDependencies(MODULES_CATALOG, keys);
    if (!miss.length) break;
    for (const m of miss) keys.delete(m.module);
  }
  return [...keys].sort();
}

/** Módulo amplo do provisionamento a que uma chave v1 pertence (null = sempre disponível ou da plataforma). */
export function contractModuleOfV1Key(key: string): string | null {
  for (const [area, keys] of Object.entries(CONTRACT_MODULE_V1_KEYS)) if (keys.includes(key)) return area;
  return null;
}

/** Módulos sempre disponíveis (cadastros e administração da própria empresa). */
export const CORE_MODULES: ModuleKey[] = ["dashboard", "products", "customers", "suppliers", "admin", "support"];

export const CONTRACT_MODULE_KEYS = CONTRACT_MODULES.map((m) => m.key);

/** Recursos governados por contrato (fora do contrato ficam desligados, mesmo que alguém os ligue em Parâmetros). */
export const CONTRACT_FEATURES = new Set(CONTRACT_MODULES.flatMap((m) => m.features));

export interface CompanyContract {
  modules: string[];
  reference?: string | null;
  plan?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

/** Contrato registrado na empresa (null = empresa anterior ao multiempresa: sem restrição por contrato). */
export function contractOf(company: Record<string, any> | null | undefined): CompanyContract | null {
  const c = company?.contract;
  if (!c || !Array.isArray(c.modules)) return null;
  return c as CompanyContract;
}

/** Módulos do ERP liberados pelo contrato (inclui os sempre disponíveis). */
export function contractedErpModules(contract: CompanyContract): Set<ModuleKey> {
  const out = new Set<ModuleKey>(CORE_MODULES);
  for (const key of contract.modules) for (const m of CONTRACT_MODULES.find((x) => x.key === key)?.modules ?? []) out.add(m);
  return out;
}

/** Perfil efetivo dentro do contrato: módulos não contratados ficam sem nenhuma operação. */
export function maskPermissionsByContract(permissions: PermissionMatrix, company: Record<string, any> | null | undefined): PermissionMatrix {
  const contract = contractOf(company);
  if (!contract) return permissions;
  const allowed = contractedErpModules(contract);
  const out: PermissionMatrix = {};
  for (const [k, v] of Object.entries(permissions ?? {})) if (allowed.has(k as ModuleKey)) out[k as ModuleKey] = v;
  return out;
}

/** O contrato da empresa permite o recurso? (recurso fora do catálogo de contrato: sempre sim) */
export function featureAllowedByContract(company: Record<string, any> | null | undefined, feature: string): boolean {
  if (!CONTRACT_FEATURES.has(feature)) return true;
  const contract = contractOf(company);
  if (!contract) return true;
  return CONTRACT_MODULES.some((m) => m.features.includes(feature) && contract.modules.includes(m.key));
}

/** Valida a lista de módulos comerciais para o tipo de empresa; devolve os inválidos. */
export function invalidContractModules(keys: string[], kind: string | null | undefined): string[] {
  const k = (kind ?? "retail") as ContractModule["kinds"][number];
  return keys.filter((key) => {
    const m = CONTRACT_MODULES.find((x) => x.key === key);
    return !m || !m.kinds.includes(k);
  });
}
