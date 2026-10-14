"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { generateScaleLoadAction } from "./actions";

type Opt = { value: string; label: string };

/** Escolha do modelo de balança e da tabela de preço + "Gerar arquivo de carga" (baixa o arquivo gerado). */
export function LoadGenerator({ formats, tables, tableId, canGenerate, ready }: { formats: Opt[]; tables: Opt[]; tableId: string; canGenerate: boolean; ready: number }) {
  const router = useRouter();
  const [skipped, setSkipped] = useState<Array<{ name: string; reason: string }> | null>(null);
  return (
    <ActionForm
      action={generateScaleLoadAction}
      onSuccess={(data: { fileId: string; skipped: Array<{ name: string; reason: string }> }) => {
        setSkipped(data.skipped);
        // download pelo padrão de arquivos (/api/files/<id>, anexo)
        window.location.href = `/api/files/${data.fileId}`;
      }}
      className="space-y-3"
    >
      {({ pending }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Modelo da balança">
              <Select name="format" defaultValue={formats[0]?.value} options={formats} />
            </Field>
            <Field label="Tabela de preço" hint="Preço por kg (ou unidade) enviado à balança">
              <Select name="priceTableId" defaultValue={tableId} options={tables} onChange={(e) => router.replace(`/produtos/balanca?tabela=${e.target.value}`)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">{ready} produto(s) prontos para a carga. Os que têm pendência ficam fora do arquivo.</p>
            {canGenerate ? (
              <SubmitButton pending={pending} variant="primary">
                <Download className="size-4" /> Gerar arquivo de carga
              </SubmitButton>
            ) : (
              <p className="text-xs text-slate-500">Gerar a carga exige permissão para alterar produtos.</p>
            )}
          </div>
          {skipped && skipped.length > 0 && (
            <Notice tone="warn" title="Ficaram fora do arquivo">
              <ul className="list-disc pl-5">{skipped.map((x) => <li key={x.name}>{x.name}: {x.reason}</li>)}</ul>
            </Notice>
          )}
        </>
      )}
    </ActionForm>
  );
}
