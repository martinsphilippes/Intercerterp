import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { checkIntent } from "@/domain/payments/intents";

/** Consulta da cobrança Pix no provedor (polling do pagamento). Retorna o estado real informado pelo provedor. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s?.ctx.companyId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(s.user, "pdv")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;
  try {
    const i = await checkIntent(s.ctx, id);
    return NextResponse.json({ id: i.id, status: i.status, amount: i.amount, reference: i.reference, providerId: i.providerId ?? null, lastCheckedAt: i.lastCheckedAt ?? null, errorMessage: i.errorMessage ?? null, saleId: i.saleId ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Falha na consulta" }, { status: 400 });
  }
}
