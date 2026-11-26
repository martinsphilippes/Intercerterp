import { serviceRoute } from "@/lib/service/http";
import { towerCommerce } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Comércio digital: pedidos por situação, pedidos pagos, banco da loja e monitor das integrações. Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:resumo", operation: "torre.comercio_digital" }, towerCommerce);
