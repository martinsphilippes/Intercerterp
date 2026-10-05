import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { can } from "@/lib/permissions";
import { searchable, onlyDigits, formatDoc } from "@/lib/core/text";
import { formatMoney } from "@/lib/money";

/** Pesquisa global agrupada por tipo de registro, respeitando permissões e empresa ativa. */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s?.ctx.companyId) return NextResponse.json({ hits: [] }, { status: 401 });
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (raw.length < 2) return NextResponse.json({ hits: [] });
  const q = searchable(raw);
  const digits = onlyDigits(raw);
  const num = /^\d{1,9}$/.test(raw) ? Number(raw) : null;
  const store = s.ctx.store;
  const cid = s.ctx.companyId;
  const hits: Array<{ group: string; label: string; sub?: string; href: string }> = [];
  const lim = 6;
  const tasks: Promise<void>[] = [];
  if (can(s.user, "products")) {
    tasks.push(
      (async () => {
        const skus = await store.list("skus", { filters: [["eq", "companyId", cid], ["or", [["contains", "searchText", q], ["eq", "barcode", raw], ["eq", "sku", raw.toUpperCase()]]]], limit: lim });
        for (const k of skus.items) hits.push({ group: "Produto", label: k.name ?? k.sku, sub: `${k.sku}${k.barcode ? " · " + k.barcode : ""}`, href: `/produtos/${k.productId}` });
      })(),
    );
  }
  if (can(s.user, "customers")) {
    tasks.push(
      (async () => {
        const filters: any[] = [["eq", "companyId", cid]];
        filters.push(digits.length >= 5 ? ["or", [["contains", "searchText", q], ["startsWith", "doc", digits]]] : ["contains", "searchText", q]);
        const r = await store.list("customers", { filters, limit: lim });
        for (const c of r.items) hits.push({ group: "Cliente", label: c.name, sub: formatDoc(c.doc), href: `/clientes/${c.id}` });
      })(),
    );
  }
  if (can(s.user, "suppliers")) {
    tasks.push(
      (async () => {
        const r = await store.list("suppliers", { filters: [["eq", "companyId", cid], ["contains", "searchText", q]], limit: lim });
        for (const c of r.items) hits.push({ group: "Fornecedor", label: c.tradeName || c.name, sub: formatDoc(c.doc), href: `/fornecedores/${c.id}` });
      })(),
    );
  }
  if (num != null) {
    if (can(s.user, "sales"))
      tasks.push(
        (async () => {
          const r = await store.list("sales", { filters: [["eq", "companyId", cid], ["eq", "number", num]], limit: 3 });
          for (const x of r.items) hits.push({ group: "Venda", label: `Venda nº ${x.number}`, sub: `${formatMoney(x.total)} · ${x.customerSnapshot?.name ?? "Consumidor"}`, href: `/vendas/${x.id}` });
        })(),
      );
    if (can(s.user, "purchases"))
      tasks.push(
        (async () => {
          const r = await store.list("purchase_orders", { filters: [["eq", "companyId", cid], ["eq", "number", num]], limit: 3 });
          for (const x of r.items) hits.push({ group: "Pedido", label: `Pedido de compra nº ${x.number}`, sub: formatMoney(x.total), href: `/compras/pedidos/${x.id}` });
        })(),
      );
    if (can(s.user, "finance"))
      tasks.push(
        (async () => {
          const r = await store.list("titles", { filters: [["eq", "companyId", cid], ["eq", "number", num]], limit: 4 });
          for (const x of r.items) hits.push({ group: "Título", label: `${x.kind === "receivable" ? "A receber" : "A pagar"} nº ${x.number}`, sub: `${x.partyName ?? ""} · ${formatMoney(x.total)}`, href: `/financeiro/${x.kind === "receivable" ? "receber" : "pagar"}/${x.id}` });
        })(),
      );
    if (can(s.user, "fiscal"))
      tasks.push(
        (async () => {
          const r = await store.list("fiscal_documents", { filters: [["eq", "companyId", cid], ["eq", "number", num]], limit: 4 });
          for (const x of r.items) hits.push({ group: "Documento", label: `${x.model.toUpperCase()} nº ${x.number}`, sub: x.recipientName ?? "", href: `/fiscal/${x.model}/${x.id}` });
        })(),
      );
  }
  if (digits.length === 44 && can(s.user, "fiscal")) {
    tasks.push(
      (async () => {
        const r = await listAll(store, "fiscal_documents", { filters: [["eq", "accessKey", digits]] }, 3);
        for (const x of r) hits.push({ group: "Documento", label: `${x.model.toUpperCase()} ${x.number ?? ""}`, sub: digits, href: `/fiscal/${x.model}/${x.id}` });
      })(),
    );
  }
  await Promise.all(tasks.map((t) => t.catch(() => undefined)));
  return NextResponse.json({ hits: hits.slice(0, 30) });
}
