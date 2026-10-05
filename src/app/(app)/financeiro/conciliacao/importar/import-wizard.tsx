"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileUp, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FormGrid, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { useIdemKey } from "@/components/ui/action-form";
import { cn } from "@/components/ui/cn";
import { importAction, previewImportAction } from "../../actions";
import { brl, dmy } from "../../_components/calc";

type Opt = { value: string; label: string };

interface Mapping {
  delimiter: string;
  hasHeader: boolean;
  skipRows: number;
  date: number;
  description: number;
  document: number | null;
  signMode: "signed" | "dc_column" | "split";
  amount: number | null;
  dcColumn: number | null;
  debit: number | null;
  credit: number | null;
  dateOrder: "dmy" | "ymd" | "mdy";
  decimal: "," | ".";
}

const FORMATS = [
  { value: "auto", label: "Detectar automaticamente" },
  { value: "ofx", label: "OFX (extrato)" },
  { value: "csv", label: "CSV (extrato, com mapeamento)" },
  { value: "cnab240", label: "CNAB 240 — retorno de cobrança" },
  { value: "cnab400", label: "CNAB 400 — retorno de cobrança (Itaú/Bradesco)" },
];

const ST: Record<string, [string, "good" | "warn" | "bad" | "neutral" | "info"]> = {
  invalid: ["Inválida", "bad"],
  unsupported: ["Não suportada", "warn"],
  info: ["Informativa", "neutral"],
};

