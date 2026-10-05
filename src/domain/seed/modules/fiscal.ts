import { detId } from "@/lib/db";
import { today } from "@/lib/dates";
import type { DemoRefs } from "../base";

/**
 * Cenários fiscais de demonstração (idempotente; provedor de SIMULAÇÃO — sem validade fiscal):
 *  - NF-e pendente: produto de demonstração sem NCM (validação prévia bloqueia a transmissão);
 *  - NF-e rejeitada pelo provedor simulado: NCM inexistente (rejeição 778) — corrigir e retransmitir;
 *  - NF-e autorizada (simulação) com carta de correção;
 *  - NFS-e de serviço autorizada (RPS → processamento → NFS-e) com conta a receber do líquido;
 *  - obrigações da competência (PGDAS-D, DAS, entrega de XML, livro, DEFIS) com PGDAS-D concluída com comprovante;
 *  - integração "Área da contabilidade" configurada (sem teste) e tributos aproximados nos grupos.
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const { store, id: sid } = { store: refs.seeder.store, id: refs.seeder.id.bind(refs.seeder) };
  const out: Record<string, unknown> = {};
  const ctx = await refs.ctxFor("fiscal", "matriz");
  const admin = await refs.ctxFor("admin", "matriz");
  const base = { companyId: refs.company.id, isDemo: true };
  const { saveNfe } = await import("../../fiscal/nfe");
  const { queryDocument, correctionLetter, createNfse, transmitDocument } = await import("../../fiscal/service");
  const { partyRecipient } = await import("../../fiscal/nfe");

  // Tributos aproximados (Lei 12.741) nos grupos de demonstração — parâmetro, não tabela IBPT oficial
  for (const [key, bps] of [["simples-102", 2410], ["simples-500", 3150]] as const) {
    const g = await store.get("tax_groups", sid("tax_groups", key));
    if (g && g.approxTaxBps == null) await store.update("tax_groups", g.id, { approxTaxBps: bps });
  }

  // Produtos de demonstração com problema fiscal
  const tg = await store.get("tax_groups", sid("tax_groups", "simples-102"));
  const mk = async (key: string, name: string, ncm: string) => {
    const p = await refs.seeder.put("products", key, {
      ...base, type: "product", code: key.toUpperCase(), name, description: `${name} — demonstração fiscal`, unitCode: "UN", categoryId: refs.categories["Casa"].id, active: true, availablePdv: false,
      hasVariants: false, ncm: ncm || null, origin: "0", taxGroupId: tg?.id ?? null, searchText: name.toLowerCase(), status: "active",
    });
    const k = await refs.seeder.put("skus", `${key}-u`, { ...base, productId: p.id, sku: key.toUpperCase(), name, unitCode: "UN", active: true, costAcquisition: 1500, costAdditional: 0, costTotal: 1500, searchText: name.toLowerCase() });
    return { p, k };
  };
  const semNcm = await mk("fiscal-sem-ncm", "Luminária Decorativa (DEMO sem NCM)", "");
  const ncmRuim = await mk("fiscal-ncm-invalido", "Porta-retrato (DEMO NCM inexistente)", "00000000");
  const mercado = refs.customers.mercado;
  const input = (skuId: string, unitPrice: number, qty = 2000) => ({
    branchId: refs.branches.matriz.id,
    origin: { type: "manual" as const },
    nature: "Venda de mercadoria",
    purpose: "normal" as const,
    operationType: "saida" as const,
    presence: "1",
    recipient: partyRecipient(mercado, "customer"),
    items: [{ skuId, qty, unitPrice, discount: 0 }],
    freight: 0,
    insurance: 0,
    other: 0,
    transport: { mode: "9" },
    payments: [{ kind: "boleto", amount: Math.round((unitPrice * qty) / 1000) }],
    referencedKeys: [],
    effects: { stock: false, financial: false },
  });
  const exists = (ref: string) => store.get("fiscal_documents", detId("fiscaldoc", ref));

  if (!(await exists("nfe-demo-fiscal-pendente"))) {
    const d = await saveNfe(ctx, input(semNcm.k.id, 8990), { idemKey: "demo-fiscal-pendente", transmit: true });
    out.pending = d.status;
  }
  if (!(await exists("nfe-demo-fiscal-rejeitada"))) {
    const d = await saveNfe(ctx, input(ncmRuim.k.id, 3990, 3000), { idemKey: "demo-fiscal-rejeitada", transmit: true });
    out.rejected = d.status;
  }
  if (!(await exists("nfe-demo-fiscal-autorizada"))) {
    let d = await saveNfe(ctx, { ...input(refs.skus["caneca-u"].id, 3490, 6000), additionalInfo: "Pedido do cliente nº 4512 (demonstração)." }, { idemKey: "demo-fiscal-autorizada", transmit: true });
    if (d.status === "processing") d = await queryDocument(ctx, d.id);
    if (d.status === "authorized") d = await correctionLetter(ctx, d.id, "Correção do número do pedido do cliente nas informações complementares: onde se lê 4512 leia-se 4521.");
    out.authorized = { status: d.status, cce: d.correctionCount };
  }

  // NFS-e de serviço (consultoria) com ISS retido e IR, conta a receber do líquido na autorização
  if (!(await exists("nfse-demo-fiscal-nfse-1"))) {
    const escola = refs.customers.escola;
    const svc = refs.products.consultoria;
    let d = await createNfse(ctx, {
      branchId: refs.branches.matriz.id,
      recipient: { name: escola.name, doc: escola.doc, email: escola.email, im: "4455667", address: escola.addresses?.[0] },
      customerId: escola.id,
      serviceProductId: svc.id,
      competence: today(),
      description: "Consultoria de imagem para equipe de atendimento — 4 horas (demonstração).",
      serviceListItem: svc.serviceListItem ?? "17.01",
      municipalCode: svc.municipalServiceCode ?? undefined,
      calc: { amount: 72000, issRateBps: svc.issRateBps ?? 500, issWithheld: true, irBps: 150, withhold: { ir: true } },
      createReceivable: { dueDate: today() },
      idemKey: "demo-fiscal-nfse-1",
    });
    d = await transmitDocument(ctx, d.id);
    if (d.status === "processing") d = await queryDocument(ctx, d.id);
    out.nfse = d.status;
  }

  // Obrigações da competência + PGDAS-D concluída com comprovante (arquivo de demonstração)
  const { generateObligations, completeObligation, obligationId } = await import("../../fiscal/obligations");
  out.obligations = await generateObligations(ctx);
  const t = today();
  const comp = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const pg = await store.get("fiscal_obligations", obligationId(refs.company.id, "pgdas_d", comp));
  if (pg && pg.status !== "done") {
    await completeObligation(ctx, pg.id, {
      deliveredAt: t,
      receiptNumber: "DEMO-PGDAS-0001",
      amount: 123456,
      notes: "Conclusão de demonstração.",
      proof: { name: "comprovante-DEMONSTRACAO.txt", mime: "text/plain", data: Buffer.from("DEMONSTRAÇÃO — este arquivo não é um recibo real do PGDAS-D.\n") },
    });
    out.pgdasDone = true;
  }

  // DEFIS do ano anterior registrada como entregue (demonstração de obrigação anual "em dia")
  const year = String(Number(t.slice(0, 4)) - 1);
  const defisId = obligationId(refs.company.id, "defis", year);
  if (!(await store.get("fiscal_obligations", defisId))) {
    await store.create("fiscal_obligations", { companyId: refs.company.id, branchId: null, createdBy: ctx.user.id, kind: "defis", name: "DEFIS — declaração anual", period: year, dueDate: `${t.slice(0, 4)}-03-31`, status: "pending", recurrence: "annual", templateKey: "defis", scopeKey: `defis|${year}`, isDemo: true }, defisId);
  }
  const defis = await store.get("fiscal_obligations", defisId);
  if (defis && defis.status !== "done") {
    const delivered = `${t.slice(0, 4)}-03-28` <= t ? `${t.slice(0, 4)}-03-28` : t;
    await completeObligation(ctx, defisId, { deliveredAt: delivered, receiptNumber: "DEMO-DEFIS-0001", notes: "Entrega de demonstração.", proof: { name: "recibo-DEFIS-DEMONSTRACAO.txt", mime: "text/plain", data: Buffer.from("DEMONSTRAÇÃO — este arquivo não é um recibo real da DEFIS.\n") } });
  }

  // Teste real (simulação) das configurações fiscais das filiais — a situação passa a ser medida
  const { testFiscalConnection, getFiscalConfig } = await import("../../fiscal/service");
  for (const b of Object.values(refs.branches)) {
    const cfg = await getFiscalConfig(store, refs.company.id, b.id);
    if (cfg && !cfg.lastTestAt) await testFiscalConnection(await refs.ctxFor("admin", null), b.id).catch(() => undefined);
  }

  // Integração da contabilidade (configurada; a situação só muda com teste real)
  const accId = detId("integration", `${refs.company.id}|*|accounting`);
  if (!(await store.get("integrations", accId))) {
    const { saveIntegration } = await import("../../integrations");
    await saveIntegration(admin, { kind: "accounting", branchId: null, provider: "export_package", environment: "producao", config: { connectionName: "Escritório contábil (demonstração)", accountantEmail: "contabilidade@demo.intercert.local", accountantName: "Escritório Demo" } });
  }
  return out;
}
