"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/ui/empty";
import { generateSintegraAction } from "./actions";

type Result = { fileId: string; fileName: string; lines: number; errors: number; warnings: number; reused: boolean };

/** Gera o arquivo com os parâmetros da prévia e oferece o download do arquivo guardado em Arquivos. */
export function GenerateSintegraForm({ params, errors }: { params: Record<string, string>; errors: number }) {
  const [file, setFile] = useState<Result | null>(null);
  const [force, setForce] = useState(false);
  return (
    <ActionForm action={generateSintegraAction} onSuccess={(d: Result) => {
        setFile(d);
        // download imediato do arquivo guardado (anexo: a página continua aberta)
        window.location.assign(`/api/files/${d.fileId}`);
      }} className="space-y-3">
      {({ pending, error }) => (
        <>
          {Object.entries(params).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {errors > 0 && (
            <label className="flex items-start gap-2 text-sm text-red-800">
              <input type="checkbox" name="allowPendencies" checked={force} onChange={(e) => setForce(e.target.checked)} className="mt-0.5" />
              <span>
                Gerar mesmo com {errors} pendência(s) bloqueante(s) — o arquivo provavelmente será recusado pelo validador da UF; a geração fica registrada na auditoria.
              </span>
            </label>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pending={pending} variant="accent" disabled={errors > 0 && !force}>
              <Download className="size-4" aria-hidden /> Gerar e baixar arquivo .txt
            </SubmitButton>
            {file && (
              <a className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline" href={`/api/files/${file.fileId}`}>
                <Download className="size-4" aria-hidden /> {file.fileName} ({file.lines} registros{file.reused ? ", idêntico ao último gerado" : ""})
              </a>
            )}
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
        </>
      )}
    </ActionForm>
  );
}
