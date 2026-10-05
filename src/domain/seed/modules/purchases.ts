import { listAll } from "@/lib/db";
import { addDays, today } from "@/lib/dates";
import { searchable } from "@/lib/core/text";
import type { DemoRefs } from "../base";
import { activePolicy, decideRequest, policyId, savePolicy, submitForApproval } from "../../approvals";
import { createOrder, registerOrderSent } from "../../purchases";
import { applySuggestion, createQuotation, quotationProposals, saveProposal } from "../../quotations";
import { confirmReceipt, importNfeXml, updateReceipt } from "../../receipts";
import { buildSampleNfeXml } from "../../nfe-xml";

/**
 * Cenários de demonstração de Compras (idempotente: ids determinísticos e verificação de estado):
 *  - política de aprovação: acima de R$ 5.000 (com frete) gestor (perfil Gerente) + diretoria (Diana Diretora);
 *  - cotação de acessórios com 3 fornecedores (frete, mínimo, validade; uma proposta vencida) e sugestão aplicada;
 *  - pedido VoltTech em análise acima de R$ 5.000, com a etapa do gestor já aprovada;
 *  - pedido Papel & Cia aprovado e enviado (registro manual identificado);
 *  - pedido Têxtil parcialmente recebido, com recebimento por XML confirmado (estoque + contas a pagar).
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const store = refs.seeder.store;
  const companyId = refs.company.id;
  const admin = await refs.ctxFor("admin", "matriz");
  const manager = await refs.ctxFor("manager", "matriz");
  const out: Record<string, unknown> = {};

  // 1) Política de aprovação demonstrativa
  if (!(await store.get("approval_policies", policyId(companyId)))) {
    const roleManager = (await listAll(store, "roles", { filters: [["eq", "companyId", companyId]] })).find((r) => r.key === "manager");
    await savePolicy(admin, {
      name: "Compras — alçadas da demonstração",
      rules: {
        tiers: [
          { above: 0, steps: [{ name: "Parecer do gestor", kind: "role", roleIds: [roleManager!.id] }] },
          { above: 500000, steps: [{ name: "Parecer do gestor", kind: "role", roleIds: [roleManager!.id] }, { name: "Diretoria", kind: "users", userIds: [refs.users.director.id] }] },
        ],
        distinctApprovers: true,
      },
      autoApproveBelow: 30000,
      allowSelfApproval: false,
      expiredProposalAction: "warn",
      reviewOnRevision: "relevant",
    });
  }
  out.policy = (await activePolicy(store, companyId))?.name;

  // 2) Terceiro fornecedor (acessórios) + vínculos
  const base = { companyId, isDemo: true };
  const acess = await refs.seeder.put("suppliers", "acessorios", {
    ...base, personType: "PJ", doc: "34567890000130", code: "ACESS", name: "Atacadão dos Acessórios Comércio Ltda", tradeName: "Atacadão Acessórios", email: "vendas@acessorios.example.com", phone: "1131313131",
    addresses: [{ type: "comercial", street: "Rua 25 de Março", number: "900", district: "Centro", cityName: "São Paulo", cityCode: "3550308", uf: "SP", zip: "01021000" }],
    contacts: [{ name: "Patrícia (vendas)", email: "vendas@acessorios.example.com", phone: "11931313131" }], paymentTermsText: "À vista", leadTimeDays: 5, minOrderValue: 30000,
    status: "active", searchText: searchable("Atacadão dos Acessórios Comércio Ltda", "Atacadão Acessórios", "34567890000130", "ACESS"),
  });
  for (const [k, cost] of [["bone-u", 1300], ["cinto-u", 2000], ["meia-u", 900]] as const) {
    await refs.seeder.put("supplier_products", `acessorios-${k}`, { ...base, supplierId: acess.id, skuId: refs.skus[k].id, supplierCode: `AA-${k.split("-")[0].toUpperCase()}`, supplierDescription: refs.skus[k].name.toUpperCase(), conversionFactor: 1000, lastCost: cost, leadTimeDays: 5, minQty: 1000, multiple: 1000, preferred: false });
  }

  // 3) Cotação com 3 fornecedores (frete, mínimo e validade; uma vencida)
  const q = await createQuotation(admin, {
    title: "Acessórios — reposição para a campanha de fim de ano",
    items: [{ skuId: refs.skus["bone-u"].id, qty: 120000 }, { skuId: refs.skus["cinto-u"].id, qty: 80000 }, { skuId: refs.skus["meia-u"].id, qty: 150000 }],
    supplierIds: [refs.suppliers.textil.id, refs.suppliers.calcados.id, acess.id],
    responseDue: addDays(today(), 3),
    notes: "Cotação de demonstração: compare frete e pedido mínimo, não só o preço unitário.",
    idemKey: "demo-quotation-acessorios",
  });
  if ((await quotationProposals(store, q.id)).length === 0 && q.status === "open") {
    const valid = addDays(today(), 10);
    await saveProposal(admin, q.id, { supplierId: refs.suppliers.textil.id, freight: 4500, minOrderValue: 50000, validUntil: valid, leadTimeDays: 7, paymentTermId: refs.terms["30-60"].id, items: [{ skuId: refs.skus["bone-u"].id, unitPrice: 1450 }, { skuId: refs.skus["cinto-u"].id, unitPrice: 2500 }, { skuId: refs.skus["meia-u"].id, unitPrice: 1050, discountBps: 200 }] });
    await saveProposal(admin, q.id, { supplierId: refs.suppliers.calcados.id, freight: 8000, minOrderValue: 300000, validUntil: addDays(today(), 7), leadTimeDays: 10, paymentTermId: refs.terms["28"].id, items: [{ skuId: refs.skus["cinto-u"].id, unitPrice: 2290 }, { skuId: refs.skus["meia-u"].id, unitPrice: 1020 }] });
    await saveProposal(admin, q.id, { supplierId: acess.id, freight: 3000, minOrderValue: 30000, validUntil: addDays(today(), -2), leadTimeDays: 5, paymentTermId: refs.terms.avista.id, notes: "Proposta enviada há 9 dias — vencida.", items: [{ skuId: refs.skus["bone-u"].id, unitPrice: 1300 }, { skuId: refs.skus["cinto-u"].id, unitPrice: 2000 }, { skuId: refs.skus["meia-u"].id, unitPrice: 900, available: true }] });
  }
  const qNow = await store.getOrThrow("quotations", q.id);
  if (qNow.status === "open" && !qNow.selection) await applySuggestion(admin, q.id);
  out.quotation = qNow.number;

  const ensureApproved = async (orderId: string) => {
    let o = await store.getOrThrow("purchase_orders", orderId);
    if (o.status === "draft") {
      await submitForApproval(admin, [orderId], { notes: "Demonstração" });
      o = await store.getOrThrow("purchase_orders", orderId);
    }
    if (o.status === "in_review") {
      const req = await store.getOrThrow("purchase_requests", o.requestId);
      if (req.status === "in_review" && (req.currentStep ?? 0) === 0) await decideRequest(manager, req.id, "approve", "Dentro do orçamento do mês.");
    }
    return store.getOrThrow("purchase_orders", orderId);
  };

  // 4) Pedido acima de R$ 5.000 em análise — etapa do gestor aprovada, aguardando a diretoria
  const big = await createOrder(admin, {
    supplierId: refs.suppliers.eletro.id,
    expectedDate: addDays(today(), 14),
    items: [{ skuId: refs.skus["fone-u"].id, qty: 60000, unitCost: 5900 }, { skuId: refs.skus["carregador-u"].id, qty: 80000, unitCost: 2800 }],
    freight: 15000,
    paymentTermId: refs.terms["30-60-90"].id,
    notes: "Reforço de eletrônicos para a Black Friday.",
    idemKey: "demo-po-eletro",
  });
  await ensureApproved(big.id);
  out.inReview = (await store.getOrThrow("purchase_orders", big.id)).status;

  // 5) Pedido aprovado e enviado
  const paper = await createOrder(admin, {
    supplierId: refs.suppliers.papel.id,
    expectedDate: addDays(today(), 3),
    items: [{ skuId: refs.skus["caderno-u"].id, qty: 100000, unitCost: 990 }, { skuId: refs.skus["caneta-u"].id, qty: 30000, unitCost: 2100 }],
    paymentTermId: refs.terms.avista.id,
    idemKey: "demo-po-papel",
  });
  let p = await ensureApproved(paper.id);
  if (p.status === "approved") p = await registerOrderSent(admin, paper.id, { method: "manual", channel: "WhatsApp comercial", contact: "Rogério (Papel & Cia)", notes: "Fornecedor confirmou entrega em 3 dias." });
  out.sent = p.status;

  // 6) Pedido parcialmente recebido com recebimento por XML confirmado
  const textil = await createOrder(admin, {
    supplierId: refs.suppliers.textil.id,
    expectedDate: addDays(today(), 2),
    items: [{ skuId: refs.skus["camiseta-m-preta"].id, qty: 24000, unitCost: 1890 }, { skuId: refs.skus["camiseta-g-preta"].id, qty: 16000, unitCost: 1890 }, { skuId: refs.skus["bone-u"].id, qty: 20000, unitCost: 1500 }],
    freight: 6000,
    paymentTermId: refs.terms["30-60"].id,
    idemKey: "demo-po-textil",
  });
  let t = await ensureApproved(textil.id);
  if (t.status === "approved") t = await registerOrderSent(admin, textil.id, { method: "manual", channel: "Telefone", contact: "Marcos (Têxtil Paulista)" });
  const receipts = await listAll(store, "receipts", { filters: [["contains", "orderIds", textil.id]] });
  if (!receipts.length && t.status === "sent") {
    const issue = addDays(today(), -1);
    const xml = buildSampleNfeXml({
      number: 4711, issueDate: issue,
      emitter: { cnpj: refs.suppliers.textil.doc, name: refs.suppliers.textil.name, tradeName: refs.suppliers.textil.tradeName, ie: "110042490999" },
      recipient: { cnpj: refs.branches.matriz.cnpj, name: refs.company.name, ie: refs.branches.matriz.ie },
      items: [
        { cProd: "F-CAMISETA-M-PRETA", cEAN: "7891000100028", xProd: "CAMISETA ALGODAO BASICA M PRETA", ncm: "61091000", qCom: 24000, vUnCom: 1890 },
        { cProd: "F-CAMISETA-G-PRETA", cEAN: "7891000100035", xProd: "CAMISETA ALGODAO BASICA G PRETA", ncm: "61091000", qCom: 8000, vUnCom: 1890 },
        { cProd: "F-BONE", cEAN: "7891000500019", xProd: "BONE ABA CURVA", ncm: "65050090", qCom: 20000, vUnCom: 1500 },
      ],
      freight: 6000,
      duplicatas: [{ dVenc: addDays(issue, 30) }, { dVenc: addDays(issue, 60) }],
    });
    const stockist = await refs.ctxFor("stockist", "matriz");
    const r = await importNfeXml(stockist, { xml, fileName: "NFe-4711-textil-paulista.xml", orderIds: [textil.id] });
    await updateReceipt(stockist, r.id, { checkAll: true, items: [{ idx: 1, lot: "LT-2610-A" }, { idx: 2, lot: "LT-2610-A" }] });
    await confirmReceipt(stockist, r.id);
  }
  out.partial = (await store.getOrThrow("purchase_orders", textil.id)).status;
  return out;
}
