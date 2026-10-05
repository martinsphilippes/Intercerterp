"use server";

import { runAction, fstr, fopt, fjson } from "@/lib/server/action";
import { createQuotation, updateQuotation, saveProposal, removeProposal, importProposalsCsv, saveSelection, applySuggestion, generateOrders, cancelQuotation, type ProposalInput } from "@/domain/quotations";

const rv = (id?: string) => ["/compras/cotacoes", ...(id ? [`/compras/cotacoes/${id}`] : [])];

export async function saveQuotationAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "purchases", op: id ? "edit" : "create", requireBranch: !id, revalidate: rv(id ?? undefined) }, async (s) => {
    const input = { title: fstr(fd, "title"), items: fjson(fd, "items", []), supplierIds: fjson(fd, "supplierIds", []), responseDue: fopt(fd, "responseDue"), notes: fopt(fd, "notes"), origin: (fopt(fd, "origin") as any) ?? "manual" };
    const q = id ? await updateQuotation(s.ctx, id, input) : await createQuotation(s.ctx, { ...input, idemKey: `ui:${fstr(fd, "_idem")}` });
    return { ok: true as const, message: id ? "Cotação atualizada." : `Cotação nº ${q.number} criada. Registre as propostas dos fornecedores.`, redirect: `/compras/cotacoes/${q.id}?tab=propostas` };
  });
}

export async function saveProposalAction(fd: FormData) {
  const id = fstr(fd, "quotationId");
  return runAction({ module: "purchases", op: "edit", revalidate: rv(id) }, async (s) => {
    const input: ProposalInput = {
      supplierId: fstr(fd, "supplierId"),
      items: fjson(fd, "items", []),
      freight: Number(fstr(fd, "freight")) || 0,
      leadTimeDays: fstr(fd, "leadTimeDays") === "" ? null : Number(fstr(fd, "leadTimeDays")),
      paymentTermId: fopt(fd, "paymentTermId"),
      paymentTermsText: fopt(fd, "paymentTermsText"),
      minOrderValue: Number(fstr(fd, "minOrderValue")) || 0,
      validUntil: fopt(fd, "validUntil"),
      notes: fopt(fd, "notes"),
    };
    const p = await saveProposal(s.ctx, id, input);
    return { ok: true as const, message: `Proposta salva (versão ${p.version}). A comparação foi recalculada.` };
  });
}

export async function removeProposalAction(quotationId: string, supplierId: string) {
  return runAction({ module: "purchases", op: "edit", revalidate: rv(quotationId) }, async (s) => {
    await removeProposal(s.ctx, quotationId, supplierId);
    return { ok: true as const, message: "Proposta removida." };
  });
}

export async function importCsvAction(fd: FormData) {
  const id = fstr(fd, "quotationId");
  return runAction({ module: "purchases", op: "edit", revalidate: rv(id) }, async (s) => {
    const file = fd.get("csv");
    if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "Selecione o arquivo CSV." };
    const r = await importProposalsCsv(s.ctx, id, await file.text());
    return { ok: true as const, message: `${r.saved} proposta(s) importada(s).${r.errors.length ? ` Ignoradas: ${r.errors.slice(0, 3).join(" ")}` : ""}` };
  });
}

export async function selectionAction(id: string, assign: Record<string, string | null>) {
  return runAction({ module: "purchases", op: "edit", revalidate: rv(id) }, async (s) => {
    const ev = await saveSelection(s.ctx, id, assign, "manual");
    return { grandTotal: ev.grandTotal, groups: ev.groups.length };
  });
}

export async function suggestAction(id: string, onTimeOnly: boolean) {
  return runAction({ module: "purchases", op: "edit", revalidate: rv(id) }, async (s) => {
    const r = await applySuggestion(s.ctx, id, { onTimeOnly });
    return { ok: true as const, message: `Menor total com frete (heurística): ${r.evaluation.groups.length} fornecedor(es)${r.feasible ? "" : " — atenção: há mínimo não atingido ou item sem proposta viável"}.` };
  });
}

export async function generateOrdersAction(id: string, submit: boolean) {
  return runAction({ module: "purchases", op: "create", requireBranch: true, revalidate: [...rv(id), "/compras/pedidos", "/compras/aprovacoes"] }, async (s) => {
    const r = await generateOrders(s.ctx, id, { submit });
    return { ok: true as const, message: r.created ? `${r.orders.length} pedido(s) em rascunho gerado(s)${submit ? " e enviado(s) para análise como uma solicitação" : ""}.` : "Os pedidos desta cotação já tinham sido gerados (nada foi duplicado)." };
  });
}

export async function cancelQuotationAction(id: string, fd: FormData) {
  return runAction({ module: "purchases", op: "edit", revalidate: rv(id) }, async (s) => {
    await cancelQuotation(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: "Cotação cancelada." };
  });
}
