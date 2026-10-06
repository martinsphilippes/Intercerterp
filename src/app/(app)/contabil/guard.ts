import "server-only";
import { redirect } from "next/navigation";
import { requireSession, type SessionInfo } from "@/lib/server/session";
import type { Crud } from "@/lib/permissions";

/**
 * Sessão para as telas da Gestão contábil: exige o módulo "accounting" e que a empresa ativa seja um
 * ESCRITÓRIO (kind "accounting"). Numa empresa operacional a área não existe: os perfis de loja não têm o
 * módulo (requireSession envia a /sem-permissao); um perfil que o tivesse por engano volta ao painel.
 */
export async function requireFirmSession(op: Crud = "view"): Promise<SessionInfo> {
  const s = await requireSession("accounting", op);
  if (s.company.kind !== "accounting") redirect("/dashboard");
  return s;
}
