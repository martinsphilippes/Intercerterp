"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/ui/empty";
import { generateDominioAction, saveAccountingCodesAction } from "./actions";

/** Gera o arquivo do período e oferece o download do arquivo guardado. */
export function GenerateDominioForm({ from, to, branchId, disabled }: { from: string; to: string; branchId: string | null; disabled?: boolean }) {
  const [file, setFile] = useState<{ fileId: string; fileName: string; lines: number; pending: number } | null>(null);
  return (
    <ActionForm action={generateDominioAction} onSuccess={(d) => setFile(d)} className="flex flex-wrap items-center gap-3">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="from" value={from} />
          <input type="hidden" name="to" value={to} />
          <input type="hidden" name="branchId" value={branchId ?? ""} />
          <SubmitButton pending={pending} variant="accent">
            Gerar arquivo para a Domínio
          </SubmitButton>
          {disabled && <span className="text-xs text-amber-700">Configure o layout na Central de integrações antes de gerar.</span>}
          {file && (
            <a className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline" href={`/api/files/${file.fileId}`}>
              <Download className="size-4" aria-hidden /> {file.fileName} ({file.lines} lançamento(s){file.pending ? `, ${file.pending} sem conta` : ""})
            </a>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
        </>
      )}
    </ActionForm>
  );
}

type Row = { id: string; name: string; code: string; hint?: string };

/** Códigos contábeis (código reduzido da Domínio) das categorias financeiras e contas financeiras. */
export function AccountingCodesForm({ categories, accounts, canEdit }: { categories: Row[]; accounts: Row[]; canEdit: boolean }) {
  const table = (rows: Row[], prefix: string, title: string) => (
    <div>
      <p className="mb-1 text-sm font-semibold">{title}</p>
      <table className="table-base w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.name}
                {r.hint && <span className="block text-xs text-slate-500">{r.hint}</span>}
              </td>
              <td className="w-36">
                <input name={`${prefix}${r.id}`} defaultValue={r.code} disabled={!canEdit} maxLength={40} placeholder="código" aria-label={`Código contábil de ${r.name}`} className="focus-ring h-8 w-full rounded-md border border-line px-2 text-sm tabular" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <ActionForm action={saveAccountingCodesAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {table(categories, "cat_", "Categorias financeiras (plano de contas)")}
            {table(accounts, "acc_", "Contas financeiras (caixa e bancos)")}
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          {canEdit && (
            <div className="flex justify-end">
              <SubmitButton pending={pending}>Salvar códigos</SubmitButton>
            </div>
          )}
        </>
      )}
    </ActionForm>
  );
}
