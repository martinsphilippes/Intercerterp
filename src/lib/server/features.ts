import "server-only";
import { notFound } from "next/navigation";
import { BusinessError } from "@/lib/core/errors";
import { isFeatureOn } from "@/lib/core/settings";
import type { SessionInfo } from "./session";

/** Recursos novos (telas aditivas) controlados por `feature.<chave>` em Parâmetros — ligados por padrão. */
export type FeatureKey = "precificacaoEntrada" | "alteracaoMassa" | "etiquetas" | "inadimplencia" | "cobrancaWhatsapp" | "baixaLote" | "carne" | "comissoes" | "documentoComercial" | "balanca" | "kits";

export function featureOn(s: SessionInfo, key: FeatureKey): Promise<boolean> {
  return isFeatureOn(s.ctx.store, s.ctx.companyId, s.ctx.branchId, key, true);
}

/** Página de recurso desligado: responde como inexistente. */
export async function requireFeaturePage(s: SessionInfo, key: FeatureKey) {
  if (!(await featureOn(s, key))) notFound();
}

/** Ação de recurso desligado: mensagem clara (o administrador religa em Parâmetros › Recursos). */
export async function requireFeature(s: SessionInfo, key: FeatureKey) {
  if (!(await featureOn(s, key))) throw new BusinessError("Este recurso está desligado em Administração › Parâmetros › Recursos.", "feature_off");
}
