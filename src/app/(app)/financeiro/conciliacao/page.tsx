import Link from "next/link";
import { Landmark, Upload } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import { LinkButton } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-form";
import { EmptyState, Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { qs, sp, type SearchParams } from "@/lib/list";
import { formatMoney } from "@/lib/money";
import { addDays, formatDate, formatDateTime, today } from "@/lib/dates";
import { can, canDo } from "@/lib/permissions";
import { lookups, nameMap } from "@/lib/server/lookups";
import { getSetting } from "@/lib/core/settings";
import { normalizeSearch } from "@/lib/list";
import { accountBalanceAt } from "@/domain/finance";
import { lastStatementBalance, reconciliationWorkspace } from "@/domain/reconciliation";
import { ENTRY_KIND_LABEL, queryInstallments } from "../queries";
import { undoReconciliationAction } from "../actions";
import { Workspace, type WEntry, type WInst, type WRow } from "./workspace";

export const metadata = { title: "Conciliação bancária" };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("finance");
  const params = await searchParams;
  const accountsAll = await listAll(s.ctx.store, "financial_accounts", { filters: [["eq", "companyId", s.ctx.companyId]] });
  const bankAccounts = accountsAll.filter((a) => a.kind !== "cash" || a.id === sp(params, "account"));
  const t0 = today();
  const account = bankAccounts.find((a) => a.id === sp(params, "account")) ?? bankAccounts.find((a) => a.kind === "bank" && a.active !== false) ?? bankAccounts[0];
  const tab = sp(params, "tab") || "conciliar";
  const view = sp(params, "view") || "todos";
  const from = sp(params, "from") || addDays(t0, -60);
  const to = sp(params, "to") || t0;
  if (!account) {
    return (
      <>
        <PageHeader title="Conciliação bancária" crumbs={[{ label: "Financeiro" }, { label: "Conciliação bancária" }]} />
        <EmptyState title="Nenhuma conta bancária cadastrada" action={<Link className="text-brand-700 underline" href="/financeiro/cadastros?tab=contas">Cadastrar conta</Link>} />
      </>
    );
  }
  const ws = await reconciliationWorkspace(s.ctx, account.id, from, to);
  const titleIds = new Set<string>();
  // lançamentos referenciados por conciliações (podem estar fora da janela)
  const recIds = [...new Set(ws.bankTxs.map((b) => b.reconciliationId).filter(Boolean) as string[])];
  const recs = new Map<string, Doc>();
  for (let i = 0; i < recIds.length; i += 100) for (const r of await listAll(s.ctx.store, "reconciliations", { filters: [["eq", "id", recIds.slice(i, i + 100)]] })) recs.set(r.id, r);
  const entryMap = new Map(ws.entries.map((e) => [e.id, e]));
  const missing = [...new Set([...recs.values()].flatMap((r) => r.entryIds ?? []).filter((id: string) => !entryMap.has(id)))];
  for (let i = 0; i < missing.length; i += 100) for (const e of await listAll(s.ctx.store, "account_entries", { filters: [["eq", "id", missing.slice(i, i + 100)]] })) entryMap.set(e.id, e);
  for (const e of entryMap.values()) if (e.titleId) titleIds.add(e.titleId);
  const titles = new Map<string, Doc>();
  const tids = [...titleIds];
  for (let i = 0; i < tids.length; i += 100) for (const t of await listAll(s.ctx.store, "titles", { filters: [["eq", "id", tids.slice(i, i + 100)]] })) titles.set(t.id, t);
  const settleRefs = new Map<string, string>();
  const sIds = [...entryMap.values()].map((e) => e.settlementId).filter(Boolean) as string[];
  for (let i = 0; i < sIds.length; i += 100) for (const x of await listAll(s.ctx.store, "settlements", { filters: [["eq", "id", sIds.slice(i, i + 100)]] })) if (x.reference) settleRefs.set(x.id, x.reference);
  const toW = (e: Doc): WEntry => {
    const t = e.titleId ? titles.get(e.titleId) : null;
    return {
      id: e.id, date: e.date, description: e.description, amount: e.amount, reconciled: Boolean(e.reconciled), kindLabel: ENTRY_KIND_LABEL[e.kind] ?? e.kind,
      href: t ? `/financeiro/${t.kind === "payable" ? "pagar" : "receber"}/${t.id}` : `/financeiro/contas/${e.accountId}?from=${e.date}&to=${e.date}`,
      ref: [t ? `Título nº ${t.number}${t.documentNumber ? ` · doc. ${t.documentNumber}` : ""}` : null, e.settlementId && settleRefs.get(e.settlementId) ? `ref. ${settleRefs.get(e.settlementId)}` : null].filter(Boolean).join(" · ") || null,
    };
  };
  const allRows: WRow[] = ws.bankTxs.map((b) => {
    const sugg = ws.suggestions.get(b.id) ?? [];
    const best = sugg[0] ?? null;
    const rec = b.reconciliationId ? recs.get(b.reconciliationId) : null;
    const state: WRow["state"] =
      b.status === "reconciled" ? "reconciled" : b.status === "ignored" ? "ignored" : best ? (best.difference === 0 ? "suggested" : "divergent") : b.kind === "collection" && b.installmentId && ws.installments.get(b.installmentId)?.balance ? "settle" : "unmatched";
    return {
      id: b.id, date: b.date, description: b.description, docNumber: b.docNumber, externalId: b.externalId, kind: b.kind, amount: b.amount, status: b.status, state, lineNo: b.lineNo, notes: b.notes,
      linked: rec ? (rec.entryIds ?? []).map((id: string) => entryMap.get(id)).filter(Boolean).map(toW) : [],
      reconciliationId: b.reconciliationId, reconciledAt: rec?.createdAt ?? null,
      suggestion: best ? { entryIds: best.entryIds, score: best.score, reasons: best.reasons, difference: best.difference } : null,
      alternatives: sugg.slice(1).map((x) => ({ entryIds: x.entryIds, score: x.score, reasons: x.reasons, difference: x.difference })),
      installmentId: b.installmentId, paidAmount: b.paidAmount, feeAmount: b.feeAmount, interestAmount: b.interestAmount, discountAmount: b.discountAmount, ourNumber: b.ourNumber, yourNumber: b.yourNumber, occurrence: b.cnabOccurrence,
    };
  });
  const counts = {
    todos: allRows.length,
    conciliados: allRows.filter((r) => r.state === "reconciled").length,
    pendentes: allRows.filter((r) => ["suggested", "settle", "unmatched"].includes(r.state)).length,
    divergencias: allRows.filter((r) => r.state === "divergent").length,
    ignorados: allRows.filter((r) => r.state === "ignored").length,
  };
  const q = normalizeSearch(sp(params, "q"));
  const sort = sp(params, "sort") || "recent";
  let rows = allRows.filter((r) => (view === "conciliados" ? r.state === "reconciled" : view === "pendentes" ? ["suggested", "settle", "unmatched"].includes(r.state) : view === "divergencias" ? r.state === "divergent" : view === "ignorados" ? r.state === "ignored" : true));
  if (q) rows = rows.filter((r) => normalizeSearch(`${r.description} ${r.docNumber ?? ""} ${r.externalId ?? ""} ${r.ourNumber ?? ""} ${(Math.abs(r.amount) / 100).toFixed(2).replace(".", ",")}`).includes(q));
  rows = [...rows].sort((a, b) => (sort === "oldest" ? a.date.localeCompare(b.date) : sort === "amount" ? Math.abs(b.amount) - Math.abs(a.amount) : b.date.localeCompare(a.date)));
  const freeEntries = [...entryMap.values()].filter((e) => !e.reconciled && e.kind !== "initial" && e.kind !== "reversal" && !e.reversedBy).map(toW);
  const [openRec, openPay] = await Promise.all([queryInstallments(s.ctx, "receivable", { q: "", f: { state: "open" } }), queryInstallments(s.ctx, "payable", { q: "", f: { state: "open" } })]);
  const asW = (kind: "receivable" | "payable") => (r: (typeof openRec)[number]): WInst => ({
    id: r.id, kind, label: `Título nº ${r.titleNumber} · parc. ${r.installment}/${r.installments}${r.documentNumber ? ` · doc. ${r.documentNumber}` : ""}`,
    party: r.partyName, dueDate: r.dueDate, balance: r.balance, approved: kind === "receivable" || r.approvalStatus === "approved",
  });
  const installments: WInst[] = [...openRec.filter((r) => r.originType !== "sale_card").map(asW("receivable")), ...openPay.map(asW("payable"))];
  const [cats, methodsRaw, feeCat] = await Promise.all([
    lookups.finCategories(s.ctx),
    listAll(s.ctx.store, "payment_methods", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }),
    getSetting<string | null>(s.ctx.store, s.ctx.companyId, null, "finance.category.fees", null),
  ]);
  const methods = methodsRaw.filter((m) => !["store_credit", "crediario", "cash"].includes(m.kind)).map((m) => ({ value: m.id, label: m.name }));
  const stmt = await lastStatementBalance(s.ctx.store, account.id);
  const erpAt = stmt?.date ? await accountBalanceAt(s.ctx.store, account.id, stmt.date) : null;
  const lastImport = (await s.ctx.store.list("bank_imports", { filters: [["eq", "accountId", account.id]], orderBy: [{ field: "createdAt", dir: "desc" }], limit: 1, total: false })).items[0];
  const canWrite = can(s.user, "finance", "edit") && canDo(s.user, "finance.reconcile") && Boolean(s.ctx.branchId);
  const writeBlock = !s.ctx.branchId ? "Selecione uma filial (consolidado é somente consulta)." : !canDo(s.user, "finance.reconcile") ? "Sem permissão para conciliar extratos." : null;
  const base = `/financeiro/conciliacao${qs({ account: account.id, from: sp(params, "from") || null, to: sp(params, "to") || null })}`;
  const viewHref = (v: string) => `/financeiro/conciliacao${qs({ account: account.id, from: sp(params, "from") || null, to: sp(params, "to") || null, view: v === "todos" ? null : v, q: sp(params, "q") || null, sort: sp(params, "sort") || null })}`;
  const reconciledPct = counts.todos ? Math.round((counts.conciliados / counts.todos) * 1000) / 10 : 0;
  return (
    <>
      <PageHeader
        title="Conciliação bancária"
        crumbs={[{ label: "Financeiro" }, { label: "Conciliação bancária" }]}
        description="Compare o extrato bancário (e retornos de cobrança) com os lançamentos do ERP. Sugestões só valem depois de confirmadas."
        actions={
          can(s.user, "finance", "create") && (
            <LinkButton href={`/financeiro/conciliacao/importar?account=${account.id}`} variant="accent">
              <Upload className="size-4" /> Importar extrato
            </LinkButton>
          )
        }
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <Landmark className="size-5" />
            </span>
            <div>
              <p className="font-semibold text-ink">{account.name}</p>
              <p className="text-xs text-slate-500">
                {[account.bankCode && `Banco ${account.bankCode}`, account.agency && `Agência ${account.agency}`, account.accountNumber && `Conta ${account.accountNumber}`].filter(Boolean).join(" · ") || "Sem dados bancários"}
                {" · "}
                {lastImport ? (
                  <Link className="text-brand-700 hover:underline" href={`/financeiro/conciliacao/importacoes/${lastImport.id}`}>
                    última importação {formatDateTime(lastImport.createdAt)}
                  </Link>
                ) : (
                  "nenhuma importação"
                )}
              </p>
            </div>
          </div>
          <form method="get" action="/financeiro/conciliacao" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Conta
              <select name="account" defaultValue={account.id} className="focus-ring h-9 rounded-md border border-line bg-white px-2 text-sm">
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.active === false ? " (inativa)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              De
              <input type="date" name="from" defaultValue={from} className="focus-ring h-9 rounded-md border border-line px-2 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              Até
              <input type="date" name="to" defaultValue={to} className="focus-ring h-9 rounded-md border border-line px-2 text-sm" />
            </label>
            <button type="submit" className="h-9 rounded-md bg-brand-700 px-3 text-sm font-medium text-white hover:bg-brand-800">
              Aplicar
            </button>
          </form>
          <div className="text-right">
            <p className="text-xs text-slate-500">Saldo no extrato {stmt?.date ? `(${formatDate(stmt.date)})` : ""}</p>
            <p className="tabular text-xl font-semibold text-ink">{stmt ? formatMoney(stmt.amount) : "—"}</p>
            {stmt && erpAt != null && (
              <p className={cn("text-xs", stmt.amount === erpAt ? "text-emerald-700" : "text-amber-700")}>
                ERP na mesma data: {formatMoney(erpAt)}
                {stmt.amount !== erpAt && ` · diferença ${formatMoney(stmt.amount - erpAt)}`}
              </p>
            )}
            {!stmt && <p className="text-xs text-slate-500">Informado em arquivos OFX (LEDGERBAL)</p>}
          </div>
        </div>
      </Card>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Movimentações importadas" value={counts.todos} hint={`${formatDate(from)} a ${formatDate(to)}${counts.ignorados ? ` · ${counts.ignorados} ignorada(s)` : ""}`} href={viewHref("todos")} />
        <Stat label="Conciliadas" value={counts.conciliados} tone="good" hint={`${reconciledPct.toLocaleString("pt-BR")}% do extrato`} href={viewHref("conciliados")} />
        <Stat label="Pendentes" value={counts.pendentes} tone={counts.pendentes ? "warn" : "default"} hint={`${allRows.filter((r) => r.state === "suggested").length} com sugestão de valor exato`} href={viewHref("pendentes")} />
        <Stat label="Com divergência" value={counts.divergencias} tone={counts.divergencias ? "bad" : "default"} hint="Documento/data casam, valor difere" href={viewHref("divergencias")} />
      </div>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "conciliar", label: "Conciliar" },
          { key: "importacoes", label: "Importações" },
          { key: "historico", label: "Conciliações realizadas" },
        ]}
      />
      {tab === "conciliar" && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Situação" className="flex flex-wrap gap-2">
              {(
                [
                  ["todos", "Todos"],
                  ["conciliados", "Conciliados"],
                  ["pendentes", "Pendentes"],
                  ["divergencias", "Divergências"],
                  ["ignorados", "Ignorados"],
                ] as const
              ).map(([k, label]) => (
                <Link key={k} href={viewHref(k)} className={cn("rounded-full border px-3 py-1 text-sm", view === k ? "border-brand-800 bg-brand-800 text-white" : "border-line bg-white text-slate-600 hover:border-brand-300")}>
                  {label} ({counts[k]})
                </Link>
              ))}
            </nav>
            <form method="get" action="/financeiro/conciliacao" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="account" value={account.id} />
              {sp(params, "from") && <input type="hidden" name="from" value={from} />}
              {sp(params, "to") && <input type="hidden" name="to" value={to} />}
              {view !== "todos" && <input type="hidden" name="view" value={view} />}
              <input name="q" defaultValue={sp(params, "q")} placeholder="Buscar descrição, documento ou valor" aria-label="Buscar" className="focus-ring h-9 w-64 rounded-md border border-line px-3 text-sm" />
              <select name="sort" defaultValue={sort} aria-label="Ordenação" className="focus-ring h-9 rounded-md border border-line bg-white px-2 text-sm">
                <option value="recent">Mais recentes primeiro</option>
                <option value="oldest">Mais antigas primeiro</option>
                <option value="amount">Maior valor</option>
              </select>
              <button type="submit" className="h-9 rounded-md border border-line bg-white px-3 text-sm hover:bg-slate-50">
                Aplicar
              </button>
            </form>
          </div>
          {writeBlock && (
            <div className="mb-3">
              <Notice tone="warn">{writeBlock}</Notice>
            </div>
          )}
          <Workspace accountId={account.id} rows={rows} entries={freeEntries} installments={installments} categories={cats} feeCategoryId={feeCat} methods={methods} windowDays={ws.windowDays} canWrite={canWrite} writeBlock={writeBlock} />
          <p className="mt-3 text-xs text-slate-500">
            Exibindo {rows.length} de {counts.todos} movimentação(ões). Sugestões consideram valor exato, data (±{ws.windowDays} dias, parâmetro em Cadastros financeiros) e documento; nunca são aplicadas sem confirmação.
          </p>
        </>
      )}
      {tab === "importacoes" && <Imports accountId={account.id} s={s} />}
      {tab === "historico" && <History accountId={account.id} s={s} canWrite={canWrite} writeBlock={writeBlock} />}
    </>
  );
}

