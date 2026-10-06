import { NextResponse, type NextRequest } from "next/server";
import { requireApiSession } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { today } from "@/lib/dates";

/** Consulta de vale-crédito pelo código (saldo, validade e titular) para uso no pagamento. */
export async function GET(req: NextRequest) {
  const s = await requireApiSession();
  if (s instanceof NextResponse) return s;
  if (!can(s.user, "pdv")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "Informe o código" }, { status: 400 });
  const res = await s.ctx.store.list("credit_vouchers", { filters: [["eq", "code", code], ["eq", "companyId", s.ctx.companyId]], limit: 1 });
  const v = res.items[0];
  if (!v) return NextResponse.json({ error: "Vale-crédito não encontrado." }, { status: 404 });
  const customer = v.customerId ? await s.ctx.store.get("customers", v.customerId) : null;
  const expired = Boolean(v.expiresAt && v.expiresAt < today());
  return NextResponse.json({ id: v.id, code: v.code, balance: v.balance, originalAmount: v.originalAmount, status: v.status, expiresAt: v.expiresAt ?? null, expired, customerId: v.customerId ?? null, customerName: customer?.name ?? null, returnId: v.returnId ?? null });
}
