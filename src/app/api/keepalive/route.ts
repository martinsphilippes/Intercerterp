import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { getSetting, setSetting } from "@/lib/core/settings";

/**
 * Mantém o banco (Appwrite Cloud, plano gratuito) ativo: o projeto é pausado após dias sem uso. Acionada pelo Vercel
 * Cron uma vez por dia (vercel.json), faz uma leitura e uma gravação mínimas — o horário do último sinal fica em
 * parâmetros da plataforma ("keepalive"). Protegida por CRON_SECRET como o executor de tarefas.
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
    console.error("[keepalive] banco indisponível", e);
    return NextResponse.json({ ok: false, at, error: String((e as Error)?.message ?? e) }, { status: 503 });
  }
}
