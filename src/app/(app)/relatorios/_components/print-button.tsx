"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

export function PrintButton({ label = "Imprimir" }: { label?: string }) {
  return (
    <button type="button" className={buttonClass("secondary")} onClick={() => window.print()} title="Imprimir ou salvar em PDF (layout de impressão)">
      <Printer className="size-4" aria-hidden /> {label}
    </button>
  );
}
