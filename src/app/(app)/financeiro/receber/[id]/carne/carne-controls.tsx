"use client";

import { useEffect } from "react";
import Link from "@/components/ui/link";
import { ArrowLeft, Printer } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";

/** Barra da impressão do carnê: voltar ao título, alternar parcelas e imprimir (com ?print=1 abre o diálogo uma vez). */
export function CarneControls({ back, toggle, note, auto }: { back: string; toggle: { href: string; label: string } | null; note: string; auto: boolean }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 500);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      <Link href={back} className={buttonClass("ghost")}>
        <ArrowLeft className="size-4" /> Voltar ao título
      </Link>
      <Button type="button" variant="primary" onClick={() => window.print()}>
        <Printer className="size-4" /> Imprimir carnê
      </Button>
      {toggle && (
        <Link href={toggle.href} className={buttonClass("secondary")}>
          {toggle.label}
        </Link>
      )}
      <span className="text-xs text-slate-500">{note}</span>
    </div>
  );
}
