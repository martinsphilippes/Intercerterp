import Link from "@/components/ui/link";
import { Download, FilePlus2, Printer, Truck } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage, featureOn } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { addDays, addMonths, formatDate, formatDateTime, monthEnd, monthStart, today } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { qs, type SearchParams } from "@/lib/list";
import { lookups } from "@/lib/server/lookups";
import { ENTRY_SOURCE_LABEL, entriesBook, type EntryBookRow } from "@/domain/fiscal/entries";
import { AutoPrint } from "../../vendas/sale-widgets";
import { PrintStyles } from "../../vendas/print-styles";
import { entriesParams } from "./params";

export const metadata = { title: "Livro de entradas" };

const SOURCE_TONE: Record<EntryBookRow["source"], "neutral" | "info" | "warn" | "good"> = { receipt: "info", no_stock: "warn", cte: "neutral", own: "good" };

/** Livro / relatório de entradas (FIS-24): recebimentos concluídos, notas sem estoque, CT-e e NF-e de entrada próprias. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("fiscal");
  await requireFeaturePage(s, "livroEntradas");
  const params = await searchParams;
  const print = params.print === "1";
  const q = entriesParams(s.ctx, params);
  const book = await entriesBook(s.ctx, q);
  const branches = s.consolidated ? await lookups.branches(s.ctx) : [];
  const branchName = q.branchId ? branches.find((b) => b.value === q.branchId)?.label : s.branch?.name;
  const scopeLabel = branchName ?? "Todas as filiais";
  const exportQs = qs({ de: q.from, ate: q.to, filial: q.branchId });
  const canNoStock = canDo(s.user, "purchase.receive") && Boolean(s.ctx.branchId);
  const cteOn = await featureOn(s, "cteEntrada");
  const thisMonth = monthStart(today());
  const prevMonth = addMonths(thisMonth, -1);
  const periodLink = (from: string, to: string) => `/fiscal/entradas${qs({ de: from, ate: to, print: null }, params)}`;

  const body = (
    <>
      <section aria-label="Totais do período" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Documentos de entrada" value={book.totals.docs.toLocaleString("pt-BR")} hint={`${book.rows.length} linha(s) documento × CFOP`} />
        <Stat label="Valor contábil" value={formatMoney(book.totals.value)} hint={`Isentas/outras ${formatMoney(book.totals.exemptOther)}`} tone="good" />
        <Stat label="Base / ICMS" value={formatMoney(book.totals.icms)} hint={`Base ${formatMoney(book.totals.icmsBase)} · conforme XML`} />
        <Stat label="IPI · ICMS-ST" value={`${formatMoney(book.totals.ipi)} · ${formatMoney(book.totals.st)}`} hint={`Base ST ${formatMoney(book.totals.stBase)}`} />
      </section>
      {book.pendingReceipts.length > 0 && !print && (
        <Notice tone="warn">
          {book.pendingReceipts.length} recebimento(s) com NF-e emitida no período ainda em conferência (entram no livro na conclusão):{" "}
          {book.pendingReceipts.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link className="underline" href={`/compras/recebimentos/${p.id}`}>
                nº {p.number}
                {p.nfeNumber ? ` (NF-e ${p.nfeNumber})` : ""}
              </Link>
            </span>
          ))}
          .
        </Notice>
      )}
      {book.awaitingInvoice.length > 0 && !print && (
        <Notice tone="info">
          {book.awaitingInvoice.length} entrada(s) de mercadoria no período aguardando a nota do fornecedor (entram no livro ao confirmar a nota):{" "}
          {book.awaitingInvoice.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link className="underline" href={`/compras/recebimentos/${p.id}`}>
                nº {p.number}
              </Link>{" "}
              ({p.supplier})
            </span>
          ))}
          .
        </Notice>
      )}
      <Card title="Resumo por CFOP de entrada" bodyClass="p-0" className="mb-4 break-inside-avoid">
        {book.byCfop.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">Nenhuma entrada escriturada no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>CFOP</th>
                  <th>Descrição</th>
                  <th className="text-right">Docs.</th>
                  <th className="text-right">Valor contábil</th>
                  <th className="text-right">Base ICMS</th>
                  <th className="text-right">ICMS</th>
                  <th className="text-right">IPI</th>
                  <th className="text-right">ICMS-ST</th>
                  <th className="text-right">Isentas/outras</th>
                </tr>
              </thead>
              <tbody>
                {book.byCfop.map((g) => (
                  <tr key={g.id}>
                    <td className="tabular font-medium">{g.cfop || "—"}</td>
                    <td>{g.label}</td>
                    <td className="tabular text-right">{g.docs}</td>
                    <td className="tabular text-right">{formatMoney(g.value)}</td>
                    <td className="tabular text-right">{formatMoney(g.icmsBase)}</td>
                    <td className="tabular text-right">{formatMoney(g.icms)}</td>
                    <td className="tabular text-right">{formatMoney(g.ipi)}</td>
                    <td className="tabular text-right">{formatMoney(g.st)}</td>
                    <td className="tabular text-right">{formatMoney(g.exemptOther)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-3 py-2" colSpan={2}>Total</td>
                  <td className="tabular px-3 text-right">{book.totals.docs}</td>
                  <td className="tabular px-3 text-right">{formatMoney(book.totals.value)}</td>
                  <td className="tabular px-3 text-right">{formatMoney(book.totals.icmsBase)}</td>
                  <td className="tabular px-3 text-right">{formatMoney(book.totals.icms)}</td>
                  <td className="tabular px-3 text-right">{formatMoney(book.totals.ipi)}</td>
                  <td className="tabular px-3 text-right">{formatMoney(book.totals.st)}</td>
                  <td className="tabular px-3 text-right">{formatMoney(book.totals.exemptOther)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
      <Card title="Registro de entradas" description="Uma linha por documento × CFOP de entrada, pela data de entrada (conclusão do recebimento, lançamento da nota sem estoque, registro do CT-e) ou emissão (NF-e de entrada própria)." bodyClass="p-0">
        {book.rows.length === 0 ? (
          <EmptyState title="Sem entradas no período" description="Conclua recebimentos de mercadoria, lance CT-e de frete ou notas sem estoque para escriturá-los aqui." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base w-full text-sm">
              <thead>
                <tr>
                  <th>Entrada</th>
                  <th>Documento</th>
                  <th>Emitente</th>
                  <th>UF</th>
                  <th>CFOP</th>
                  <th className="text-right">Valor contábil</th>
                  <th className="text-right">Base ICMS</th>
                  <th className="text-right">ICMS</th>
                  <th className="text-right">IPI</th>
                  <th className="text-right">ICMS-ST</th>
                  <th className="text-right">Isentas/outras</th>
                </tr>
              </thead>
              <tbody>
                {book.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      {formatDate(r.entryDate)}
                      {r.issueDate && r.issueDate !== r.entryDate && <span className="block text-xs text-slate-500">emissão {formatDate(r.issueDate)}</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {print || !r.href ? (
                        `${r.modelLabel} ${r.number ?? "s/n"}${r.series ? `/${r.series}` : ""}`
                      ) : (
                        <Link className="text-brand-700 hover:underline" href={r.href}>
                          {r.modelLabel} {r.number ?? "s/n"}
                          {r.series ? `/${r.series}` : ""}
                        </Link>
                      )}
                      {!print && (
                        <span className="ml-1">
                          <Badge tone={SOURCE_TONE[r.source]}>{ENTRY_SOURCE_LABEL[r.source]}</Badge>
                        </span>
                      )}
                      {r.accessKey && <span className="block font-mono text-[10px] text-slate-500">{r.accessKey}</span>}
                      {r.note && <span className="block text-xs text-slate-500">{r.note}</span>}
                    </td>
                    <td className="max-w-[220px]">
                      <span className="block truncate">{r.emitter}</span>
                      <span className="block text-xs text-slate-500">{r.emitterDoc ? formatDoc(r.emitterDoc) : "—"}</span>
                    </td>
                    <td>{r.uf || "—"}</td>
                    <td className="tabular">{r.cfop || "—"}</td>
                    <td className="tabular text-right">{formatMoney(r.value)}</td>
                    <td className="tabular text-right">{formatMoney(r.icmsBase)}</td>
                    <td className="tabular text-right">{formatMoney(r.icms)}</td>
                    <td className="tabular text-right">{formatMoney(r.ipi)}</td>
                    <td className="tabular text-right">{formatMoney(r.st)}</td>
                    <td className="tabular text-right">{formatMoney(r.exemptOther)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );

  if (print) {
    return (
      <div className="flex flex-col gap-4">
        <PrintStyles paper="A4" />
        <div className="no-print flex gap-2">
          <AutoPrint enabled />
          <Link href={`/fiscal/entradas${qs({ print: null }, params)}`} className={buttonClass("secondary")}>
            Voltar
          </Link>
        </div>
        <article className="print-doc space-y-3 bg-white p-4 text-black" aria-label="Livro de entradas">
          <header className="border-b border-black pb-2">
            <h1 className="text-lg font-bold">Registro de entradas</h1>
            <p className="text-sm">
              {s.company.name} (CNPJ {s.company.cnpj ? formatDoc(s.company.cnpj) : "—"}) · {scopeLabel} · {formatDate(q.from)} a {formatDate(q.to)}
            </p>
            <p className="text-xs">Relatório de apoio à escrituração (não é arquivo de obrigação acessória) · emitido em {formatDateTime(new Date().toISOString())} por {s.user.name}</p>
          </header>
          {body}
        </article>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Livro de entradas"
        crumbs={[{ label: "Fiscal" }, { label: "Livro de entradas" }]}
        description={`Entradas escrituradas a partir dos recebimentos de compra (XML da NF-e), notas sem estoque, CT-e de frete e NF-e de entrada emitidas pela empresa — ${formatDate(q.from)} a ${formatDate(q.to)} · ${scopeLabel}.`}
        actions={
          <>
            {canNoStock && (
              <Link href="/fiscal/entradas/nova" className={buttonClass("accent")}>
                <FilePlus2 className="size-4" aria-hidden /> Nota sem estoque
              </Link>
            )}
            {cteOn && (
              <Link href="/compras/cte" className={buttonClass("secondary")}>
                <Truck className="size-4" aria-hidden /> CT-e de frete
              </Link>
            )}
            <Link href={`/fiscal/entradas${qs({ print: "1" }, params)}`} className={buttonClass("secondary")}>
              <Printer className="size-4" aria-hidden /> Imprimir
            </Link>
            {canDo(s.user, "data.export") && (
              <>
                <a className={buttonClass("secondary")} href={`/api/export/fiscal-livro-entradas${exportQs}`}>
                  <Download className="size-4" aria-hidden /> CSV do livro
                </a>
                <a className={buttonClass("ghost")} href={`/api/export/fiscal-entradas-cfop${exportQs}`}>
                  CSV por CFOP
                </a>
              </>
            )}
          </>
        }
      />
      <div className="no-print mb-4 rounded-lg border border-line bg-white p-3">
        <form method="get" action="/fiscal/entradas" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            De
            <input type="date" name="de" defaultValue={q.from} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Até
            <input type="date" name="ate" defaultValue={q.to} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm" />
          </label>
          {s.consolidated && branches.length > 0 && (
            <label className="flex min-w-[180px] flex-col gap-1 text-xs font-medium text-slate-600">
              Filial
              <select name="filial" defaultValue={q.branchId ?? ""} className="focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm">
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
            Filtrar
          </button>
          <span className="flex flex-wrap gap-1">
            <Link href={periodLink(prevMonth, monthEnd(prevMonth))} className={buttonClass("ghost", "sm")}>
              Mês anterior
            </Link>
            <Link href={periodLink(thisMonth, today())} className={buttonClass("ghost", "sm")}>
              Mês atual
            </Link>
            <Link href={periodLink(addDays(today(), -6), today())} className={buttonClass("ghost", "sm")}>
              Últimos 7 dias
            </Link>
          </span>
        </form>
      </div>
      {body}
      <p className="mt-3 text-xs text-slate-500">
        Valores do XML de cada NF-e (base, ICMS, IPI e ICMS-ST por item; valor contábil = produtos − desconto + frete, seguro, outras despesas, IPI e ST, fechando com o total da nota). Recebimentos lançados sem XML entram pelo valor do lançamento, sem base/ICMS. O frete de CT-e é escriturado no próprio CT-e (CFOP 1353/2353). Documentos de fornecedores não são gravados entre os documentos fiscais emitidos — o faturamento e os relatórios de saída não mudam. Relatório de apoio: não substitui o SPED/EFD.
      </p>
    </>
  );
}
