import { serviceRoute } from "@/lib/service/http";
import { towerSalesByUnit } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Resultado comercial por unidade (filial), com o período anterior equivalente. Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:resumo", operation: "torre.vendas.por_unidade" }, towerSalesByUnit);
