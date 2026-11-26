import { serviceRoute } from "@/lib/service/http";
import { towerPurchases } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Compras: pedidos e recebimentos no período e a posição atual (aprovação, a receber, aguardando nota). Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:resumo", operation: "torre.compras" }, towerPurchases);
