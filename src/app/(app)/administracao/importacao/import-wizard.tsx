"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Eye, Upload, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useIdemKey } from "@/components/ui/action-form";
import { analyzeDataCsvAction, previewDataImportAction, runDataImportAction } from "./actions";
import type { DataImportKind } from "@/domain/data-import";

type Analysis = { headers: string[]; sample: string[][]; rowCount: number; delimiter: string; mapping: Record<string, string>; fields: Array<{ key: string; label: string }>; maxRows: number };
type RowResult = { line: number; key: string; name?: string; action: "create" | "skip" | "error"; messages: string[] };

const ACTION: Record<RowResult["action"], [string, "good" | "neutral" | "bad"]> = { create: ["Criar", "good"], skip: ["Ignorar", "neutral"], error: ["Erro", "bad"] };

async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  // planilhas exportadas pelo Excel em pt-BR costumam vir em Windows-1252
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

/** Assistente de importação (PLA-19): arquivo → mapeamento → prévia linha a linha → importação em lotes. */
export function DataImportWizard({ kind, label, template, requiredHint }: { kind: DataImportKind; label: string; template: string; requiredHint: string }) {
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ results: RowResult[]; totals: Record<string, number> } | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const idem = useIdemKey();
  const fieldOpts = useMemo(() => [{ value: "", label: "— ignorar coluna —" }, ...(analysis?.fields ?? []).map((f) => ({ value: f.key, label: f.label }))], [analysis]);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setPreview(null);
    start(async () => {
      const t = await readText(f);
      const r = await analyzeDataCsvAction(kind, t);
      if (!r.ok) return toast("error", r.error);
      setFileName(f.name);
      setText(t);
      setAnalysis(r.data as Analysis);
      setMapping((r.data as Analysis).mapping);
    });
  };
  const runPreview = () =>
    start(async () => {
      const r = await previewDataImportAction({ kind, text, mapping });
      if (!r.ok) return toast("error", r.error);
      setPreview(r.data as any);
      setFilter("");
    });
  const runImport = () =>
    start(async () => {
      const r = await runDataImportAction({ kind, fileName, text, mapping, idemKey: idem });
      if (!r.ok) return toast("error", r.error);
      toast("success", r.message ?? "Importação concluída.");
      if (r.redirect) router.push(r.redirect);
    });
  const effective = preview?.totals.create ?? 0;
  const shown = preview?.results.filter((r) => !filter || r.action === filter) ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">1. Arquivo CSV — {label}</h2>
            <p className="mt-0.5 text-xs text-slate-500">Separador ; , ou tabulação; primeira linha com os nomes das colunas; valores em formato brasileiro (1.234,56 e dd/mm/aaaa). Até {analysis?.maxRows ?? 1000} linhas. {requiredHint}</p>
          </div>
          <a className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download={`modelo-${kind}.csv`}>
            <Download className="size-4" /> Baixar modelo
          </a>
        </div>
        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-line p-6 text-sm text-slate-600 hover:border-brand-300">
          <FileUp className="size-6 text-slate-400" aria-hidden />
          {fileName ? <span><strong>{fileName}</strong> — {analysis?.rowCount ?? 0} linha(s) de dados, separador “{analysis?.delimiter === "\t" ? "tab" : analysis?.delimiter}”</span> : <span>Escolher arquivo .csv</span>}
          <input type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </section>

      {analysis && (
        <section className="rounded-lg border border-line bg-white p-5">
          <h2 className="text-sm font-semibold">2. Mapeamento de colunas</h2>
          <p className="mt-0.5 text-xs text-slate-500">Sugestão automática pelo nome da coluna; ajuste o que for preciso. Colunas ignoradas não são lidas.</p>
          <div className="mt-4 overflow-x-auto rounded-md border border-line">
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Coluna do arquivo</th><th>Exemplos</th><th className="w-72">Campo do sistema</th></tr>
              </thead>
              <tbody>
                {analysis.headers.map((h, i) => (
                  <tr key={i}>
                    <td className="font-medium">{h || <span className="text-slate-400">(sem nome)</span>}</td>
                    <td className="max-w-md truncate text-xs text-slate-500">{analysis.sample.map((r) => r[i]).filter(Boolean).slice(0, 3).join(" · ") || "—"}</td>
                    <td>
                      <Select aria-label={`Campo para ${h}`} value={mapping[String(i)] ?? ""} onChange={(e) => setMapping({ ...mapping, [String(i)]: e.target.value })} options={fieldOpts} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="primary" loading={pending} onClick={runPreview}>
              <Eye className="size-4" /> Gerar prévia
            </Button>
          </div>
        </section>
      )}

      {preview && (
        <section className="rounded-lg border border-line bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">3. Prévia por linha (nada foi gravado)</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {(["", "create", "skip", "error"] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full border px-2.5 py-1 ${filter === k ? "border-brand-500 bg-brand-50 text-brand-800" : "border-line text-slate-600"}`}>
                    {k === "" ? `Todas (${preview.totals.rows})` : `${ACTION[k][0]} (${preview.totals[k] ?? 0})`}
                  </button>
                ))}
              </div>
            </div>
            <Button type="button" variant="accent" loading={pending} disabled={effective === 0} onClick={runImport}>
              <Upload className="size-4" /> Importar {effective} linha(s)
            </Button>
          </div>
          {preview.totals.error > 0 && <div className="mt-3"><Notice tone="warn">Linhas com erro não serão importadas. Corrija o arquivo e gere a prévia novamente, ou importe apenas as linhas válidas. Linhas “Ignorar” já estão cadastradas (reimportar o arquivo não duplica nada).</Notice></div>}
          <div className="mt-4 max-h-[480px] overflow-auto rounded-md border border-line">
            <table className="table-base w-full text-sm">
              <thead className="sticky top-0"><tr><th>Linha</th><th>Chave</th><th>Nome</th><th>Ação</th><th>Detalhes</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.line}>
                    <td className="tabular">{r.line}</td>
                    <td className="font-mono text-xs">{r.key}</td>
                    <td>{r.name ?? "—"}</td>
                    <td><Badge tone={ACTION[r.action][1]}>{ACTION[r.action][0]}</Badge></td>
                    <td className="text-xs text-slate-600">{r.messages.join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
