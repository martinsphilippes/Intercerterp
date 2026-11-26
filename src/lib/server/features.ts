import "server-only";
import { notFound } from "next/navigation";
import { BusinessError } from "@/lib/core/errors";
import { featureDefaultFor, isFeatureOn } from "@/lib/core/settings";
import type { SessionInfo } from "./session";
import { modulesForFeature } from "../modules/surfaces";
import { moduleDecision } from "./modules";

/**
 * Recursos novos (telas aditivas) controlados por `feature.<chave>` em Parâmetros — ligados por padrão, exceto os de
 * `FEATURE_DEFAULTS` em src/lib/core/settings.ts (fidelidade, lotes, reserva na pré-venda, reforma tributária e os recursos de tributação da Fase 7 nascem desligados).
 */
export type FeatureKey = "precificacaoEntrada" | "alteracaoMassa" | "etiquetas" | "inadimplencia" | "cobrancaWhatsapp" | "baixaLote" | "carne" | "comissoes" | "documentoComercial" | "balanca" | "kits" | "promocoes" | "fidelidade" | "lotes" | "reservaPreVenda" | "bipagemContagem" | "livroEntradas" | "cteEntrada" | "exportacaoDominio" | "inventarioFiscal" | "importacaoCadastros" | "taxasCartao" | "dre" | "fechamentoPeriodo" | "reformaTributaria" | "tributacaoCompleta" | "naturezasOperacao" | "creditoSimples" | "notaAConfirmar" | "arquivosFiscais" | "redeCertificacao" | "comercioDigital";

/**
 * Recurso disponível na interface = módulo do catálogo habilitado para a empresa (habilitação, docs/modulos) E recurso
 * ligado em Parâmetros (configuração). Assim toda aba, botão e tela já condicionados ao recurso respeitam o contrato.
 * As regras de domínio (isFeatureOn) não mudam com a habilitação: a integridade operacional (ex.: saldo por lote)
 * segue a configuração, e a política de desligamento do módulo cuida da transição.
 */
export async function featureOn(s: SessionInfo, key: FeatureKey): Promise<boolean> {
  const owners = modulesForFeature(key);
  if (owners.length && (await moduleDecision(s.ctx, s.company, owners)).level === "none") return false;
  return isFeatureOn(s.ctx.store, s.ctx.companyId, s.ctx.branchId, key, featureDefaultFor(key, s.company.kind));
}

/** Página de recurso desligado: responde como inexistente. */
export async function requireFeaturePage(s: SessionInfo, key: FeatureKey) {
  if (!(await featureOn(s, key))) notFound();
}

/** Ação de recurso desligado: mensagem clara (o administrador religa em Parâmetros › Recursos). */
export async function requireFeature(s: SessionInfo, key: FeatureKey) {
  if (!(await featureOn(s, key))) throw new BusinessError("Este recurso está desligado em Administração › Parâmetros › Recursos.", "feature_off");
}
