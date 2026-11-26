import { serviceRoute } from "@/lib/service/http";
import { towerProducts } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Produtos por receita: quantidade, custo, margem e classe ABC (paginado). Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:detalhe", operation: "torre.produtos" }, towerProducts);
