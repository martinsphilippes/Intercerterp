"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Impressão do relatório/recibo na tela atual (layout de impressão oculta menus e ações). */
export function PrintButton({ label = "Imprimir", variant = "secondary", size = "md" }: { label?: string; variant?: "secondary" | "ghost" | "primary" | "outline"; size?: "sm" | "md" }) {
  return (
    <Button type="button" variant={variant} size={size} onClick={() => window.print()}>
      <Printer className="size-4" /> {label}
    </Button>
  );
}
