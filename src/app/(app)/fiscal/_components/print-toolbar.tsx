"use client";

import Link from "next/link";
import { Printer, ArrowLeft, FileText } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";

export function PrintToolbar({ back, providerPdf, note }: { back: string; providerPdf?: string | null; note?: string }) {
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      <Link href={back} className={buttonClass("ghost")}>
        <ArrowLeft className="size-4" /> Voltar ao documento
      </Link>
      <Button type="button" variant="primary" onClick={() => window.print()}>
        <Printer className="size-4" /> Imprimir
      </Button>
      {providerPdf && (
        <a href={providerPdf} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
          <FileText className="size-4" /> PDF oficial do provedor
        </a>
      )}
      {note && <span className="text-xs text-slate-500">{note}</span>}
    </div>
  );
}
