import { serviceRoute } from "@/lib/service/http";
import { towerStock } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Posições de estoque atuais por SKU e depósito da unidade (paginado). Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:detalhe", operation: "torre.estoque" }, towerStock);