async function Imports({ accountId, s }: { accountId: string; s: Awaited<ReturnType<typeof requireSession>> }) {
  const imps = await listAll(s.ctx.store, "bank_imports", { filters: [["eq", "accountId", accountId]], orderBy: [{ field: "createdAt", dir: "desc" }] });
  const users = await nameMap(s.ctx, "users");
  if (!imps.length) return <EmptyState title="Nenhuma importação nesta conta" action={<Link className="text-brand-700 underline" href={`/financeiro/conciliacao/importar?account=${accountId}`}>Importar extrato ou retorno</Link>} />;
  return (
    <Card bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="table-base w-full text-sm">
          <thead>
            <tr>
              <th>Arquivo</th>
              <th>Formato / layout</th>
              <th>Banco</th>
              <th>Período</th>
              <th className="text-right">Novas</th>
              <th className="text-right">Duplicadas</th>
              <th className="text-right">Inválidas</th>
              <th className="text-right">Não suportadas</th>
              <th>Importado por</th>
              <th>Situação</th>
            </tr>
          </thead>
          <tbody>
            {imps.map((i) => (
              <tr key={i.id}>
                <td>
                  <Link className="font-medium text-brand-700 hover:underline" href={`/financeiro/conciliacao/importacoes/${i.id}`}>
                    {i.fileName}
                  </Link>
                </td>
                <td className="text-xs">
                  {i.summary?.formatLabel ?? i.format}
                  <br />
                  <span className="text-slate-500">{i.layoutVersion}</span>
                </td>
                <td>{i.bankCode ?? "—"}</td>
                <td className="text-xs">{i.summary?.period?.from ? `${formatDate(i.summary.period.from)} a ${formatDate(i.summary.period.to)}` : "—"}</td>
                <td className="tabular text-right">{i.summary?.created ?? "—"}</td>
                <td className="tabular text-right">{i.summary?.duplicates ?? "—"}</td>
                <td className={cn("tabular text-right", i.summary?.invalid && "text-red-700")}>{i.summary?.invalid ?? "—"}</td>
                <td className={cn("tabular text-right", i.summary?.unsupported && "text-amber-700")}>{i.summary?.unsupported ?? "—"}</td>
                <td className="text-xs">
                  {users.get(i.createdBy) ?? "—"}
                  <br />
                  {formatDateTime(i.createdAt)}
                </td>
                <td>{i.status === "completed" ? <Badge tone="good">Concluída</Badge> : <Badge tone="warn">Em processamento</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function History({ accountId, s, canWrite, writeBlock }: { accountId: string; s: Awaited<ReturnType<typeof requireSession>>; canWrite: boolean; writeBlock: string | null }) {
  const recs = await listAll(s.ctx.store, "reconciliations", { filters: [["eq", "accountId", accountId]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 300);
  const users = await nameMap(s.ctx, "users");
  if (!recs.length) return <EmptyState title="Nenhuma conciliação registrada nesta conta" />;
  const txIds = [...new Set(recs.flatMap((r) => r.bankTxIds ?? []))];
  const enIds = [...new Set(recs.flatMap((r) => r.entryIds ?? []))];
  const txs = new Map<string, Doc>();
  const ens = new Map<string, Doc>();
  for (let i = 0; i < txIds.length; i += 100) for (const t of await listAll(s.ctx.store, "bank_transactions", { filters: [["eq", "id", txIds.slice(i, i + 100)]] })) txs.set(t.id, t);
  for (let i = 0; i < enIds.length; i += 100) for (const e of await listAll(s.ctx.store, "account_entries", { filters: [["eq", "id", enIds.slice(i, i + 100)]] })) ens.set(e.id, e);
  const tIds = [...new Set([...ens.values()].map((e) => e.titleId).filter(Boolean) as string[])];
  const tkind = new Map<string, string>();
  for (let i = 0; i < tIds.length; i += 100) for (const t of await listAll(s.ctx.store, "titles", { filters: [["eq", "id", tIds.slice(i, i + 100)]] })) tkind.set(t.id, t.kind);
  const KIND: Record<string, string> = { manual: "Manual", settlement: "Baixa a partir do extrato", collection: "Retorno de cobrança" };
  return (
    <Card bodyClass="p-0">
      <div className="overflow-x-auto">
        <table className="table-base w-full text-sm">
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Extrato</th>
              <th>Lançamentos do ERP (valor alocado)</th>
              <th className="text-right">Diferença lançada</th>
              <th>Por</th>
              <th>Situação</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {recs.map((r) => (
              <tr key={r.id} className={r.status === "undone" ? "text-slate-400" : undefined}>
                <td className="whitespace-nowrap text-xs">{formatDateTime(r.createdAt)}</td>
                <td className="text-xs">
                  {KIND[r.kind] ?? "Manual"} · {(r.bankTxIds ?? []).length}:{(r.entryIds ?? []).length}
                </td>
                <td className="text-xs">
                  {(r.bankTxIds ?? []).map((id: string) => {
                    const t = txs.get(id);
                    return (
                      <div key={id}>
                        {t ? `${formatDate(t.date)} ${t.description} — ${formatMoney(t.amount)}` : id}
                      </div>
                    );
                  })}
                </td>
                <td className="text-xs">
                  {(r.allocations ?? []).map((a: any, k: number) => {
                    const e = ens.get(a.entryId);
                    return (
                      <div key={k}>
                        {e ? (e.titleId ? <Link className="hover:underline" href={`/financeiro/${tkind.get(e.titleId) === "payable" ? "pagar" : "receber"}/${e.titleId}`}>{e.description}</Link> : e.description) : a.entryId} — <span className="tabular">{formatMoney(a.amount)}</span>
                      </div>
                    );
                  })}
                </td>
                <td className="tabular text-right">{r.feeEntryId ? formatMoney(r.difference) : "—"}</td>
                <td className="text-xs">{users.get(r.createdBy) ?? "—"}</td>
                <td className="text-xs">
                  {r.status === "undone" ? (
                    <>
                      <StatusBadge kind="generic" status="cancelled" /> <span className="block">Desfeita: {r.undoReason}</span>
                    </>
                  ) : (
                    <StatusBadge kind="generic" status="reconciled" />
                  )}
                </td>
                <td className="text-right">
                  {r.status === "active" && <ActionButton action={undoReconciliationAction.bind(null, r.id)} label="Desfazer" size="sm" variant="ghost" askReason="Motivo para desfazer a conciliação:" disabled={!canWrite} title={writeBlock ?? undefined} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
