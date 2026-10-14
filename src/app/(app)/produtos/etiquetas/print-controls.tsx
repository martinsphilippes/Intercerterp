"use client";

import { useEffect } from "react";
import Link from "@/components/ui/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";

/** Barra da página de impressão das etiquetas: voltar à lista, imprimir (abre o diálogo automaticamente uma vez). */
export function LabelPrintControls({ back, note, auto }: { back: string; note: string; auto: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      <Link href={back} className={buttonClass("ghost")}>
        <ArrowLeft className="size-4" /> Voltar à lista
      </Link>
      <Button type="button" variant="primary" onClick={() => window.print()}>
        <Printer className="size-4" /> Imprimir
      </Button>
      <span className="text-xs text-slate-500">{note}</span>
    </div>
  );
}
