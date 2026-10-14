"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/link";
import { CheckCheck, FileUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FormGrid, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { ACQUIRER_STATUS_LABEL, ACQUIRER_STATUS_TONE, type AcquirerStatus } from "@/domain/acquirer-status";
import { applyAcquirerAction, previewAcquirerAction } from "./actions";
import { brl, dmy } from "../../_components/calc";

type Opt = { value: string; label: string };
type Layout = Record<string, any>;

const FILTERS: Array<{ key: string; label: string; match: (s: AcquirerStatus) => boolean }> = [
  { key: "all", label: "Todas", match: () => true },
  { key: "matched", label: "Casadas", match: (s) => s === "matched" || s === "applied" },
  { key: "problems", label: "Divergências", match: (s) => ["divergent", "not_found", "ambiguous", "duplicate", "invalid", "error"].includes(s) },
  { key: "other", label: "Já liquidadas / futuras", match: (s) => s === "already_settled" || s === "future" },
];

/**
 * FIN-24 — Conciliação com o arquivo da adquirente: conta de crédito, arquivo CSV, colunas (sugeridas pelo cabeçalho e
 * ajustáveis), prévia do casamento linha a linha e baixa das casadas.
 */
export function AcquirerWizard({ accounts, defaultAccount, fields, canApply, block }: { accounts: Opt[]; defaultAccount: string; fields: Array<{ key: string; label: string; required: boolean }>; canApply: boolean; block: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [accountId, setAccountId] = useState(defaultAccount);
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<any>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [filter, setFilter] = useState("all");
  const input = useRef<HTMLInputElement>(null);

  const build = (l: Layout | null) => {
    const fd = new FormData();
    fd.set("accountId", accountId);
    if (file) fd.set("file", file);
    if (l) fd.set("layout", JSON.stringify(l));
    return fd;
  };
  const preview = (l: Layout | null = layout) =>
    start(async () => {
      if (!file) return toast("error", "Selecione o arquivo da adquirente.");
      const res = await previewAcquirerAction(build(l));
      if (!res.ok) {
        setPv(null);
        return toast("error", res.error);
      }
      setPv(res.data);
      setLayout((res.data as any).layout);
    });
  const apply = () =>
    start(async () => {
      const res = await applyAcquirerAction(build(layout));
      if (!res.ok) return toast("error", res.error);
      toast("success", res.message ?? "Conciliação concluída.");
      if (res.redirect) router.push(res.redirect);
    });
  const pick = (f: File | null) => {
    setFile(f);
    setPv(null);
    setLayout(null);
  };
  const sniff = pv?.sniff;
  const colOpts: Opt[] = sniff ? Array.from({ length: sniff.columns }, (_, i) => ({ value: String(i), label: `${i + 1}. ${sniff.header?.[i] ?? (sniff.rows[0]?.[i] ? `ex.: ${String(sniff.rows[0][i]).slice(0, 18)}` : "(vazia)")}` })) : [];
  const setL = (patch: Layout) => setLayout((l) => (l ? { ...l, ...patch } : l));
  const matches: any[] = pv?.matches ?? [];
  const by = pv?.summary?.byStatus ?? {};
  const toApply = by.matched ?? 0;
  const f = FILTERS.find((x) => x.key === filter)!;
  const shown = matches.filter((m) => f.match(m.status));
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-white p-5">
        <FormGrid cols={3}>
          <Field label="Conta onde a adquirente credita" required hint="O líquido entra nesta conta; a taxa vira lançamento de despesa.">
            <Select value={accountId} onChange={(e) => (setAccountId(e.target.value), setPv(null))} options={accounts} />
          </Field>
        </FormGrid>
        <div className="mt-4 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
          <FileUp className="size-8 text-slate-400" aria-hidden />
          <p className="text-sm font-medium text-ink">{file ? file.name : "Arquivo de vendas/pagamentos da adquirente (CSV)"}</p>
          <p className="text-xs text-slate-500">{file ? `${(file.size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB` : "Exportado do portal da Cielo, Rede, Stone, GetNet, PagSeguro etc. (até 10 MB)"}</p>
          <input ref={input} type="file" className="hidden" accept=".csv,.txt,text/csv" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
            Selecionar arquivo
          </Button>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="primary" disabled={!file || pending} loading={pending && !pv} onClick={() => preview(null)}>
            <RefreshCw className="size-4" aria-hidden /> Pré-visualizar
          </Button>
        </div>
      </div>

      {pv && layout && (
        <div className="rounded-lg border border-line bg-white p-5">
          <p className="mb-3 text-sm font-semibold text-ink">Colunas do arquivo</p>
          <FormGrid cols={4}>
            {fields.map((fd) => (
              <Field key={fd.key} label={fd.label} required={fd.required}>
                <Select value={layout[fd.key] == null ? "" : String(layout[fd.key])} onChange={(e) => setL({ [fd.key]: e.target.value === "" ? null : Number(e.target.value) })} options={colOpts} placeholder={fd.required ? "Selecione" : "— (não há)"} />
              </Field>
            ))}
            <Field label="Datas">
              <Select value={layout.dateOrder} onChange={(e) => setL({ dateOrder: e.target.value })} options={[{ value: "dmy", label: "dd/mm/aaaa" }, { value: "ymd", label: "aaaa-mm-dd" }, { value: "mdy", label: "mm/dd/aaaa" }]} />
            </Field>
            <Field label="Separador decimal">
              <Select value={layout.decimal} onChange={(e) => setL({ decimal: e.target.value })} options={[{ value: ",", label: "Vírgula (1.234,56)" }, { value: ".", label: "Ponto (1,234.56)" }]} />
            </Field>
          </FormGrid>
          <div className="mt-3 flex justify-end">
            <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={() => preview(layout)}>
              <RefreshCw className="size-4" aria-hidden /> Aplicar colunas e conferir de novo
            </Button>
          </div>
        </div>
      )}

      {pv && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-line bg-white p-3">
              <p className="text-xs text-slate-500">Linhas lidas</p>
              <p className="text-lg font-semibold">{pv.summary.lines}</p>
            </div>
            <div className="rounded-lg border border-line bg-white p-3">
              <p className="text-xs text-slate-500">Bruto do arquivo</p>
              <p className="text-lg font-semibold">{brl(pv.summary.gross)}</p>
              <p className="text-xs text-slate-500">taxas {brl(pv.summary.fee)} · líquido {brl(pv.summary.net)}</p>
            </div>
            <div className="rounded-lg border border-line bg-white p-3">
              <p className="text-xs text-slate-500">Casadas (a baixar)</p>
              <p className="text-lg font-semibold">{toApply}</p>
              <p className="text-xs text-slate-500">bruto {brl(pv.summary.matchedGross)}</p>
            </div>
            <div className="rounded-lg border border-line bg-white p-3">
              <p className="text-xs text-slate-500">Taxa cobrada × prevista</p>
              <p className={cn("text-lg font-semibold", pv.summary.feeDiff > 0 ? "text-red-700" : pv.summary.feeDiff < 0 ? "text-emerald-700" : undefined)}>
                {pv.summary.feeDiff > 0 ? "+ " : ""}
                {brl(pv.summary.feeDiff)}
              </p>
              <p className="text-xs text-slate-500">{pv.summary.withFlags} linha(s) com diferença</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(ACQUIRER_STATUS_LABEL) as AcquirerStatus[])
              .filter((k) => by[k])
              .map((k) => (
                <Badge key={k} tone={ACQUIRER_STATUS_TONE[k]}>
                  {by[k]} {ACQUIRER_STATUS_LABEL[k].toLowerCase()}
                </Badge>
              ))}
          </div>
          {pv.alreadyImported && (
            <Notice tone="warn" title="Arquivo já conciliado nesta conta">
              O mesmo conteúdo já foi aplicado — aplicar de novo não baixa nada em duplicidade.{" "}
              <Link className="underline" href={`/financeiro/cartoes/adquirente/${pv.alreadyImported.id}`}>
                Ver relatório
              </Link>
            </Notice>
          )}
          <div className="rounded-lg border border-line bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
              {FILTERS.map((x) => (
                <button key={x.key} type="button" onClick={() => setFilter(x.key)} className={cn("focus-ring rounded-full border px-3 py-1 text-xs font-medium", filter === x.key ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-slate-600 hover:border-brand-300")}>
                  {x.label} ({matches.filter((m) => x.match(m.status)).length})
                </button>
              ))}
            </div>
            <div className="max-h-[480px] overflow-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Linha</th>
                    <th>NSU / bandeira</th>
                    <th>Parcela</th>
                    <th>Crédito</th>
                    <th className="text-right">Bruto</th>
                    <th className="text-right">Taxa</th>
                    <th className="text-right">Prevista</th>
                    <th>Recebível</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => (
                    <tr key={m.lineNo}>
                      <td className="tabular">{m.lineNo}</td>
                      <td className="whitespace-nowrap">
                        {m.nsu ?? m.authCode ?? "—"}
                        <span className="block text-xs text-slate-500">{m.brand ?? "—"}</span>
                      </td>
                      <td>{m.installmentLabel ?? "—"}</td>
                      <td className="whitespace-nowrap">
                        {dmy(m.creditDate)}
                        {m.expectedDate && m.expectedDate !== m.creditDate && <span className="block text-xs text-slate-500">previsto {dmy(m.expectedDate)}</span>}
                      </td>
                      <td className="tabular text-right">{brl(m.gross)}</td>
                      <td className={cn("tabular text-right", m.feeDiff ? "font-medium text-amber-700" : undefined)}>{brl(m.fee)}</td>
                      <td className="tabular text-right text-slate-500">{m.expectedFee == null ? "—" : brl(m.expectedFee)}</td>
                      <td className="whitespace-nowrap text-xs">{m.titleId ? `${m.saleNumber ? `Venda nº ${m.saleNumber}` : `Título nº ${m.titleNumber}`}` : "—"}</td>
                      <td className="min-w-[220px]">
                        <Badge tone={ACQUIRER_STATUS_TONE[m.status as AcquirerStatus]}>{ACQUIRER_STATUS_LABEL[m.status as AcquirerStatus]}</Badge>
                        <span className="mt-0.5 block text-xs text-slate-600">{m.message}</span>
                      </td>
                    </tr>
                  ))}
                  {(pv.issues ?? [])
                    .filter((i: any) => i.status === "invalid" && (filter === "all" || filter === "problems"))
                    .map((i: any) => (
                      <tr key={`i${i.lineNo}`}>
                        <td className="tabular">{i.lineNo}</td>
                        <td colSpan={7} className="text-xs text-slate-600">
                          {i.raw}
                        </td>
                        <td>
                          <Badge tone="bad">Inválida</Badge>
                          <span className="mt-0.5 block text-xs text-slate-600">{i.message}</span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {block && <span className="text-xs text-slate-500">{block}</span>}
            <Button type="button" variant="accent" disabled={!canApply || pending} loading={pending} onClick={apply} title={!toApply ? "Nenhuma linha casada: só o relatório de divergências será gravado" : undefined}>
              <CheckCheck className="size-4" aria-hidden /> Baixar {toApply} casada(s) e gravar relatório
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
