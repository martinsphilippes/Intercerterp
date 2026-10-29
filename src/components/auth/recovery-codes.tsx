"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Códigos de recuperação exibidos uma única vez (copiar/baixar); o sistema guarda só o hash de cada um. */
export function RecoveryCodesList({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  const copy = () => navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => undefined);
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Intercert ERP — códigos de recuperação (autenticação em duas etapas)\nCada código vale uma única vez.\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "intercert-codigos-de-recuperacao.txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-900">Códigos de recuperação</p>
      <p className="text-xs text-amber-900">Guarde em lugar seguro. Cada código entra uma única vez se você perder o acesso ao aplicativo. Eles não serão exibidos de novo.</p>
      <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm" aria-label="Códigos de recuperação">
        {codes.map((c) => <li key={c} className="rounded bg-white px-2 py-1 text-center ring-1 ring-amber-200">{c}</li>)}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" onClick={copy}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copiados" : "Copiar"}</Button>
        <Button type="button" size="sm" onClick={download}><Download className="size-4" /> Baixar .txt</Button>
      </div>
    </div>
  );
}
