"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Notice } from "@/components/ui/empty";
import { generateFiscalFileAction } from "./actions";

/** Gera o arquivo do recorte da prévia e oferece o download do arquivo guardado. */
export function GenerateFileForm({ values, errors, label }: { values: Record<string, string>; errors: number; label: string }) {
  const [file, setFile] = useState<{ fileId: string; fileName: string; lines: number; reused: boolean } | null>(null);
  return (
    <ActionForm action={generateFiscalFileAction} onSuccess={(d) => setFile(d)} className="flex flex-wrap items-center gap-3">
      {({ pending, error }) => (
        <>
          {Object.entries(values).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {errors > 0 && (
            <label className="inline-flex items-center gap-2 text-sm text-amber-800">
              <input type="checkbox" name="accept" value="1" className="size-4 accent-brand-700" /> Gerar mesmo assim ({errors} pendência(s) que o PVA deve recusar)
            </label>
          )}
          <SubmitButton pending={pending} variant="accent">
            Gerar {label}
          </SubmitButton>
          {file && (
            <a className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline" href={`/api/files/${file.fileId}`}>
              <Download className="size-4" aria-hidden /> {file.fileName} ({file.lines} linhas{file.reused ? ", mesmo conteúdo do último" : ""})
            </a>
          )}
          {error && <Notice tone="bad">{error}</Notice>}
        </>
      )}
    </ActionForm>
  );
}
