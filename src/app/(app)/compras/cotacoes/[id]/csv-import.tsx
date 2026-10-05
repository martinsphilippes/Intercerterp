"use client";

import { Download } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { importCsvAction } from "../actions";

export function CsvImport({ quotationId, number, template }: { quotationId: string; number: number; template: string }) {
  return (
    <ActionForm action={importCsvAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="quotationId" value={quotationId} />
          <input type="file" name="csv" accept=".csv,text/csv,text/plain" required aria-label="Arquivo CSV de propostas" className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white" />
          <SubmitButton pending={pending} variant="secondary">Importar CSV</SubmitButton>
          <a className="inline-flex items-center gap-1 text-sm text-brand-700 underline" download={`cotacao-${number}-modelo.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent("﻿" + template)}`}>
            <Download className="size-4" /> Baixar modelo preenchido com os itens
          </a>
          {error && <p className="w-full text-sm text-red-700">{error}</p>}
        </>
      )}
    </ActionForm>
  );
}
