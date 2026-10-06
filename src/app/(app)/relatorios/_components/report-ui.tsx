import Link from "next/link";
import { formatDateTimeSeconds } from "@/lib/dates";
import { ArrowDownRight, ArrowUpRight, Filter, Info, Minus } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/form";
import { cn } from "@/components/ui/cn";
import { qs, type SearchParams } from "@/lib/list";
import { formatBps, formatMoney } from "@/lib/money";
import { PERIOD_PRESETS, variationBps } from "@/domain/reports";
import type { ReportParams } from "../params";
import { PeriodFields } from "./period-fields";

/**
 * Filtros das telas de análise (uma linha acima do conteúdo, estado na URL):
 * atalhos de período, período personalizado, filial e filtros específicos da tela.
 */
export function ReportFilters({ basePath, params, rp, keep = [], children, help, submitLabel = "Aplicar" }: { basePath: string; params: SearchParams; rp: ReportParams; keep?: string[]; children?: React.ReactNode; help?: React.ReactNode; submitLabel?: string }) {
  const v = (k: string) => {
    const x = params[k];
    return (Array.isArray(x) ? x[0] : x) ?? "";
  };
  return (
    <div className="no-print mb-4 space-y-2">
      <nav aria-label="Atalhos de período" className="flex flex-wrap gap-1.5">
        {PERIOD_PRESETS.filter((p) => p.key !== "personalizado").map((p) => {
          const active = rp.period.preset === p.key;
          return (
            <Link
              key={p.key}
              aria-current={active ? "true" : undefined}
              href={`${basePath}${qs({ periodo: p.key, de: null, ate: null, page: null }, params)}`}
              className={cn("focus-ring rounded-full border px-3 py-1 text-xs font-medium", active ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-slate-600 hover:border-brand-300 hover:text-brand-800")}
            >
              {p.label}
            </Link>
          );
        })}
        {rp.period.preset === "personalizado" && <span className="rounded-full border border-brand-700 bg-brand-700 px-3 py-1 text-xs font-medium text-white">Personalizado</span>}
      </nav>
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-3">
        <PeriodFields preset={rp.period.preset} from={rp.period.from} to={rp.period.to} presets={PERIOD_PRESETS} />
        {rp.branchOptions.length > 1 && (
          <label className="flex min-w-[200px] flex-col gap-1 text-xs font-medium text-slate-600">
            Filial
            <select name="filial" defaultValue={rp.filial} className={cn(inputClass, "h-9")}>
              {rp.branchOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {children}
        {keep.map((k) => (v(k) ? <input key={k} type="hidden" name={k} value={v(k)} /> : null))}
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("primary")}>
            <Filter className="size-4" aria-hidden /> {submitLabel}
          </button>
          <Link href={basePath} className={buttonClass("ghost")}>
            Limpar
          </Link>
        </div>
        <p className="basis-full text-xs text-slate-500">{help ?? "Datas inclusivas (o último dia entra inteiro), no horário de Brasília."}</p>
      </form>
    </div>
  );
}

/** Select simples para filtros específicos dentro de ReportFilters. */
export function FilterSelect({ name, label, value, options, all }: { name: string; label: string; value: string; options: Array<{ value: string; label: string }>; all?: string }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1 text-xs font-medium text-slate-600">
      {label}
      <select name={name} defaultValue={value} className={cn(inputClass, "h-9")}>
        {all !== undefined && <option value="">{all}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Contexto do recorte (período, filial, comparação) — aparece também na impressão. */
export function ScopeLine({ rp, compare, extra, company }: { rp: ReportParams; compare?: { from: string; to: string } | null; extra?: React.ReactNode; company?: string }) {
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
      {company && (
        <span>
          <strong className="font-semibold text-slate-700">Empresa:</strong> {company}
        </span>
      )}
      <span>
        <strong className="font-semibold text-slate-700">Período:</strong> {rp.period.label} ({rp.period.days} {rp.period.days === 1 ? "dia" : "dias"})
      </span>
      <span>
        <strong className="font-semibold text-slate-700">Filial:</strong> {rp.branchName}
      </span>
      {compare && (
        <span>
          <strong className="font-semibold text-slate-700">Comparação:</strong> {compare.from === compare.to ? fmtDate(compare.from) : `${fmtDate(compare.from)} a ${fmtDate(compare.to)}`} (mesma quantidade de dias, imediatamente anterior)
        </span>
      )}
      {extra}
      <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600" title="Vendas pela data de conclusão; devoluções pela data do movimento da devolução">
        Data de cada movimento
      </span>
    </p>
  );
}

function fmtDate(d: string) {
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}

/** Variação vs período anterior: ▲/▼ com rótulo textual (cor nunca sozinha). */
export function Delta({ cur, prev, kind = "money", goodWhenUp = true, label = "vs período anterior" }: { cur: number | null; prev: number | null; kind?: "money" | "count" | "points"; goodWhenUp?: boolean; label?: string }) {
  if (prev == null || cur == null) return <span className="text-slate-500">Sem base de comparação</span>;
  let text: string;
  let dir: number;
  if (kind === "points") {
    dir = Math.sign(cur - prev);
    text = `${cur - prev >= 0 ? "+" : "−"}${formatBps(Math.abs(cur - prev)).replace("%", "")} p.p.`;
  } else {
    const v = variationBps(cur, prev);
    if (v == null) return <span className="text-slate-500">Período anterior sem movimento ({kind === "money" ? formatMoney(prev) : prev})</span>;
    dir = Math.sign(v);
    text = `${v >= 0 ? "+" : "−"}${formatBps(Math.abs(v), 1)}`;
  }
  const good = dir === 0 ? null : (dir > 0) === goodWhenUp;
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={cn("inline-flex items-center gap-0.5 font-medium", good == null ? "text-slate-600" : good ? "text-emerald-700" : "text-red-700")}>
        <Icon className="size-3.5" aria-hidden />
        {text}
      </span>
      <span className="text-slate-500">
        {label} ({kind === "money" ? formatMoney(prev) : kind === "points" ? formatBps(prev) : prev.toLocaleString("pt-BR")})
      </span>
    </span>
  );
}

export function marginText(bps: number | null) {
  return bps == null ? "Sem receita" : formatBps(bps);
}

/** "Como calculamos": definições exatas usadas na tela. */
export function HowWeCalculate({ items, children, open }: { items: Array<[string, React.ReactNode]>; children?: React.ReactNode; open?: boolean }) {
  return (
    <details className="group mt-6 rounded-lg border border-line bg-white" open={open}>
      <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-ink">
        <Info className="size-4 text-brand-600" aria-hidden /> Como calculamos
        <span className="ml-auto text-xs font-normal text-slate-500 group-open:hidden">Mostrar definições</span>
      </summary>
      <div className="border-t border-line px-4 py-3">
        <dl className="grid gap-x-8 gap-y-3 text-sm md:grid-cols-2">
          {items.map(([t, d]) => (
            <div key={t}>
              <dt className="font-medium text-ink">{t}</dt>
              <dd className="mt-0.5 text-slate-600">{d}</dd>
            </div>
          ))}
        </dl>
        {children}
      </div>
    </details>
  );
}

/** Definições comuns (painel, gerenciais, detalhe por filial e ABC). */
export const COMMON_DEFINITIONS: Array<[string, React.ReactNode]> = [
  ["Receita líquida comercial", "Valor bruto dos itens − descontos (no item e rateio do desconto global) + acréscimos − devoluções/estornos comerciais do período. Vendas canceladas não entram. Frete e impostos não são receita de produto."],
  ["CMV", "Custo histórico registrado em cada item no momento da venda (custo médio do estoque), menos o custo revertido pelos itens devolvidos no período."],
  ["Margem bruta", "(Receita líquida − CMV) ÷ receita líquida × 100. Com receita ≤ 0 exibimos “Sem receita” (sem divisão por zero). Margens de grupos e do total são calculadas pelos totais — nunca pela média das margens."],
  ["Markup", "(Preço − custo) ÷ custo × 100. Indicador diferente da margem; exibido separadamente quando aplicável."],
  ["Ticket médio", "Receita líquida ÷ número de vendas concluídas no recorte. Vendas canceladas são excluídas; devoluções reduzem a receita, mas não o número de vendas."],
  ["Devoluções", "Entram na data do movimento da devolução (e na filial onde foram registradas), mesmo quando a venda original é anterior ao período — por isso um dia pode ter receita negativa. Contam devoluções concluídas e em processamento de estorno; canceladas não."],
  ["Período", "Datas no fuso horário da instalação (padrão America/Sao_Paulo). O intervalo técnico vai de 00:00 do primeiro dia até 00:00 do dia seguinte ao último (o último dia entra inteiro). “Mês atual” vai do dia 1º até hoje."],
  ["Comparação", "Período imediatamente anterior com a mesma quantidade de dias (ex.: 01–05/10 compara com 26–30/09; setembro inteiro compara com 02/08–31/08)."],
  ["Filial", "Contexto atual da sessão; no consolidado, todas as filiais acessíveis, com o resultado de cada unidade."],
];

/** Layout de impressão limpo para as telas de análise (sem menu, sem filtros, tabelas inteiras). */
export function PrintStyles({ landscape = true }: { landscape?: boolean }) {
  const css = `
.print-only{display:none}
@media print{
  @page{size:A4 ${landscape ? "landscape" : "portrait"};margin:10mm}
  .lg\\:pl-64{padding-left:0!important}
  main{max-width:none!important;padding:0!important}
  .overflow-x-auto{overflow:visible!important}
  .print-only{display:block!important}
  .print-break{break-before:page}
  section,figure,table{break-inside:auto}
  tr,figure{break-inside:avoid}
  table{font-size:10px}
  tfoot{display:table-row-group}
  .table-base td,.table-base th{padding:3px 6px}
  a{color:inherit!important;text-decoration:none!important}
  [data-print-hide]{display:none!important}
}`;
  return <style>{css}</style>;
}

/** Cabeçalho que aparece somente na impressão (empresa, emissão e usuário). */
export function PrintHeader({ title, company, user, rp }: { title: string; company: string; user: string; rp: ReportParams }) {
  return (
    <div className="print-only mb-3 border-b border-slate-300 pb-2 text-xs text-slate-600">
      <p className="text-base font-semibold text-ink">{title}</p>
      <p>
        {company} · {rp.branchName} · Período {rp.period.label} · Emitido em {formatDateTimeSeconds(new Date())} por {user}
      </p>
    </div>
  );
}
