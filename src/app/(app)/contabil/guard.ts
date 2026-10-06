import "server-only";
import { redirect } from "next/navigation";
import { requireSession, type SessionInfo } from "@/lib/server/session";
import type { Crud } from "@/lib/permissions";

/**
 * Sessão para as telas da Gestão contábil: exige o módulo "accounting" e que a empresa ativa seja um
 * ESCRITÓRIO (kind "accounting"). Numa empresa operacional a área não existe: volta ao painel.
 */
export async function requireFirmSession(op: Crud = "view"): Promise<SessionInfo> {
  const s = await requireSession("accounting", op);
  if (s.company.kind !== "accounting") redirect("/dashboard");
  return s;
}
