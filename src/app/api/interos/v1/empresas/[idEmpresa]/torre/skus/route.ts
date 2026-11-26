import { serviceRoute } from "@/lib/service/http";
import { towerSkus } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — SKUs por receita: quantidade, custo, margem e classe ABC da curva ABC (paginado). Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:detalhe", operation: "torre.skus" }, towerSkus);
