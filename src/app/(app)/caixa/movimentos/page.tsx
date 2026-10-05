import Link from "next/link";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Stat } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { canDo } from "@/lib/permissions";
import { parseList, sp, type SearchParams } from "@/lib/list";
import { getSetting } from "@/lib/core/settings";
import { lookups, nameMap } from "@/lib/server/lookups";
import { sessionSummary } from "@/domain/cash";
import { resolveTerminal } from "../../pdv/terminal";
import { queryCashMovements } from "../queries";
import { MovementForm } from "./movement-form";

export const metadata = { title: "Suprimentos e sangrias" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "good" | "bad" | "info" | "warn" | "neutral"> = { supply: "good", withdrawal: "bad", opening: "info", refund: "warn", sale: "neutral" };

/** Suprimentos e sangrias (Tela 13) da sessão aberta do terminal (ou de uma sessão informada). */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("cash");
  const params = await searchParams;
  const store = s.ctx.store;
  const header = (sub?: string) => <PageHeader title="Suprimentos e sangrias" crumbs={[{ label: "Caixa", href: "/caixa" }, { label: "Movimentos" }]} description={sub ?? "Registre entradas e retiradas de dinheiro durante a sessão do caixa."} />;
  let session = sp(params, "sessao") ? await store.get("cash_sessions", sp(params, "sessao")) : null;
  let terminalName = "";
  if (session && session.companyId !== s.ctx.companyId) session = null;
  if (!session) {
    if (!s.branch) return <>{header()}<Notice tone="warn" title="Selecione uma filial">Os movimentos são registrados na sessão de um terminal da filial.</Notice></>;
    const r = await resolveTerminal(s, sp(params, "terminal") || null);
    session = r.session;
    terminalName = r.terminal?.name ?? "";
    if (!session) {
      return (
        <>
          {header()}
          <Notice tone="warn" title={`Nenhum caixa aberto em ${terminalName || "terminal da filial"}`}>
            Abra o caixa para registrar suprimentos e sangrias. <div className="mt-2"><LinkButton href={`/caixa/abertura${r.terminal ? `?terminal=${r.terminal.id}` : ""}`} variant="primary">Abrir caixa</LinkButton></div>
          </Notice>
        </>
      );
    }
  }
  const users = await nameMap(s.ctx, "users");
  const terminals = await nameMap(s.ctx, "terminals");
  terminalName = terminals.get(session.terminalId) ?? terminalName;
  const sum = await sessionSummary(s.ctx, session.id);
  const p = parseList(params);
  const rows = await queryCashMovements(s.ctx, { q: "", f: { ...p.f, sessao: session.id } });
  const all = await queryCashMovements(s.ctx, { q: "", f: { sessao: session.id } });
  const open = ["open", "reopened"].includes(session.status);
  const limit = Number(await getSetting(store, s.ctx.companyId, session.branchId, "cash.withdrawalApprovalAbove", 0)) || 0;
  const [accounts, userOpts] = await Promise.all([lookups.accounts(s.ctx), lookups.users(s.ctx)]);
  const cashAcc = (await store.list("financial_accounts", { filters: [["eq", "branchId", session.branchId], ["eq", "kind", "cash"], ["eq", "active", true]], limit: 1 })).items[0];
  const count = (t: string) => all.filter((m) => m.type === t).length;
  return (
    <>
      <PageHeader
        title="Suprimentos e sangrias"
        crumbs={[{ label: "Caixa", href: "/caixa" }, { label: `Caixa nº ${session.number}`, href: `/caixa/${session.id}` }, { label: "Movimentos" }]}
        description={`${terminalName} · ${open ? `aberto desde ${formatDateTime(session.openedAt)}` : `sessão ${session.status === "closed" ? "fechada" : session.status}`} · operador ${users.get(session.operatorId) ?? "—"}`}
        actions={
          <>
            <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-right">
              <p className="text-xs text-brand-700">Saldo em dinheiro estimado</p>
              <p className="tabular text-xl font-bold text-brand-800">{formatMoney(sum.expected.cash)}</p>
            </div>
            {open && <LinkButton href={`/caixa/fechamento?sessao=${session.id}`}>Fechar caixa</LinkButton>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Fundo de abertura" value={formatMoney(sum.totals.opening)} hint="Não é receita" />
        <Stat label="Vendas em dinheiro" value={formatMoney(sum.totals.cashSales)} hint={`valor aplicado (troco já descontado: ${formatMoney(sum.totals.change)})`} tone="good" href={`/caixa/${session.id}?tab=vendas`} />
        <Stat label="Suprimentos" value={formatMoney(sum.totals.supply)} hint={`${count("supply")} movimentação(ões)`} tone="good" />
        <Stat label="Sangrias" value={formatMoney(sum.totals.withdrawal)} hint={`${count("withdrawal")} movimentação(ões)`} tone="bad" />
        <Stat label="Devoluções em espécie" value={formatMoney(sum.totals.refunds)} hint={`${count("refund")} saída(s) a clientes`} tone={sum.totals.refunds ? "warn" : "default"} />
      </div>
      <p className="mb-4 text-xs text-slate-500">Saldo estimado = fundo {formatMoney(sum.totals.opening)} + vendas em dinheiro {formatMoney(sum.totals.cashSales)} + suprimentos {formatMoney(sum.totals.supply)} − sangrias {formatMoney(sum.totals.withdrawal)} − devoluções {formatMoney(sum.totals.refunds)} = <b>{formatMoney(sum.expected.cash)}</b>. Sangria não reduz faturamento; suprimento não é venda.</p>
      <div className="grid gap-4 lg:grid-cols-[400px_minmax(0,1fr)]">
        <div>
          {open && canDo(s.user, "cash.withdrawal") ? (
            <MovementForm sessionId={session.id} available={sum.expected.cash} limit={limit} accounts={accounts.filter((a) => a.value !== cashAcc?.id)} users={userOpts} />
          ) : (
            <Notice tone="info" title={open ? "Sem permissão" : "Sessão encerrada"}>{open ? "Seu perfil não pode registrar sangria/suprimento." : "Movimentos só podem ser registrados em caixa aberto."}</Notice>
          )}
        </div>
        <section className="rounded-lg border border-line bg-white">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Movimentações desta sessão</h2>
            <form method="get" className="flex gap-2 text-sm">
              {sp(params, "sessao") && <input type="hidden" name="sessao" value={session.id} />}
              <select name="tipo" defaultValue={p.f.tipo ?? ""} className="h-8 rounded border border-line bg-white px-2" aria-label="Tipo">
                <option value="">Todos os tipos</option>
                <option value="opening">Abertura</option>
                <option value="supply">Suprimentos</option>
                <option value="withdrawal">Sangrias</option>
                <option value="refund">Devoluções</option>
                <option value="vendas">Vendas em dinheiro</option>
              </select>
              <select name="ordem" defaultValue={p.f.ordem ?? ""} className="h-8 rounded border border-line bg-white px-2" aria-label="Ordenação">
                <option value="">Mais recentes</option>
                <option value="antigos">Mais antigos</option>
              </select>
              <button className="h-8 rounded border border-line px-3 hover:bg-slate-50">Filtrar</button>
            </form>
          </header>
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead><tr><th>Horário</th><th>Tipo</th><th>Motivo</th><th>Responsável</th><th className="text-right">Valor</th><th /></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="tabular">{formatDateTime(m.occurredAt).split(" ")[1]}<span className="block text-xs text-slate-500">{formatDate(m.occurredAt)}</span></td>
                    <td><Badge tone={TONE[m.type] ?? "neutral"}>{m.typeLabel}</Badge>{m.number ? <span className="block text-xs text-slate-500">nº {m.number}</span> : null}</td>
                    <td>{m.reason}<span className="block text-xs text-slate-500">{m.type === "withdrawal" ? `Destino: ${m.accountName ?? "cofre / numerário físico"}` : m.type === "supply" ? `Origem: ${m.accountName ?? "numerário físico"}` : m.saleId ? <Link className="text-brand-700 hover:underline" href={`/vendas/${m.saleId}`}>ver venda</Link> : terminalName}</span></td>
                    <td>{m.recipient ?? m.createdByName}<span className="block text-xs text-slate-500">Por {m.createdByName}{m.approvedByName ? ` · autorizado por ${m.approvedByName}` : ""}</span></td>
                    <td className={`tabular text-right font-medium ${m.amount < 0 ? "text-red-700" : m.type === "opening" ? "" : "text-emerald-700"}`}>{m.amount < 0 ? "− " : m.type === "opening" ? "" : "+ "}{formatMoney(Math.abs(m.amount))}</td>
                    <td>{["supply", "withdrawal", "opening"].includes(m.type) && <Link className="text-xs text-brand-700 hover:underline" href={`/caixa/movimentos/${m.id}/comprovante`}>Comprovante</Link>}</td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-500">Nenhuma movimentação para o filtro.</td></tr>}
              </tbody>
            </table>
          </div>
          <footer className="flex justify-between border-t border-line px-4 py-2 text-xs text-slate-500">
            <span>{rows.length} movimentação(ões) registrada(s)</span>
            <span className="flex gap-3"><a className="text-brand-700 hover:underline" href={`/api/export/cash_movements?sessao=${session.id}${p.f.tipo ? `&tipo=${p.f.tipo}` : ""}`}>Exportar (CSV)</a> Auditoria ativa · {terminalName}</span>
          </footer>
        </section>
      </div>
    </>
  );
}
