import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { dbOutageOf } from "@/lib/db/outage";
import { unscoped } from "@/lib/db/scoped-store";
import { getSetting, setSetting } from "@/lib/core/settings";

/**
 * Sinal diário do banco (Vercel Cron, vercel.json): uma leitura e uma gravação mínimas, com o horário do último sinal em
 * parâmetros da plataforma ("keepalive"). Protegida por CRON_SECRET como o executor de tarefas.
 *
 * NÃO evita a pausa do Appwrite Cloud gratuito: o Appwrite só conta a atividade de desenvolvimento no console dele
 * (7 dias sem ela → projeto pausado; 90 dias pausado → projeto apagado) e as chamadas da aplicação não entram na conta —
 * em novembro/2026 o projeto foi pausado com este sinal diário agendado. O que esta rota entrega é o
 * monitoramento: banco pausado ou fora do ar responde 503 e fica registrado nos logs da Vercel no mesmo dia.
 * Decisão sobre o plano: docs/pendencias-externas.md (item 1).
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") return new NextResponse("Defina CRON_SECRET no servidor.", { status: 503 });
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Não autorizado", { status: 401 });
  const store = unscoped(getStore());
  const at = new Date().toISOString();
  try {
    const before = await getSetting<{ at?: string; count?: number } | null>(store, "platform", null, "keepalive", null);
    await setSetting(store, "platform", null, "keepalive", { at, count: (before?.count ?? 0) + 1 });
    return NextResponse.json({ ok: true, at, previous: before?.at ?? null });
  } catch (e) {
    // o banco pausado responde 403 "project_paused": registra para aparecer nos logs da Vercel
    const outage = dbOutageOf(e);
    console.error(outage?.kind === "paused" ? "[keepalive] banco PAUSADO por inatividade — ninguém consegue entrar; reative o projeto no console do Appwrite" : "[keepalive] banco indisponível", e);
    return NextResponse.json({ ok: false, at, outage: outage?.kind ?? null, error: String((e as Error)?.message ?? e) }, { status: 503 });
  }
}
