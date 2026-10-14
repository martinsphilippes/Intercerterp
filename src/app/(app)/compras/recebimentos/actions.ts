"use server";

import { revalidatePath } from "next/cache";
import { runAction, fstr, fopt, fint, fjson, fbool } from "@/lib/server/action";
import { BusinessError } from "@/lib/core/errors";
import { importNfeXml, fetchXmlByKey, createManualReceipt, updateReceipt, confirmReceipt, cancelReceipt, type ManualReceiptItemInput, type ReceiptUpdate } from "@/domain/receipts";
import { createProductsFromReceipt, type NewProductRow } from "@/domain/receipt-products";

const PATHS = ["/compras/recebimentos", "/compras/pedidos"];

async function importOrRedirect(fn: () => Promise<Record<string, any>>) {
  try {
    const r = await fn();
    return { ok: true as const, message: `Recebimento nº ${r.number} aberto para conferência.`, redirect: `/compras/recebimentos/${r.id}` };
  } catch (e) {
    if (e instanceof BusinessError && e.code === "duplicate" && (e.details as any)?.id) {
      return { ok: true as const, message: `${e.message} Abrindo o recebimento existente (nada foi duplicado).`, redirect: `/compras/recebimentos/${(e.details as any).id}` };
    }
    throw e;
  }
}

/** Importação real do arquivo XML (upload). */
export async function importXmlAction(fd: FormData) {
  return runAction({ module: "purchases", requireBranch: true, revalidate: PATHS }, async (s) => {
    const file = fd.get("xml");
    if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "Selecione o arquivo XML da NF-e." };
    if (file.size > 5_000_000) return { ok: false as const, error: "Arquivo muito grande (máx. 5 MB)." };
    const xml = await file.text();
    const withoutOrder = fbool(fd, "withoutOrder");
    const orderIds = withoutOrder ? [] : fd.getAll("orderIds").map(String).filter(Boolean);
    return importOrRedirect(() => importNfeXml(s.ctx, { xml, fileName: file.name, orderIds: orderIds.length ? orderIds : null, withoutOrder, warehouseId: fopt(fd, "warehouseId") }));
  });
}

/** Chave digitada: só recupera o XML se houver integração capaz; senão orienta o upload do arquivo. */
export async function fetchByKeyAction(fd: FormData) {
  return runAction({ module: "purchases", requireBranch: true, revalidate: PATHS }, async (s) => {
    const key = fstr(fd, "key");
    const r = await fetchXmlByKey(s.ctx, key);
    if (!r.ok) return { ok: false as const, error: r.message, code: "no_integration" };
    return importOrRedirect(() => importNfeXml(s.ctx, { xml: r.xml, fileName: `NFe${key.replace(/\D/g, "")}.xml`, warehouseId: fopt(fd, "warehouseId") }));
  });
}

export async function manualReceiptAction(fd: FormData) {
  return runAction({ module: "purchases", requireBranch: true, revalidate: PATHS }, async (s) => {
    const orderIds = fd.getAll("orderIds").map(String).filter(Boolean);
    if (!fstr(fd, "supplierId")) return { ok: false as const, error: "Selecione o fornecedor." };
    const inv = fstr(fd, "invoicedTotal");
    // entrada sem pedido: itens, encargos e condição de pagamento informados no formulário
    const noOrder = fstr(fd, "orderMode") === "none";
    const extra = noOrder
      ? {
          items: fjson<ManualReceiptItemInput[]>(fd, "itemsJson", []),
          freight: fint(fd, "freight"),
          otherExpenses: fint(fd, "otherExpenses"),
          discount: fint(fd, "discount"),
          paymentTermId: fopt(fd, "paymentTermId"),
          paymentMethodId: fopt(fd, "paymentMethodId"),
        }
      : {};
    if (!noOrder && !orderIds.length) return { ok: false as const, error: "Selecione ao menos um pedido ou escolha “Sem pedido”." };
    return importOrRedirect(() =>
      createManualReceipt(s.ctx, { supplierId: fstr(fd, "supplierId"), orderIds: noOrder ? [] : orderIds, nfeKey: fopt(fd, "nfeKey"), nfeNumber: fopt(fd, "nfeNumber"), nfeSeries: fopt(fd, "nfeSeries"), issueDate: fopt(fd, "issueDate"), invoicedTotal: inv && inv !== "0" ? fint(fd, "invoicedTotal") : null, idemKey: fstr(fd, "_idem"), warehouseId: fopt(fd, "warehouseId"), ...extra }),
    );
  });
}

