import { NextResponse, type NextRequest } from "next/server";
import { getStore, configuredBackend } from "@/lib/db";
import { dbOutageOf, outageLogLine } from "@/lib/db/outage";
import { unscoped } from "@/lib/db/scoped-store";
import { getSetting, setSetting } from "@/lib/core/settings";

/**
 * Sinal diário do banco (Vercel Cron, vercel.json): uma leitura e uma gravação mínimas, com o horário do último sinal em
 * parâmetros da plataforma ("keepalive"). Protegida por CRON_SECRET como o executor de tarefas.
 *
 * É um MONITOR: banco fora do ar, sem acesso ou limitado pelo plano responde 503 e fica registrado nos logs da Vercel
 * no mesmo dia. No Postgres não há pausa por inatividade a evitar. No Appwrite Cloud gratuito (instalações antigas) ela
 * não evitava a pausa — o Appwrite só conta a atividade no console dele (docs/regras-assumidas.md §47).
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
    // banco fora do ar, sem acesso ou limitado pelo plano: fica nos logs da Vercel, dizendo onde olhar
    const outage = dbOutageOf(e);
    console.error(`[keepalive] ${outageLogLine(outage, configuredBackend())}`, e);
    return NextResponse.json({ ok: false, at, outage: outage?.kind ?? null, error: String((e as Error)?.message ?? e) }, { status: 503 });
  }
}
