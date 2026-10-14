import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { Settings2 } from "lucide-react";
import { listAll } from "@/lib/db";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { can, canDo } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { addMonths, formatDate, formatDateTime, monthEnd, monthStart, today } from "@/lib/dates";
import { qs, sp, type SearchParams } from "@/lib/list";
import { lookups } from "@/lib/server/lookups";
import { getIntegration } from "@/domain/integrations";
import { dominioEntries, dominioFileLines, dominioHistory, dominioMissingAccounts } from "@/domain/accounting/dominio";
import { AccountingCodesForm, GenerateDominioForm } from "./forms";

export const metadata = { title: "Exportação para a Domínio" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORIGIN_LABEL = { title: "Título", settlement: "Baixa", reversal: "Estorno" } as const;

/** CTB-02: arquivo de lançamentos contábeis (títulos e baixas do período) no layout de importação da Domínio. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("finance");
  await requireFeaturePage(s, "exportacaoDominio");
  if (!canDo(s.user, "data.export")) notFound();
  const params = await searchParams;
  const prev = addMonths(monthStart(today()), -1);
  const de = sp(params, "de");
  const ate = sp(params, "ate");
  const from = DATE_RE.test(de) ? de : prev;
  const to = DATE_RE.test(ate) && ate >= from ? ate : monthEnd(from);
  const branchId = s.ctx.branchId ? null : sp(params, "filial") || null;
  const integ = await getIntegration(s.ctx.store, s.ctx.companyId, branchId ?? s.ctx.branchId, "accounting_dominio");
  const r = await dominioEntries(s.ctx, { from, to, branchId });
  const missingCfg = dominioMissingAccounts(r.config);
  const fileLines = dominioFileLines(r.lines.slice(0, 30), r.config);
  const history = await dominioHistory(s.ctx);
  const branches = s.consolidated ? await lookups.branches(s.ctx) : [];
  const [cats, accs] = await Promise.all([listAll(s.ctx.store, "fin_categories", { filters: [["eq", "companyId", s.ctx.companyId]] }), listAll(s.ctx.store, "financial_accounts", { filters: [["eq", "companyId", s.ctx.companyId]] })]);
  const byOrigin = (t: keyof typeof ORIGIN_LABEL) => r.lines.filter((l) => l.origin.type === t).length;
  const periodLink = (f: string) => `/financeiro/exportacao-dominio${qs({ de: f, ate: monthEnd(f) }, params)}`;
  return (
    <>
      <PageHeader
        title="Exportação de lançamentos para a Domínio"
        crumbs={[{ label: "Financeiro" }, { label: "Exportação Domínio" }]}
        description="Arquivo texto de lançamentos contábeis (títulos emitidos e baixas do período) para importação na Domínio (Thomson Reuters). Sem API: gere o arquivo e envie ao escritório."
        actions={
          canDo(s.user, "admin.integrations") ? (
            <Link href="/administracao/integracoes/accounting_dominio" className={buttonClass("secondary")}>
              <Settings2 className="size-4" aria-hidden /> Layout e contas
            </Link>
          ) : null
        }
      />
      {!integ && <Notice tone="warn">Layout da Domínio ainda não configurado: informe as contas (Fornecedores, Clientes, Caixa/Bancos, juros, descontos) em Administração › Central de integrações › Domínio. A prévia abaixo usa contas vazias.</Notice>}
      {integ && missingCfg.length > 0 && <Notice tone="warn">Contas obrigatórias do regime {r.config.regime === "caixa" ? "de caixa" : "de competência"} sem código: {missingCfg.join(", ")}.</Notice>}
      <div className="no-print mb-4 rounded-lg border border-line bg-white p-3">
        <form method="get" action="/financeiro/exportacao-dominio" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            De
            <input type="date" name="de" defaultValue={from} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Até
            <input type="date" name="ate" defaultValue={to} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm" />
          </label>
          {s.consolidated && branches.length > 0 && (
            <label className="flex min-w-[180px] flex-col gap-1 text-xs font-medium text-slate-600">
              Filial
              <select name="filial" defaultValue={branchId ?? ""} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm">
                <option value="">Todas as filiais</option>
                {branches.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" className={buttonClass("primary")}>
            Ver prévia
          </button>
          <span className="flex gap-1">
            <Link href={periodLink(prev)} className={buttonClass("ghost", "sm")}>
              Mês anterior
            </Link>
            <Link href={periodLink(monthStart(today()))} className={buttonClass("ghost", "sm")}>
              Mês atual
            </Link>
          </span>
        </form>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lançamentos" value={r.lines.length} hint={`${byOrigin("title")} de títulos · ${byOrigin("settlement")} de baixas · ${byOrigin("reversal")} de estornos`} />
        <Stat label="Valor total" value={formatMoney(r.total)} hint={`${formatDate(from)} a ${formatDate(to)}`} />
        <Stat label="Sem conta contábil" value={r.pending.length} tone={r.pending.length ? "bad" : "good"} hint="A Domínio recusa linha sem conta" />
        <Stat label="Regime" value={r.config.regime === "caixa" ? "Caixa" : "Competência"} hint={`Separador “${r.config.separator}” · histórico ${r.config.historyCode || "—"}`} />
      </div>
      <Card title="Gerar arquivo" className="mb-4">
        <GenerateDominioForm from={from} to={to} branchId={branchId} disabled={!integ} />
        <p className="mt-2 text-xs text-slate-500">
          Layout assumido (confira com o escritório na primeira importação): uma linha por lançamento — data (DD/MM/AAAA){r.config.separator}conta débito{r.config.separator}conta crédito{r.config.separator}valor (1234,56){r.config.separator}código do histórico{r.config.separator}complemento{r.config.separator}documento — sem cabeçalho, ISO-8859-1, CRLF. Mesmo período e mesmos dados geram o mesmo arquivo.
        </p>
      </Card>
      {r.pending.length > 0 && (
        <Card title="Lançamentos sem conta contábil" className="mb-4" bodyClass="p-0">
          <ul className="divide-y divide-line text-sm">
            {r.pending.slice(0, 20).map((l, i) => (
              <li key={i} className="px-4 py-2">
                {formatDate(l.date)} · {l.complement} · {formatMoney(l.amount)} — falta {l.missing.join(" e ")}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title="Prévia do arquivo" description={r.lines.length > 30 ? `Primeiras 30 de ${r.lines.length} linhas.` : undefined} bodyClass="p-0" className="mb-4">
        {r.lines.length === 0 ? (
          <EmptyState title="Nenhum lançamento no período" description="Não há títulos emitidos nem baixas no recorte escolhido." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Origem</th>
                  <th>Débito</th>
                  <th>Crédito</th>
                  <th className="text-right">Valor</th>
                  <th>Complemento</th>
                </tr>
              </thead>
              <tbody>
                {r.lines.slice(0, 30).map((l, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{formatDate(l.date)}</td>
                    <td>
                      <Badge tone={l.origin.type === "reversal" ? "warn" : "neutral"}>{ORIGIN_LABEL[l.origin.type]}</Badge>
                    </td>
                    <td className="tabular">{l.debit || <span className="text-red-700">—</span>}</td>
                    <td className="tabular">{l.credit || <span className="text-red-700">—</span>}</td>
                    <td className="tabular text-right">{formatMoney(l.amount)}</td>
                    <td className="max-w-[420px] truncate" title={l.complement}>
                      {l.complement}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <pre className="overflow-x-auto border-t border-line bg-slate-50 p-3 text-[11px] leading-5 text-slate-700">{fileLines.join("\n")}</pre>
          </div>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card title="Códigos contábeis (Domínio)" description="Código reduzido da conta na Domínio. Categoria sem código usa o da categoria-mãe ou a conta padrão do layout; conta financeira sem código usa a conta Caixa/Bancos padrão.">
          <AccountingCodesForm
            canEdit={can(s.user, "finance", "edit")}
            categories={cats.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")).map((c) => ({ id: c.id, name: c.name, code: c.accountingCode ?? "", hint: c.type === "revenue" ? "Receita" : "Despesa" }))}
            accounts={accs.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR")).map((a) => ({ id: a.id, name: a.name, code: a.accountingCode ?? "", hint: a.kind === "cash" ? "Caixa" : "Banco" }))}
          />
        </Card>
        <Card title="Arquivos gerados" bodyClass="p-0">
          {history.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500">Nenhum arquivo gerado ainda.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 px-4 py-2">
                  <a className="truncate text-brand-700 hover:underline" href={`/api/files/${h.id}`}>
                    {h.name}
                  </a>
                  <span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(h.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