function parseUpdate(fd: FormData): ReceiptUpdate {
  const optInt = (k: string) => (fstr(fd, k) === "" ? undefined : fint(fd, k));
  return {
    items: fjson(fd, "items", []),
    addItems: fjson<ManualReceiptItemInput[]>(fd, "addItems", []),
    removeItems: fjson<number[]>(fd, "removeItems", []),
    orderIds: fd.has("orderIdsJson") ? fjson(fd, "orderIdsJson", []) : undefined,
    warehouseId: fopt(fd, "warehouseId"),
    freight: optInt("freight"),
    otherExpenses: optInt("otherExpenses"),
    discount: optInt("discount"),
    paymentTermId: fd.has("paymentTermId") ? fopt(fd, "paymentTermId") : undefined,
    differenceAction: (fopt(fd, "differenceAction") as any) ?? undefined,
    notes: fd.has("notes") ? fopt(fd, "notes") : undefined,
    invoicedTotal: fd.has("invoicedTotal") ? (fstr(fd, "invoicedTotal") === "" || fstr(fd, "invoicedTotal") === "0" ? null : fint(fd, "invoicedTotal")) : undefined,
    entryCfop: fd.has("entryCfop") ? fopt(fd, "entryCfop") : undefined,
    categoryId: fd.has("categoryId") ? fopt(fd, "categoryId") : undefined,
    costCenterId: fd.has("costCenterId") ? fopt(fd, "costCenterId") : undefined,
    paymentMethodId: fd.has("paymentMethodId") ? fopt(fd, "paymentMethodId") : undefined,
    effects: fd.has("effects") ? fjson(fd, "effects", undefined as any) : undefined,
    checkAll: fstr(fd, "intent") === "checkAll",
    // valores de frete/despesas/desconto exibidos quando o formulário foi carregado (edição = diferente deles)
    chargesShown: fd.has("freightShown") ? { freight: fint(fd, "freightShown"), otherExpenses: fint(fd, "otherExpensesShown"), discount: fint(fd, "discountShown") } : undefined,
    chargesAuto: fstr(fd, "intent") === "recalcCharges",
    chargesLostAck: fd.has("chargesLostAckShown") ? fstr(fd, "chargesLostAck") === "1" : undefined,
  };
}

export async function saveReceiptAction(fd: FormData) {
  const id = fstr(fd, "id");
  const intent = fstr(fd, "intent") || "save";
  const res = await runAction({ module: "purchases", requireBranch: true, revalidate: [`/compras/recebimentos/${id}`, ...PATHS] }, async (s) => {
    await updateReceipt(s.ctx, id, parseUpdate(fd));
    if (intent === "confirm") {
      const r = await confirmReceipt(s.ctx, id);
      return { ok: true as const, message: `Entrada concluída: recebimento nº ${r.number} confirmado.` };
    }
    return { ok: true as const, message: intent === "checkAll" ? "Itens marcados como conferidos." : intent === "recalcCharges" ? "Encargos recalculados pelo pedido." : "Conferência salva." };
  });
  // a conferência pode ter sido gravada (e os encargos recalculados) antes do erro na conclusão: atualiza a
  // página para o formulário ser remontado com os valores gravados (a chave do formulário é o updatedAt)
  if (!res.ok && id) revalidatePath(`/compras/recebimentos/${id}`);
  return res;
}

/** Retentativa de confirmação interrompida (efeitos idempotentes). */
export async function resumeConfirmAction(id: string) {
  return runAction({ module: "purchases", requireBranch: true, revalidate: [`/compras/recebimentos/${id}`, ...PATHS] }, async (s) => {
    const r = await confirmReceipt(s.ctx, id);
    return { ok: true as const, message: `Recebimento nº ${r.number} confirmado.` };
  });
}

export async function cancelReceiptAction(id: string, fd: FormData) {
  return runAction({ module: "purchases", requireBranch: true, revalidate: [`/compras/recebimentos/${id}`, ...PATHS] }, async (s) => {
    await cancelReceipt(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: "Recebimento cancelado. A chave pode ser importada novamente." };
  });
}

/** Cadastro de produtos a partir dos itens do XML sem vínculo (prévia confirmada na conferência). */
export async function createProductsFromReceiptAction(fd: FormData) {
  const id = fstr(fd, "id");
  return runAction({ module: "purchases", requireBranch: true, revalidate: [`/compras/recebimentos/${id}`, "/produtos"] }, async (s) => {
    const all = fjson<Array<NewProductRow & { include?: boolean }>>(fd, "rows", []);
    // botão "Cadastrar" de uma linha envia only=<item>; "Cadastrar todos os selecionados" usa as linhas marcadas
    const only = fstr(fd, "only");
    const rows = only ? all.filter((r) => String(r.idx) === only) : all.filter((r) => r.include !== false);
    const res = await createProductsFromReceipt(s.ctx, id, rows);
    const created = res.filter((x) => x.action === "created").length;
    const linked = res.filter((x) => x.action === "linked_existing");
    return {
      ok: true as const,
      message: [`${created} produto(s) cadastrado(s) e associado(s) aos itens da nota.`, ...linked.map((x) => x.message)].join(" "),
    };
  });
}
