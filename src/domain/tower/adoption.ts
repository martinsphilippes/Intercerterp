import { listAll } from "@/lib/db";
import type { Doc, Filter } from "@/lib/db/types";
import { today } from "@/lib/dates";
import { fiscalSnapshot, latestSales } from "@/app/(app)/dashboard/queries";
import { monitorCounts } from "@/domain/ecommerce/monitor";
import { storeOfCompany } from "@/domain/ecommerce/common";
import { anyContracted } from "../tenancy/contracted";
import { userStats } from "@/domain/users";
import { inUnits, pt, SALE_STATUS_PT, type TowerRequest } from "./common";

/**
 * Adoção e operação (rota /torre/adocao). Fontes e confiabilidade (docs/multiempresa/mapeamento/05-indicadores-torre.md §5):
 *  - Atividade de usuários: `audit_logs` da empresa (registra OPERAÇÕES — venda, caixa, cadastros, exportações…; não
 *    registra navegação nem leitura). Ficam fora: tarefas do sistema (`system`), a própria interface de serviço
 *    (`servico:*`) e os registros de login — o login é gravado na PRIMEIRA empresa do usuário, não na empresa em que ele
 *    entrou, logo não é atribuível com segurança.
 *  - Último acesso: `users.lastAccessAt` (atualizado só no login; campo GLOBAL do usuário — com várias empresas, o login
 *    pode ter sido em outra). Entregue à parte, com a fonte declarada.
 *  - Atividade operacional por unidade: instantes primários (venda, abertura de caixa, movimento de estoque, emissão
 *    fiscal, pedido on-line).
 *  - Sem fonte confiável → `null`: atividade de terminal (não há registro de atividade/heartbeat do terminal) e falha
 *    de rotina diária (só o último sucesso é gravado).
 */

const DAY_MS = 86_400_000;

function humanActor(l: Doc) {
  const u = String(l.userId ?? "");
  return Boolean(u) && u !== "system" && !u.startsWith("servico:") && l.entityType !== "login";
}

async function latest(t: TowerRequest<any>, collection: string, field: string, extra: Filter[] = [], branchField: string | null = "branchId") {
  const filters: Filter[] = [["eq", "companyId", t.companyId], ["notNull", field], ...extra];
  if (branchField && t.branchIds) filters.push(["eq", branchField, t.branchIds]);
  const res = await t.store.list(collection, { filters, orderBy: [{ field, dir: "desc" }], limit: 1, total: false });
  return res.items[0] ?? null;
}

