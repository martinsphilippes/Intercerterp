import { serviceRoute } from "@/lib/service/http";
import { towerSalesSeries } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Série da receita comercial por dia ou por mês (granularidade=dia|mes). Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:resumo", operation: "torre.vendas.serie" }, towerSalesSeries);
