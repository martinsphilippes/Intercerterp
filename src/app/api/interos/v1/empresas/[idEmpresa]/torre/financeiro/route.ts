import { serviceRoute } from "@/lib/service/http";
import { towerFinance } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Financeiro: recebido e pago no período, DRE gerencial, aberto, vencido, aging e saldos das contas. Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:resumo", operation: "torre.financeiro" }, towerFinance);