export async function adoptionBlock(t: TowerRequest<any>) {
  const has = (...keys: string[]) => anyContracted(t.areas, ...keys);
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY_MS).toISOString();
  const since7 = new Date(now - 7 * DAY_MS).toISOString();
  const nowIso = new Date(now).toISOString();
  const [logs, members, stats, lastSale, lastCash, lastStock, lastFiscal, fiscal, jobs, store, terminals] = await Promise.all([
    listAll(t.store, "audit_logs", { filters: [["eq", "companyId", t.companyId], ["gte", "occurredAt", since30]] }),
    listAll(t.store, "users"),
    userStats(t.store, t.companyId),
    latestSales(t.ctx, t.scopeBranchIds, 1).then((r) => r[0] ?? null),
    latest(t, "cash_sessions", "openedAt"),
    latest(t, "stock_movements", "occurredAt"),
    latest(t, "fiscal_documents", "issuedAt"),
    fiscalSnapshot(t.ctx, t.scopeBranchIds, { from: today(), to: today() }),
    listAll(t.store, "jobs", { filters: [["eq", "companyId", t.companyId], ["eq", "status", ["retry", "dead", "running", "held"]]] }),
    storeOfCompany(t.store, t.companyId),
    listAll(t.store, "terminals", { filters: [["eq", "companyId", t.companyId]] }),
  ]);
  const acts = logs.filter(humanActor);
  let lastActivity: Doc | null = acts.reduce<Doc | null>((a, l) => (!a || l.occurredAt > a.occurredAt ? l : a), null);
  if (!lastActivity) {
    // nada nos últimos 30 dias: procura entre os 200 registros anteriores mais recentes
    const older = await t.store.list("audit_logs", { filters: [["eq", "companyId", t.companyId], ["lt", "occurredAt", since30]], orderBy: [{ field: "occurredAt", dir: "desc" }], limit: 200, total: false });
    lastActivity = older.items.find(humanActor) ?? null;
  }
  // usuários da empresa (vínculo explícito; vendedores sem acesso ao sistema não contam)
  const users = members.filter((u) => (u.companyIds ?? []).includes(t.companyId) && !u.loginDisabled);
  const lastAccess = users.reduce<string | null>((a, u) => (u.lastAccessAt && (!a || u.lastAccessAt > a) ? u.lastAccessAt : a), null);
  const [monitor, lastOrder] = store
    ? await Promise.all([monitorCounts(t.ctx).catch(() => null), latest(t, "online_orders", "createdAt", [["eq", "storeId", store.id]])])
    : [null, null];
  return {
    ultimaAtividade: { em: (lastActivity?.occurredAt ?? null) as string | null, fonte: "auditoria" },
    ultimoAcesso: { em: lastAccess, fonte: "login" },
    usuarios: {
      total: stats.total,
      ativos: stats.active,
      convitesPendentes: stats.invited,
      convitesExpirados: stats.expired,
      suspensos: stats.suspended,
      inativos: stats.inactive,
      nuncaAcessaram: stats.neverAccessed,
    },
    usuariosAtivos: {
      ultimos7Dias: new Set(acts.filter((l) => l.occurredAt >= since7).map((l) => l.userId)).size,
      ultimos30Dias: new Set(acts.map((l) => l.userId)).size,
      fonte: "auditoria",
    },
    usuariosComAcesso: {
      ultimos7Dias: users.filter((u) => u.lastAccessAt && u.lastAccessAt >= since7).length,
      ultimos30Dias: users.filter((u) => u.lastAccessAt && u.lastAccessAt >= since30).length,
      fonte: "login",
    },
    atividadeOperacional: {
      // só o que a empresa contratou (correção 6): o campo de módulo não contratado vem null
      ultimaVenda: has("pdv", "vendas", "comercio_digital") && lastSale ? { em: lastSale.completedAt as string, idUnidade: (lastSale.branchId ?? null) as string | null, situacao: pt(SALE_STATUS_PT, lastSale.status) } : null,
      ultimaAberturaCaixaEm: has("pdv") ? ((lastCash?.openedAt ?? null) as string | null) : null,
      ultimoMovimentoEstoqueEm: has("estoque") ? ((lastStock?.occurredAt ?? null) as string | null) : null,
      ultimoDocumentoFiscalEm: has("fiscal") ? ((lastFiscal?.issuedAt ?? null) as string | null) : null,
      ultimoPedidoOnlineEm: has("comercio_digital") ? ((lastOrder?.createdAt ?? null) as string | null) : null,
    },
    terminais: {
      ativos: terminals.filter((x) => x.status === "active" && inUnits(t, x.branchId)).length,
      // sem fonte confiável: o terminal não registra atividade própria (sem heartbeat)
      ultimaAtividadeEm: null,
    },
    pendenciasIntegracao: {
      documentosFiscais: has("fiscal") ? { pendentes: fiscal.totals.pending, processando: fiscal.totals.processing, rejeitados: fiscal.totals.rejected } : null,
      comercioDigital: has("comercio_digital") && monitor ? { falhas: monitor.failed, pendentes: monitor.pending } : null,
      tarefas: {
        comFalhaEmNovaTentativa: jobs.filter((j) => j.status === "retry").length,
        esgotadas: jobs.filter((j) => j.status === "dead").length,
        travadas: jobs.filter((j) => j.status === "running" && j.lockedUntil && j.lockedUntil < nowIso).length,
        retidas: jobs.filter((j) => j.status === "held").length,
      },
      // sem fonte confiável: a falha das rotinas diárias não é gravada (só o último sucesso)
      rotinasComFalha: null,
    },
  };
}
