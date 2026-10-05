import "server-only";
import { listAll } from "@/lib/db";
import type { Ctx } from "@/lib/core/ctx";
import { dayRange, monthStart, today } from "@/lib/dates";
import { normalizeSearch, type ListParams } from "@/lib/list";
import { onlyDigits } from "@/lib/core/text";
import { DOC_STATUS_LABEL } from "@/domain/fiscal/service";
import { TPAG_LABEL } from "@/domain/fiscal/providers";
import { MODEL_LABEL, ORIGIN_LABEL, originHref, docNumberLabel } from "./labels";

export type FiscalModelKey = "nfe" | "nfce" | "nfse";

/** Período padrão das listagens fiscais: mês corrente (sempre explícito na tela). */
export function listPeriod(p: Pick<ListParams, "f">, defaultFrom?: string) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(p.f.from ?? "") ? p.f.from : (defaultFrom ?? monthStart(today()));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(p.f.to ?? "") ? p.f.to : today();
  return { from, to };
}

/** Consulta única das listagens de documentos (tela + exportação). */
export async function queryDocuments(ctx: Ctx, model: FiscalModelKey, p: Pick<ListParams, "q" | "f">) {
  // NFC-e: listagem padrão do dia corrente (documentos do caixa); demais: mês corrente
  const { from, to } = listPeriod(p, model === "nfce" ? today() : undefined);
  const { start, end } = dayRange(from, to);
  const filters: any[] = [["eq", "companyId", ctx.companyId], ["eq", "model", model], ["gte", "issuedAt", start], ["lt", "issuedAt", end]];
  // filial explícita no link (consulta) tem precedência; senão a filial do contexto (consolidado = todas)
  const branch = p.f.branch || ctx.branchId || null;
  if (branch) filters.push(["eq", "branchId", branch]);
  if (p.f.status) filters.push(["eq", "status", p.f.status.split(",")]);
  if (p.f.op) filters.push(["eq", "operationType", p.f.op]);
  if (p.f.purpose) filters.push(["eq", "purpose", p.f.purpose]);
  if (p.f.origin) filters.push(["eq", "originType", p.f.origin]);
  if (p.f.terminal) filters.push(["eq", "terminalId", p.f.terminal]);
  if (p.f.operator) filters.push(["eq", "operatorId", p.f.operator]);
  if (p.f.sim === "1") filters.push(["eq", "isSimulated", true]);
  if (p.f.sim === "0") filters.push(["eq", "isSimulated", false]);
  if (p.f.contingency === "1") filters.push(["eq", "contingency", true]);
  if (p.f.sale) {
    const n = Number(onlyDigits(p.f.sale));
    const sales = n ? await listAll(ctx.store, "sales", { filters: [["eq", "companyId", ctx.companyId], ["eq", "number", n]] }) : [];
    filters.push(["eq", "originId", sales.length ? sales.map((s) => s.id) : ["—"]]);
  }
  let docs = await listAll(ctx.store, "fiscal_documents", { filters, orderBy: [{ field: "issuedAt", dir: "desc" }] });
  const saleNumbers = new Map<string, number>();
  if (model === "nfce") {
    const ids = [...new Set(docs.filter((x) => x.originType === "sale" && x.originId).map((x) => x.originId))];
    for (let i = 0; i < ids.length; i += 100) {
      const sales = await listAll(ctx.store, "sales", { filters: [["eq", "id", ids.slice(i, i + 100)]] });
      for (const s of sales) saleNumbers.set(s.id, s.number);
    }
  }
  if (p.f.city) docs = docs.filter((x) => (x.service?.serviceCityCode ?? "") === p.f.city);
  if (p.q) {
    const q = normalizeSearch(p.q);
    const d = onlyDigits(p.q);
    docs = docs.filter((x) => {
      if (d.length === 44) return x.accessKey === d;
      if (d && d.length <= 9 && (x.number === Number(d) || x.rpsNumber === Number(d) || (x.originType === "sale" && saleNumbers.get(x.originId) === Number(d)))) return true;
      if (d.length >= 5 && (x.recipientDoc ?? "").startsWith(d)) return true;
      if (d.length >= 6 && (x.accessKey ?? "").includes(d)) return true;
      return normalizeSearch(`${x.recipientName ?? ""} ${x.ref ?? ""} ${x.nature ?? ""}`).includes(q);
    });
  }
  const branches = new Map((await listAll(ctx.store, "branches", { filters: [["eq", "companyId", ctx.companyId]] })).map((b) => [b.id, b.name]));
  const terminals = model === "nfce" ? new Map((await listAll(ctx.store, "terminals", { filters: [["eq", "companyId", ctx.companyId]] })).map((t) => [t.id, t.code])) : new Map<string, string>();
  const users = new Map((await listAll(ctx.store, "users")).map((u) => [u.id, u.name]));
  return docs.map((x) => ({
    ...x,
    numberLabel: docNumberLabel(x),
    modelLabel: MODEL_LABEL[x.model],
    statusLabel: DOC_STATUS_LABEL[x.status] ?? x.status,
    branchName: branches.get(x.branchId) ?? "—",
    originLabel: ORIGIN_LABEL[x.originType] ?? x.originType ?? "—",
    originHref: originHref(x.originType, x.originId),
    terminalCode: x.terminalId ? (terminals.get(x.terminalId) ?? "—") : "—",
    operatorName: x.operatorId ? (users.get(x.operatorId) ?? "—") : "—",
    saleNumber: x.originType === "sale" ? (saleNumbers.get(x.originId) ?? null) : null,
    recipientLabel: x.recipientName ?? (x.model === "nfce" ? "Consumidor não identificado" : "—"),
    simLabel: x.isSimulated ? "SIMULAÇÃO" : "",
    serviceItem: x.service?.serviceListItem ?? null,
    issValue: x.service?.iss ?? 0,
    issWithheld: x.service?.issWithheldValue ?? 0,
    netValue: x.service?.net ?? x.total ?? 0,
    competence: x.service?.competence ?? x.competenceDate ?? null,
    serviceDescription: x.service?.description ?? null,
    serviceCity: x.service?.serviceCityCode ?? null,
    paymentLabel: [...new Set((x.payments ?? []).map((pp: any) => TPAG_LABEL[pp.kind] ?? pp.kind))].join(" + ") || "—",
    itemsCount: (x.items ?? []).length,
    unitsCount: (x.items ?? []).reduce((a: number, i: any) => a + (i.qty ?? 0), 0),
  }));
}

export type DocRow = Awaited<ReturnType<typeof queryDocuments>>[number];

/** Totais do recorte por estado (para indicadores com link ao recorte filtrado). */
export function sliceStats(rows: DocRow[]) {
  const by = (statuses: string[]) => rows.filter((r) => statuses.includes(r.status));
  const sum = (arr: DocRow[]) => arr.reduce((a, r) => a + (r.total ?? 0), 0);
  const authorized = by(["authorized"]);
  const pending = by(["draft", "pending", "queued", "processing", "error"]);
  const rejected = by(["rejected", "denied"]);
  const cancelled = by(["cancelled"]);
  return {
    count: rows.length,
    total: sum(rows),
    authorized: { count: authorized.length, total: sum(authorized) },
    pending: { count: pending.length, total: sum(pending) },
    rejected: { count: rejected.length, total: sum(rejected) },
    cancelled: { count: cancelled.length, total: sum(cancelled) },
    simulated: rows.filter((r) => r.isSimulated).length,
  };
}
