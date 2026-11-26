import { detId, findOne, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { PermissionError } from "@/lib/core/errors";
import { nowIso } from "@/lib/dates";

/**
 * Vínculos explícitos entre empresas (docs/multiempresa/arquitetura.md §5) — o registro único das relações que
 * autorizam um fluxo a atravessar a fronteira entre empresas:
 *  - `contabilidade`: escritório → empresa cliente (consentida pelo administrador da empresa ao aceitar o código);
 *  - `rede`: nó acima → parceiro abaixo na rede de certificação (inclui a plataforma → nível mais alto);
 *  - `certificacao`: plataforma Intercert → empresa atendida pela equipe de certificação.
 * Cada vínculo tem partes, tipo, ESCOPOS nomeados, situação (pendente, ativa, suspensa, revogada), consentimento e
 * histórico. As portas de leitura e gravação entre empresas conferem o vínculo no servidor (`requireRelation`).
 */

export type RelationType = "contabilidade" | "rede" | "certificacao";
export type RelationStatus = "pendente" | "ativa" | "suspensa" | "revogada";

export const RELATION_SCOPES: Record<RelationType, string[]> = {
  contabilidade: ["fiscal.leitura", "pacote.entrega", "certificado.acompanhamento"],
  rede: ["rede.vendas.leitura", "rede.clientes.leitura", "rede.financeiro.lancamento", "rede.precos", "rede.usuarios.leitura"],
  certificacao: ["certificado.operacao"],
};

export interface RelationActor {
  id: string;
  name: string;
}

export function relationId(from: string, to: string, type: RelationType) {
  return detId("relation", from, to, type);
}

export async function getRelation(store: Store, from: string, to: string, type: RelationType): Promise<Doc | null> {
  return unscoped(store).get("company_relations", relationId(from, to, type));
}

/** Cria ou atualiza o vínculo (idempotente) e acrescenta o evento ao histórico. */
export async function upsertRelation(
  store: Store,
  input: { from: string; to: string; type: RelationType; status: RelationStatus; scopes?: string[]; source: string; sourceId?: string | null; actor: RelationActor; consent?: Record<string, unknown> | null; reason?: string | null },
): Promise<Doc> {
  const base = unscoped(store);
  const id = relationId(input.from, input.to, input.type);
  const now = nowIso();
  const event = { at: now, status: input.status, by: input.actor.id, byName: input.actor.name, reason: input.reason ?? null, source: input.source };
  const cur = await base.get("company_relations", id);
  const scopes = input.scopes ?? cur?.scopes ?? RELATION_SCOPES[input.type];
  if (cur) {
    if (cur.status === input.status && JSON.stringify(cur.scopes ?? []) === JSON.stringify(scopes)) return cur;
    return base.update("company_relations", id, {
      status: input.status, scopes, source: input.source, sourceId: input.sourceId ?? cur.sourceId ?? null, consent: input.consent ?? cur.consent ?? null,
      validFrom: input.status === "ativa" && cur.status !== "ativa" ? now : cur.validFrom, revokedAt: input.status === "revogada" ? now : null, revokedBy: input.status === "revogada" ? input.actor.id : null,
      history: [...((cur.history ?? []) as unknown[]), event].slice(-50),
    });
  }
  try {
    return await base.create(
      "company_relations",
      {
        fromCompanyId: input.from, toCompanyId: input.to, type: input.type, scopes, status: input.status, consent: input.consent ?? null, validFrom: input.status === "ativa" ? now : null,
        source: input.source, sourceId: input.sourceId ?? null, createdBy: input.actor.id, revokedAt: input.status === "revogada" ? now : null, revokedBy: input.status === "revogada" ? input.actor.id : null, history: [event],
      },
      id,
    );
  } catch (e) {
    if (!isConflict(e)) throw e;
    return (await base.get("company_relations", id))!;
  }
}

/** O vínculo ativo autoriza o escopo? */
export async function relationAllows(store: Store, from: string, to: string, type: RelationType, scope: string): Promise<boolean> {
  const r = await getRelation(store, from, to, type);
  return Boolean(r && r.status === "ativa" && (r.scopes ?? []).includes(scope));
}

/** Porta entre empresas: exige vínculo ativo com o escopo (senão, recusa como falta de permissão). */
export async function requireRelation(store: Store, from: string, to: string, type: RelationType, scope: string) {
  if (!(await relationAllows(store, from, to, type, scope))) throw new PermissionError("Sem vínculo ativo entre as empresas para esta operação.");
}

/** Vínculos de uma empresa, nos dois sentidos (tela da empresa e sincronização com o Interos). */
export async function relationsOf(store: Store, companyId: string) {
  const base = unscoped(store);
  const [out, inn] = await Promise.all([
    listAll(base, "company_relations", { filters: [["eq", "fromCompanyId", companyId]] }),
    listAll(base, "company_relations", { filters: [["eq", "toCompanyId", companyId]] }),
  ]);
  return { outgoing: out, incoming: inn };
}

const NODE_STATUS: Record<string, RelationStatus> = { active: "ativa", suspended: "suspensa", closed: "revogada" };

/** Vínculo de rede de um nó: do nó acima (ou da empresa da plataforma) para a empresa do nó. */
export async function syncNodeRelation(store: Store, node: Doc, actor: RelationActor, previousParentCompanyId?: string | null) {
  const base = unscoped(store);
  const parent = node.parentNodeId ? await base.get("cert_network_nodes", node.parentNodeId) : null;
  const platform = parent ? null : await findOne(base, "companies", [["eq", "isPlatform", true]]);
  const from = parent?.nodeCompanyId ?? platform?.id ?? null;
  if (previousParentCompanyId && previousParentCompanyId !== from)
    await upsertRelation(store, { from: previousParentCompanyId, to: node.nodeCompanyId, type: "rede", status: "revogada", source: "cert_network_nodes", sourceId: node.id, actor, reason: "Parceiro movido para outro nó da rede" });
  if (!from) return null;
  return upsertRelation(store, { from, to: node.nodeCompanyId, type: "rede", status: NODE_STATUS[node.status ?? "active"] ?? "ativa", source: "cert_network_nodes", sourceId: node.id, actor, reason: node.statusReason ?? null });
}

export interface MaterializeReport {
  contabilidade: { ativos: number; revogados: number };
  rede: { ativos: number; suspensos: number; revogados: number; semOrigem: number };
  criados: number;
  atualizados: number;
}

/**
 * Migração: registra como vínculos explícitos as relações que hoje estão espalhadas (cliente contábil vinculado,
 * árvore da rede). Simulação (`apply: false`) só conta; aplicação grava (idempotente).
 */
export async function materializeRelations(store: Store, opts: { apply: boolean; actor: RelationActor }): Promise<MaterializeReport> {
  const base = unscoped(store);
  const report: MaterializeReport = { contabilidade: { ativos: 0, revogados: 0 }, rede: { ativos: 0, suspensos: 0, revogados: 0, semOrigem: 0 }, criados: 0, atualizados: 0 };
  const track = async (from: string, to: string, type: RelationType, status: RelationStatus, source: string, sourceId: string) => {
    const before = await getRelation(base, from, to, type);
    if (!opts.apply) return;
    const after = await upsertRelation(base, { from, to, type, status, source, sourceId, actor: opts.actor, reason: "Migração multiempresa: vínculo existente registrado" });
    if (!before) report.criados++;
    else if (before.status !== after.status) report.atualizados++;
  };
  for (const c of await listAll(base, "accounting_clients", { filters: [["notNull", "linkedCompanyId"]] })) {
    if (c.linkStatus === "active") {
      report.contabilidade.ativos++;
      await track(c.companyId, c.linkedCompanyId, "contabilidade", "ativa", "accounting_clients", c.id);
    } else if (c.linkStatus === "revoked") {
      report.contabilidade.revogados++;
      await track(c.companyId, c.linkedCompanyId, "contabilidade", "revogada", "accounting_clients", c.id);
    }
  }
  const nodes = await listAll(base, "cert_network_nodes");
  const platform = await findOne(base, "companies", [["eq", "isPlatform", true]]);
  for (const n of nodes) {
    const parent = n.parentNodeId ? nodes.find((x) => x.id === n.parentNodeId) : null;
    const from = parent?.nodeCompanyId ?? platform?.id ?? null;
    const status = NODE_STATUS[n.status ?? "active"] ?? "ativa";
    if (!from) {
      report.rede.semOrigem++;
      continue;
    }
    if (status === "ativa") report.rede.ativos++;
    else if (status === "suspensa") report.rede.suspensos++;
    else report.rede.revogados++;
    await track(from, n.nodeCompanyId, "rede", status, "cert_network_nodes", n.id);
  }
  return report;
}
