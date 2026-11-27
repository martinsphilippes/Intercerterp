import { unscoped } from "@/lib/db/scoped-store";
import type { Store } from "@/lib/db/types";
import { licenseId } from "./license";
import type { LicenseSnapshot } from "./effective";

/**
 * Filiais autorizadas pela licença (`branches` do retrato v2 — correção 11): `{ mode: "all" }` ou ausente = todas;
 * `{ mode: "list", branchIds }` = só essas operam. Uma filial fora da lista continua acessível SÓ EM CONSULTA (o
 * histórico é da empresa): nenhuma gravação a partir dela, com o motivo na tela. Vale na hora, em todas as instâncias.
 */
export function branchAllowedByLicense(snapshot: Pick<LicenseSnapshot, "branches"> | null | undefined, branchId: string): boolean {
  const b = snapshot?.branches;
  if (!b || b.mode !== "list") return true;
  return (b.branchIds ?? []).includes(branchId);
}

/** Motivo do bloqueio quando a filial está fora da licença aplicada (null = liberada). */
export async function branchOutsideLicense(store: Store, companyId: string, branchId: string): Promise<string | null> {
  const lic = await unscoped(store).get("company_licenses", licenseId(companyId));
  if (!lic?.snapshot || !(lic.licenseVersion > 0)) return null;
  return branchAllowedByLicense(lic.snapshot as LicenseSnapshot, branchId)
    ? null
    : "Filial fora da licença contratada: disponível só para consulta. Para operar, escolha uma filial autorizada ou fale com o responsável pelo contrato.";
}