/** Visão 5 — importação do extrato: conta de destino, arquivo (arrastar/selecionar), pré-visualização, mapeamento CSV e duplicidades. */
export function ImportWizard({ accounts, defaultAccount, canImport, block }: { accounts: Opt[]; defaultAccount: string; canImport: boolean; block: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const idem = useIdemKey();
  const [pending, start] = useTransition();
  const [accountId, setAccountId] = useState(defaultAccount);
  const [format, setFormat] = useState("auto");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [pv, setPv] = useState<any>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const build = (m: Mapping | null = mapping) => {
    const fd = new FormData();
    fd.set("accountId", accountId);
    fd.set("format", format);
    if (file) fd.set("file", file);
    if (m && (format === "csv" || pv?.result?.format === "csv")) fd.set("csvMapping", JSON.stringify(m));
    fd.set("_idem", idem);
    return fd;
  };
  const preview = (m: Mapping | null = mapping) =>
    start(async () => {
      if (!file) return toast("error", "Selecione o arquivo.");
      const res = await previewImportAction(build(m));
      if (!res.ok) {
        setPv(null);
        return toast("error", res.error);
      }
      setPv(res.data);
      if (res.data && (res.data as any).csv && !m) setMapping((res.data as any).csv.guess);
    });
  const doImport = () =>
    start(async () => {
      const res = await importAction(build());
      if (!res.ok) return toast("error", res.error);
      toast("success", res.message ?? "Importado.");
      if (res.redirect) router.push(res.redirect);
    });
  const pick = (f: File | null) => {
    setFile(f);
    setPv(null);
    setMapping(null);
  };
  const r = pv?.result;
  const csv = pv?.csv;
  const colOpts: Opt[] = csv ? Array.from({ length: csv.columns }, (_, i) => ({ value: String(i), label: `${i + 1}. ${csv.header?.[i] ?? (csv.rows[0]?.[i] ? `ex.: ${String(csv.rows[0][i]).slice(0, 18)}` : "(vazia)")}` })) : [];
  const setM = (patch: Partial<Mapping>) => setMapping((m) => (m ? { ...m, ...patch } : m));
  const issues: any[] = pv?.issues ?? [];
  const valid = (pv?.rows ?? []).length;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-white p-5">
        <FormGrid cols={3}>
          <Field label="Conta de destino" required hint="As linhas importadas pertencem a esta conta.">
            <Select value={accountId} onChange={(e) => (setAccountId(e.target.value), setPv(null))} options={accounts} />
          </Field>
          <Field label="Formato">
            <Select value={format} onChange={(e) => (setFormat(e.target.value), setPv(null), setMapping(null))} options={FORMATS} />
          </Field>
        </FormGrid>
        <div
          className={cn("mt-4 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center", drag ? "border-brand-400 bg-brand-50" : "border-slate-300 bg-slate-50")}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <FileUp className="size-8 text-slate-400" aria-hidden />
          <p className="text-sm font-medium text-ink">{file ? file.name : "Arraste o extrato ou o retorno para esta área"}</p>
          <p className="text-xs text-slate-500">{file ? `${(file.size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB · ${file.type || "tipo não informado"}` : "ou escolha um arquivo no seu computador (até 10 MB)"}</p>
          <input ref={input} type="file" className="hidden" accept=".ofx,.csv,.txt,.ret,.rem,.cnab,text/csv,application/x-ofx" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
          <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
            Selecionar arquivo
          </Button>
          <p className="text-xs text-slate-500">
            Aceitos: <Badge>OFX</Badge> <Badge>CSV</Badge> <Badge>CNAB 240</Badge> <Badge>CNAB 400</Badge> — CSV em UTF-8 ou Latin-1; separador detectado.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Link href={`/financeiro/conciliacao?account=${accountId}`} className="inline-flex h-9 items-center rounded-md px-4 text-sm text-slate-700 hover:bg-slate-100">
            Cancelar
          </Link>
          <Button type="button" variant="primary" disabled={!file || pending} loading={pending && !pv} onClick={() => preview(null)}>
            <RefreshCw className="size-4" /> Pré-visualizar
          </Button>
        </div>
      </div>

      {pv && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-white p-5">
            <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-slate-500">Formato</p>
                <p className="font-medium">{pv.formatLabel}</p>
                <p className="text-xs text-slate-500">{r.layoutVersion ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Banco (arquivo)</p>
                <p className="font-medium">{r.bankCode ? `${r.bankCode}${r.bankName ? ` — ${r.bankName}` : ""}` : "Não informado"}</p>
                <p className="text-xs text-slate-500">{r.kind === "collection_return" ? "Retorno de cobrança (liquidações)" : "Extrato bancário"}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Período</p>
                <p className="font-medium">{r.period?.from ? `${dmy(r.period.from)} a ${dmy(r.period.to)}` : "—"}</p>
                {r.balance && <p className="text-xs text-slate-500">Saldo informado: {brl(r.balance.amount)}</p>}
              </div>
              <div>
                <p className="text-xs text-slate-500">Linhas do arquivo</p>
                <p className="font-medium">{r.totalLines}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <Badge tone="good">{pv.newCount} nova(s)</Badge>
              <Badge tone="neutral">{pv.duplicateCount} já importada(s)</Badge>
              <Badge tone="bad">{issues.filter((i) => i.status === "invalid").length} inválida(s)</Badge>
              <Badge tone="warn">{issues.filter((i) => i.status === "unsupported").length} não suportada(s)</Badge>
              <Badge>{issues.filter((i) => i.status === "info").length} informativa(s)</Badge>
            </div>
            {r.fatal && (
              <div className="mt-3">
                <Notice tone="bad" title="Arquivo não pode ser importado">{r.fatal}</Notice>
              </div>
            )}
            {pv.alreadyImported && (
              <div className="mt-3">
                <Notice tone="warn" title="Arquivo já importado nesta conta">
                  Mesmo conteúdo (hash) importado em {new Date(pv.alreadyImported.createdAt).toLocaleString("pt-BR")} como “{pv.alreadyImported.fileName}”. Importar de novo não duplica nada.{" "}
                  <Link className="underline" href={`/financeiro/conciliacao/importacoes/${pv.alreadyImported.id}`}>
                    Ver importação
                  </Link>
                </Notice>
              </div>
            )}
            {pv.warnings?.map((w: string) => (
              <div key={w} className="mt-3">
                <Notice tone="warn">{w}</Notice>
              </div>
            ))}
          </div>

          {csv && mapping && (
            <div className="rounded-lg border border-line bg-white p-5">
              <h2 className="mb-1 text-sm font-semibold">Mapeamento das colunas (CSV)</h2>
              <p className="mb-3 text-xs text-slate-500">Separador “{csv.delimiter === "\t" ? "tab" : csv.delimiter}”. Ajuste e clique em “Atualizar pré-visualização”.</p>
              <FormGrid cols={4}>
                <Field label="Data">
                  <Select value={String(mapping.date)} onChange={(e) => setM({ date: Number(e.target.value) })} options={colOpts} />
                </Field>
                <Field label="Descrição">
                  <Select value={String(mapping.description)} onChange={(e) => setM({ description: Number(e.target.value) })} options={colOpts} />
                </Field>
                <Field label="Documento">
                  <Select value={mapping.document == null ? "" : String(mapping.document)} onChange={(e) => setM({ document: e.target.value === "" ? null : Number(e.target.value) })} options={colOpts} placeholder="(nenhuma)" />
                </Field>
                <Field label="Sinal do valor">
                  <Select
                    value={mapping.signMode}
                    onChange={(e) => setM({ signMode: e.target.value as Mapping["signMode"] })}
                    options={[
                      { value: "signed", label: "Coluna de valor com sinal (−/+)" },
                      { value: "dc_column", label: "Valor + coluna D/C" },
                      { value: "split", label: "Colunas separadas débito/crédito" },
                    ]}
                  />
                </Field>
                {mapping.signMode !== "split" ? (
                  <Field label="Valor">
                    <Select value={mapping.amount == null ? "" : String(mapping.amount)} onChange={(e) => setM({ amount: e.target.value === "" ? null : Number(e.target.value) })} options={colOpts} placeholder="—" />
                  </Field>
                ) : (
                  <>
                    <Field label="Débito">
                      <Select value={mapping.debit == null ? "" : String(mapping.debit)} onChange={(e) => setM({ debit: e.target.value === "" ? null : Number(e.target.value) })} options={colOpts} placeholder="—" />
                    </Field>
                    <Field label="Crédito">
                      <Select value={mapping.credit == null ? "" : String(mapping.credit)} onChange={(e) => setM({ credit: e.target.value === "" ? null : Number(e.target.value) })} options={colOpts} placeholder="—" />
                    </Field>
                  </>
                )}
                {mapping.signMode === "dc_column" && (
                  <Field label="Coluna D/C">
                    <Select value={mapping.dcColumn == null ? "" : String(mapping.dcColumn)} onChange={(e) => setM({ dcColumn: e.target.value === "" ? null : Number(e.target.value) })} options={colOpts} placeholder="—" />
                  </Field>
                )}
                <Field label="Formato da data">
                  <Select value={mapping.dateOrder} onChange={(e) => setM({ dateOrder: e.target.value as Mapping["dateOrder"] })} options={[{ value: "dmy", label: "dd/mm/aaaa" }, { value: "ymd", label: "aaaa-mm-dd" }, { value: "mdy", label: "mm/dd/aaaa" }]} />
                </Field>
                <Field label="Separador decimal">
                  <Select value={mapping.decimal} onChange={(e) => setM({ decimal: e.target.value as "," | "." })} options={[{ value: ",", label: "Vírgula (1.234,56)" }, { value: ".", label: "Ponto (1,234.56)" }]} />
                </Field>
                <Field label="Linhas antes do cabeçalho">
                  <input type="number" min={0} max={50} value={mapping.skipRows} onChange={(e) => setM({ skipRows: Number(e.target.value) || 0 })} className="focus-ring h-9 rounded-md border border-line px-3 text-sm" />
                </Field>
                <Field label="Cabeçalho">
                  <Select value={mapping.hasHeader ? "1" : "0"} onChange={(e) => setM({ hasHeader: e.target.value === "1" })} options={[{ value: "1", label: "Primeira linha útil é cabeçalho" }, { value: "0", label: "Sem cabeçalho" }]} />
                </Field>
              </FormGrid>
              <div className="mt-3">
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => preview(mapping)}>
                  <RefreshCw className="size-4" /> Atualizar pré-visualização
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-line bg-white">
            <div className="flex items-center justify-between border-b border-line px-4 py-2 text-xs text-slate-500">
              <span>
                {valid} transação(ões) válidas{pv.totalRows > valid ? ` (exibindo ${valid} de ${pv.totalRows})` : ""}
              </span>
            </div>
            {valid === 0 ? (
              <p className="p-6 text-center text-sm text-slate-500">Nenhuma transação válida lida com este formato/mapeamento.</p>
            ) : (
              <div className="max-h-96 overflow-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Data</th>
                      <th>Descrição</th>
                      <th>Documento</th>
                      <th className="text-right">Valor</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pv.rows.map((t: any, i: number) => (
                      <tr key={i} className={t.duplicate ? "text-slate-400" : undefined}>
                        <td className="tabular">{t.lineNo}</td>
                        <td>{dmy(t.date)}</td>
                        <td>
                          {t.description}
                          {t.kind !== "statement" && <span className="ml-1 text-xs text-slate-500">({t.occurrence} {t.occurrenceText})</span>}
                        </td>
                        <td className="text-xs">{[t.docNumber, t.externalId && `FITID ${t.externalId}`, t.ourNumber && `nosso nº ${t.ourNumber}`].filter(Boolean).join(" · ") || "—"}</td>
                        <td className={cn("tabular text-right", t.amount > 0 ? "text-emerald-700" : "text-red-700")}>{brl(t.amount)}</td>
                        <td>{t.duplicate ? <Badge>Já importada</Badge> : <Badge tone="good">Nova</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {issues.length > 0 && (
            <div className="rounded-lg border border-line bg-white">
              <p className="border-b border-line px-4 py-2 text-xs font-semibold text-slate-600">Linhas não importadas (por linha do arquivo)</p>
              <div className="max-h-72 overflow-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Situação</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((i, k) => (
                      <tr key={k}>
                        <td className="tabular">{i.lineNo}</td>
                        <td>
                          <Badge tone={ST[i.status]?.[1] ?? "neutral"}>{ST[i.status]?.[0] ?? i.status}</Badge>
                        </td>
                        <td className="text-xs">
                          {i.message}
                          {i.raw && <code className="mt-0.5 block truncate text-[11px] text-slate-400">{i.raw}</code>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            {block && <span className="text-xs text-amber-700">{block}</span>}
            <Button type="button" variant="accent" disabled={pending || Boolean(r.fatal) || !canImport || (valid === 0 && !issues.length)} loading={pending} onClick={doImport}>
              <Upload className="size-4" /> {pv.alreadyImported ? "Abrir importação existente" : `Importar ${pv.newCount} transação(ões)`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
