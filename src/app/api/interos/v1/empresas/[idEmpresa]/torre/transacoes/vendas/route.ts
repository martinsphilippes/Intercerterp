import { serviceRoute } from "@/lib/service/http";
import { towerSaleTransactions } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Vendas que compõem os totais do período, uma por linha (paginado). Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:transacoes", operation: "torre.transacoes.vendas" }, towerSaleTransactions);
