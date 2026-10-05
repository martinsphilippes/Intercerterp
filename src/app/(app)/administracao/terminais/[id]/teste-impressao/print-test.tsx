"use client";

import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { recordPrintPageAction } from "../../actions";

/** Abre o diálogo de impressão do navegador e registra apenas que a página de teste foi aberta. */
export function PrintTest({ id, width, cols, children }: { id: string; width: number; cols: number; children: React.ReactNode }) {
  const done = useRef(false);
  const [recorded, setRecorded] = useState<string | null>(null);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    recordPrintPageAction(id, navigator.userAgent).then((r) => {
      if (r.ok) setRecorded((r.data as any)?.message ?? "Registrado.");
      setTimeout(() => window.print(), 400);
    });
  }, [id]);
  return (
    <div className="space-y-4">
      <style>{`@page { size: ${width}mm auto; margin: 0; } @media print { body * { visibility: hidden !important; } .receipt, .receipt * { visibility: visible !important; } .receipt { position: absolute; left: 0; top: 0; margin: 0 !important; border: 0 !important; box-shadow: none !important; } }`}</style>
      <div className="no-print flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir novamente
        </Button>
        {recorded && <span className="text-xs text-slate-500">Abertura registrada no histórico do terminal.</span>}
      </div>
      <div className="no-print">
        <Notice tone="info" title="O navegador não informa se o papel saiu">
          Confira o cupom na impressora: largura correta ({width} mm), acentuação, alinhamento à direita dos valores, código de barras e corte. Se sair em branco ou cortado, ajuste o papel no diálogo de impressão (margens “Nenhuma”, sem cabeçalho/rodapé, escala 100%).
        </Notice>
      </div>
      <div className="receipt mx-auto overflow-hidden bg-white p-2 font-mono leading-snug text-black shadow-sm ring-1 ring-line" style={{ width: `${width}mm`, fontSize: `calc((${width}mm - 16px) / ${cols} / 0.61)` }}>
        {children}
      </div>
    </div>
  );
}
