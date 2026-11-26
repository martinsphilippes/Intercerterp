import { SPECIAL_ACTIONS } from "../permissions";
import { ALWAYS_RUN_ROUTINES, CATALOG_VERSION, FAMILIES, MODULES_CATALOG } from "./catalog";
import { dependentsOf, transitiveComponents, transitiveRequires, validateCatalog } from "./graph";

/**
 * Documento legível por máquina do catálogo (catalogo-modulos-erp-v1): o MESMO conteúdo servido em
 * GET /api/interos/v1/catalog e gravado em docs/modulos/catalogo-modulos-erp-v1.json.
 */
export function catalogDocument() {
  const issues = validateCatalog(MODULES_CATALOG);
  const permissionOwner = new Map<string, string[]>();
  for (const m of MODULES_CATALOG) for (const p of m.surfaces.permissions ?? []) permissionOwner.set(p, [...(permissionOwner.get(p) ?? []), m.key]);
  return {
    $schema: "https://intercert.example/schemas/catalogo-modulos-erp-v1.schema.json",
    catalog: "catalogo-modulos-erp-v1",
    catalogVersion: CATALOG_VERSION,
    families: FAMILIES,
    classifications: {
      commercial: "Módulo comercial: contratável sozinho, com utilidade própria.",
      optional_function: "Função opcional de um módulo: exige o módulo-pai.",
      technical: "Componente técnico compartilhado: não contratável; ativo enquanto algum módulo ativo precisar dele.",
      platform: "Recurso obrigatório da plataforma: sempre ativo.",
      permission: "Permissão de usuário (perfil): não é módulo; listada em permissions com o módulo que a governa.",
    },
    availability: {
      available: "Implementado e contratável.",
      needs_confirmation: "Implementado; o recorte comercial ainda precisa de confirmação.",
      planned: "Lacuna documentada: não existe no ERP e não pode ser ativado.",
    },
    companyModuleStates: {
      enabled: "Habilitado: operação completa.",
      scheduled_off: "Desligamento agendado: segue operando até as pendências impeditivas acabarem.",
      draining: "Em desligamento: novas operações bloqueadas; operações em andamento podem concluir.",
      disabled: "Desligado: consulta histórica (history=read) ou oculto (history=none). Dados preservados.",
    },
    controlModes: {
      legacy: "Sem controle de módulos: comportamento anterior.",
      shadow: "Avalia e registra o que seria negado, sem bloquear.",
      enforced: "Aplica a habilitação.",
    },
    alwaysRunRoutines: [...ALWAYS_RUN_ROUTINES],
    modules: MODULES_CATALOG.map((m) => ({
      key: m.key,
      name: m.name,
      description: m.description,
      family: m.family,
      version: m.version,
      classification: m.classification,
      availability: m.availability,
      existing: m.existing,
      companyKinds: m.kinds,
      parent: m.parent ?? null,
      dependencies: {
        required: m.requires ?? [],
        requiredAnyOf: m.requiresAny ?? [],
        transitive: transitiveRequires(MODULES_CATALOG, m.key),
        technicalComponents: transitiveComponents(MODULES_CATALOG, m.key),
        dependents: dependentsOf(MODULES_CATALOG, m.key),
      },
      optionalIntegrations: m.optionalIntegrations ?? [],
      configurationPrerequisites: m.configPrereqs ?? [],
      surfaces: m.surfaces,
      deactivation: m.deactivation,
      notes: m.notes ?? null,
    })),
    permissions: SPECIAL_ACTIONS.map((a) => ({ key: a.key, label: a.label, classification: "permission", governedBy: permissionOwner.get(a.key) ?? [] })),
    validation: { valid: issues.length === 0, issues },
  };
}
