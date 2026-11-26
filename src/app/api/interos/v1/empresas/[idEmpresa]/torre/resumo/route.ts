import { serviceRoute } from "@/lib/service/http";
import { towerSummary } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Resumo dos indicadores oficiais: vendas, devoluções, PDV, comércio digital, estoque, compras, financeiro e fiscal. Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:resumo", operation: "torre.resumo" }, towerSummary);
