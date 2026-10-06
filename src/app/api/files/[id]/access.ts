import { can, canDo, type ModuleKey, type PermissionSubject } from "@/lib/permissions";

/** Módulo exigido para ler o arquivo, conforme o registro de origem. */
export const ENTITY_MODULE: Record<string, ModuleKey> = {
  title: "finance",
  bank_import: "finance",
  bank_transaction: "finance",
  reconciliation: "finance",
  fiscal_document: "fiscal",
  fiscal_obligation: "fiscal",
  fiscal_export: "fiscal",
  tax_group: "fiscal",
  receipt: "purchases",
  product: "products",
  ticket: "support",
  sale: "sales",
  return: "sales",
  branch: "admin",
  setting: "admin",
};

/**
 * Motivo de recusa do download (null = permitido), conforme o tipo do arquivo:
 *  - backups: operação "admin.backup";
 *  - certificado digital: "fiscal.configure";
 *  - pacote contábil (todos os XML e planilhas com CPF/CNPJ do período): consulta do fiscal + "data.export";
 *  - demais: consulta do módulo de origem.
 */
export function fileAccessDenial(user: PermissionSubject, meta: Record<string, any>): string | null {
  if (meta.bucket === "backups" || meta.entityType === "backup" || meta.entityType === "restore_job") {
    return canDo(user, "admin.backup") ? null : "Sem permissão para arquivos de backup";
  }
  if (meta.kind === "certificate_a1" || meta.entityType === "fiscal_config") {
    return canDo(user, "fiscal.configure") ? null : "Sem permissão para o certificado digital";
  }
  if (meta.kind === "accounting_package" || meta.entityType === "fiscal_export") {
    if (!can(user, "fiscal", "view")) return "Sem permissão para este arquivo";
    return canDo(user, "data.export") ? null : "Sem permissão para exportar dados: o pacote contábil contém os XML e planilhas com CPF/CNPJ do período";
  }
  const requiredModule = (meta.entityType && ENTITY_MODULE[meta.entityType]) || (meta.bucket === "images" ? "products" : null);
  if (!requiredModule || !can(user, requiredModule, "view")) return "Sem permissão para este arquivo";
  return null;
}
