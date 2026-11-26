import { serviceRoute } from "@/lib/service/http";
import { towerFiscal } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Fiscal: documentos por modelo e situação, faturamento fiscal, rejeições, cancelamentos e pendências. Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:resumo", operation: "torre.fiscal" }, towerFiscal);
