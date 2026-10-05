import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { listAll } from "@/lib/db";
import { onlyDigits, searchable } from "@/lib/core/text";

/** Identificação do cliente no PDV (Tela 6): nome, CPF/CNPJ, telefone e e-mail — mesma base do CRM. */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s?.ctx.companyId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!can(s.user, "pdv") && !can(s.user, "customers")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const store = s.ctx.store;
  const cid = s.ctx.companyId;
  const id = req.nextUrl.searchParams.get("id");
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  let rows;
  if (id) {
    const c = await store.get("customers", id);
    rows = c && c.companyId === cid ? [c] : [];
  } else {
    if (raw.length < 2) return NextResponse.json({ items: [] });
    const digits = onlyDigits(raw);
    const words = searchable(raw).split(" ").filter(Boolean).slice(0, 4);
    const filters: any[] = [["eq", "companyId", cid], ["ne", "status", "inactive"]];
    if (digits.length >= 4 && digits.length === raw.replace(/[\s.\-/()]/g, "").length) {
      // somente dígitos: CPF/CNPJ (prefixo) ou telefone
      filters.push(["or", [["startsWith", "doc", digits], ["contains", "searchText", digits]]]);
    } else {
      for (const w of words) filters.push(["contains", "searchText", w]);
    }
    rows = (await store.list("customers", { filters, limit: 12, orderBy: [{ field: "name", dir: "asc" }] })).items;
  }
  const ids = rows.map((r) => r.id);
  const open = ids.length ? await listAll(store, "installments", { filters: [["eq", "partyId", ids], ["eq", "kind", "receivable"], ["eq", "status", ["open", "partial"]]] }) : [];
  const vouchers = ids.length ? await listAll(store, "credit_vouchers", { filters: [["eq", "customerId", ids], ["eq", "status", "active"]] }) : [];
  const tables = await listAll(store, "price_tables", { filters: [["eq", "companyId", cid]] });
  const tmap = new Map(tables.map((t) => [t.id, t.name]));
  const last = new Map<string, string>();
  for (const cidk of ids) {
    const r = await store.list("sales", { filters: [["eq", "customerId", cidk], ["eq", "status", "completed"]], orderBy: [{ field: "completedAt", dir: "desc" }], limit: 1, total: false });
    if (r.items[0]) last.set(cidk, r.items[0].completedAt);
  }
  const items = rows.map((c) => {
    const openBalance = open.filter((i) => i.partyId === c.id).reduce((a, i) => a + i.balance, 0);
    return {
      id: c.id,
      name: c.name,
      tradeName: c.tradeName ?? null,
      personType: c.personType,
      doc: c.doc ?? null,
      email: c.email ?? null,
      mobile: c.mobile ?? c.phone ?? null,
      vip: Boolean(c.vip),
      status: c.status,
      creditLimit: c.creditLimit ?? 0,
      openBalance,
      creditAvailable: Math.max(0, (c.creditLimit ?? 0) - openBalance),
      priceTableId: c.priceTableId ?? null,
      priceTableName: c.priceTableId ? (tmap.get(c.priceTableId) ?? null) : null,
      lastPurchaseAt: last.get(c.id) ?? null,
      vouchers: vouchers.filter((v) => v.customerId === c.id).map((v) => ({ code: v.code, balance: v.balance, expiresAt: v.expiresAt })),
    };
  });
  return NextResponse.json({ items });
}
