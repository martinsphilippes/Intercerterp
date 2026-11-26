import { serviceRoute } from "@/lib/service/http";
import { towerAdoption } from "@/domain/tower/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Torre de Controle (Interos) — Adoção e operação: última atividade, usuários ativos, última venda e pendências de integração. Definições: docs/interos/torre-indicadores.md. */
export const GET = serviceRoute({ scope: "torre:resumo", operation: "torre.adocao" }, towerAdoption);
