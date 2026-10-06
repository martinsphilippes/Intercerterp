import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";
import { listAll } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { sp, type SearchParams } from "@/lib/list";
import { getSetting } from "@/lib/core/settings";
import { lookups, nameMap } from "@/lib/server/lookups";
import { canDo } from "@/lib/permissions";
import { blindCountDifferences, blindCountState, expectedOf, expectedVisible, requiredChecklist, sessionSummary } from "@/domain/cash";
import { resolveTerminal } from "../../pdv/terminal";
import { ClosingForm } from "./closing-form";

export const metadata = { title: "Fechamento de caixa" };
export const dynamic = "force-dynamic";

function duration(fromIso: string) {
  const min = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 60000));
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")} de sessão`;
}

/** Fechamento de caixa (Tela 14): previsto × informado por meio, diferenças preservadas com justificativa, checklist e relatório. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("cash", "edit");
  const params = await searchParams;
  const store = s.ctx.store;
  const header = <PageHeader title="Conferência e fechamento" crumbs={[{ label: "Caixa", href: "/caixa" }, { label: "Fechamento" }]} description="Informe os valores contados e conciliados para apurar eventuais diferenças." />;
  let session = sp(params, "sessao") ? await store.get("cash_sessions", sp(params, "sessao")) : null;
  if (session && session.companyId !== s.ctx.companyId) session = null;
  if (!session) {
    if (!s.branch) return <>{header}<Notice tone="warn" title="Selecione uma filial" /></>;
    const r = await resolveTerminal(s, sp(params, "terminal") || null);
    session = r.session;
    if (!session) return <>{header}<Notice tone="info" title={`Nenhum caixa aberto em ${r.terminal?.name ?? "terminal"}`}>Não há sessão a fechar. <LinkButton className="ml-2" href="/caixa" size="sm">Ver sessões</LinkButton></Notice></>;
  }
  if (!s.branch) return <>{header}<Notice tone="warn" title="Selecione a filial da sessão para operar">O contexto consolidado é somente consulta: o fechamento é registrado na filial do caixa.</Notice></>;
  if (session.branchId !== s.ctx.branchId) return <>{header}<Notice tone="warn" title="Sessão de outra filial">Este caixa pertence a outra filial. Selecione a filial da sessão para fechá-lo.</Notice></>;
  if (session.operatorId !== s.user.id && !canDo(s.user, "cash.reopen")) {
    return <>{header}<Notice tone="warn" title="Caixa de outro operador">Somente o operador desta sessão (ou um supervisor de caixa) pode conferir e fechar esta gaveta.</Notice></>;
  }
  if (!["open", "reopened"].includes(session.status)) {
    return <>{header}<Notice tone="info" title={`Caixa nº ${session.number} já está fechado`}>Consulte a conferência registrada. <LinkButton className="ml-2" size="sm" href={`/caixa/${session.id}`}>Ver sessão</LinkButton></Notice></>;
  }
  const sum = await sessionSummary(s.ctx, session.id);
  const [users, terminals] = await Promise.all([nameMap(s.ctx, "users"), nameMap(s.ctx, "terminals")]);
  const sales = await listAll(store, "sales", { filters: [["eq", "cashSessionId", session.id]] });
  const cancelled = sales.filter((x) => x.status === "cancelled");
  const count = (t: string) => sum.movements.filter((m) => m.type === t).length;
  const blind = Boolean(await getSetting(store, s.ctx.companyId, session.branchId, "cash.blindClose", false));
  // conferência cega já apurada nesta versão (e ainda válida): o previsto pode ser exibido junto com a contagem registrada
  const blindState = blind ? blindCountState(session, expectedOf(sum)) : "none";
  const blindCounted = blindState === "valid" ? (session.blindCount.counted as Record<string, number>) : null;
  const staleHadDiff = blindState === "stale" && Object.keys(blindCountDifferences(session.blindCount)).length > 0;
  const blindResult = blindState === "valid" ? { differences: session.blindCount.differences ?? null, informed: session.blindCount.informed ?? null, kept: session.blindCount.kept ?? null } : null;
  // valores que permitem deduzir o previsto em dinheiro ficam ocultos até a contagem (supervisor de caixa vê)
  const showAmounts = await expectedVisible(s.ctx, session, blind);
  const hidden = "oculto";
  const methods = Object.entries(sum.byMethod)
    .map(([k, v]) => ({ key: k, label: v.label, count: v.count, expected: k === "cash" ? sum.expected.cash : v.expected }))
    .sort((a, b) => (a.key === "cash" ? -1 : b.key === "cash" ? 1 : a.label.localeCompare(b.label)));
  const accounts = await lookups.accounts(s.ctx);
  const cashAcc = (await store.list("financial_accounts", { filters: [["eq", "branchId", session.branchId], ["eq", "kind", "cash"], ["eq", "active", true]], limit: 1 })).items[0];
  return (
    <>
      <PageHeader
        title="Conferência e fechamento"
        crumbs={[{ label: "Caixa", href: "/caixa" }, { label: `Caixa nº ${session.number}`, href: `/caixa/${session.id}` }, { label: "Fechamento" }]}
        description={`${terminals.get(session.terminalId)} · aberto às ${formatDateTime(session.openedAt)} · operador ${users.get(session.operatorId) ?? "—"} · ${duration(session.openedAt)}${session.status === "reopened" ? ` · versão ${session.version} (reaberto)` : ""}`}
        actions={<LinkButton href={`/caixa/movimentos?sessao=${session.id}`}>← Voltar ao caixa</LinkButton>}
      />
      {blindState === "stale" && (
        <div className="mb-4">
          <Notice tone="warn" title="Nova contagem necessária">
            Houve vendas ou movimentos neste caixa depois da contagem cega registrada em {formatDateTime(session.blindCount?.at)}. A contagem anterior foi preservada no histórico; conte novamente e clique em “Apurar diferenças”.
            {staleHadDiff && " A diferença já revelada na contagem anterior continua valendo: a recontagem só pode mantê-la ou revelar diferença maior no mesmo sentido."}
          </Notice>
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vendas concluídas" value={sum.totals.salesCount} hint={showAmounts ? formatMoney(sum.totals.sales) : "valor oculto até a contagem"} href={`/vendas?sessao=${session.id}`} />
        <Stat label="Suprimentos" value={showAmounts ? formatMoney(sum.totals.supply) : hidden} hint={`${count("supply")} movimentação(ões)`} />
        <Stat label="Sangrias" value={showAmounts ? formatMoney(sum.totals.withdrawal) : hidden} hint={`${count("withdrawal")} movimentação(ões)`} />
        <Stat
          label="Cancelamentos / devoluções"
          value={showAmounts ? `${cancelled.length} · ${formatMoney(sum.totals.refunds)}` : `${cancelled.length} · ${count("refund")}`}
          hint={showAmounts ? `Vendas canceladas ${formatMoney(cancelled.reduce((a, x) => a + x.total, 0))}; saídas em espécie ${formatMoney(sum.totals.refunds)}` : "vendas canceladas · saídas em espécie (valores ocultos até a contagem)"}
          href={`/vendas?sessao=${session.id}&situacao=cancelled`}
        />
      </div>
      <ClosingForm
        sessionId={session.id}
        blind={blind}
        methods={blind && !blindCounted ? methods.map((m) => ({ ...m, expected: null })) : methods}
        initialCounted={blindCounted}
        initialBlind={blindResult}
        cashBreakdown={blind ? null : { opening: sum.totals.opening, cashSales: sum.totals.cashSales, supply: sum.totals.supply, withdrawal: sum.totals.withdrawal, refunds: sum.totals.refunds }}
        checklist={requiredChecklist(sum).map(({ key, label, hint }) => ({ key, label, hint }))}
        accounts={accounts.filter((a) => a.value !== cashAcc?.id)}
      />
    </>
  );
}
