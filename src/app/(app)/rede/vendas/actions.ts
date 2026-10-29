"use server";

import { runAction, fstr, fopt, fbool, fint } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { BusinessError } from "@/lib/core/errors";
import {
  saveCertCustomer, requireSellerNode, getCertCustomer, quoteNetworkSale, createNetworkSale, describeDuplicate, createCoupon, setCouponActive, createVoucherPackage, setVoucherPackageActive,
  purchaseVoucherPackage, issueVoucherCode, cancelVoucherCode, registerRenewalContact, saveIdleAlertDays, type NetworkSaleInput,
} from "@/domain/network";
import { cancelCertificateRequest, recordCertificateAuthorization, requestCertificateEmission, sendCertificateCharge, CHARGE_CHANNEL_LABEL } from "@/domain/accounting";
import type { SessionInfo } from "@/lib/server/session";

const PATHS = ["/rede/vendas", "/rede/clientes", "/rede/vouchers", "/rede/cupons", "/rede/renovacoes", "/rede/minha", "/administracao/certificacao"];

async function guard(s: SessionInfo) {
  await requireFeature(s, "redeCertificacao");
}

// ------------------------------------------------------------------------------------------------------------ clientes

export async function saveCustomerAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const id = fopt(fd, "id");
    const c = await saveCertCustomer(s.ctx, id, {
      personType: fstr(fd, "personType") === "PJ" ? "PJ" : "PF", doc: fstr(fd, "doc"), name: fstr(fd, "name"), email: fopt(fd, "email"), phone: fopt(fd, "phone"),
      address: { street: fopt(fd, "street"), number: fopt(fd, "number"), district: fopt(fd, "district"), cityName: fopt(fd, "cityName"), uf: fopt(fd, "uf"), zip: fopt(fd, "zip") },
      hasBirdId: fbool(fd, "hasBirdId"), birdIdValidTo: fopt(fd, "birdIdValidTo"), notes: fopt(fd, "notes"),
    });
    const back = fopt(fd, "back");
    return { ok: true as const, data: { id: c.id }, message: `Cliente ${c.code} ${c.name} ${id ? "alterado" : "cadastrado"}.`, redirect: back === "venda" ? `/rede/vendas/nova?cliente=${c.id}` : `/rede/clientes/${c.id}` };
  });
}

// ------------------------------------------------------------------------------------------------------------- vendas

function saleInput(fd: FormData): NetworkSaleInput {
  const priceRaw = fstr(fd, "price");
  return {
    customerId: fstr(fd, "customerId"), productKey: fstr(fd, "productKey"), price: priceRaw === "" || fbool(fd, "useDefault") ? null : fint(fd, "price"), couponCode: fopt(fd, "couponCode"),
    voucher: (fstr(fd, "voucher") || "none") as NetworkSaleInput["voucher"], voucherCode: fopt(fd, "voucherCode"), dueDate: fopt(fd, "dueDate"), contactEmail: fopt(fd, "contactEmail"), contactPhone: fopt(fd, "contactPhone"),
    notes: fopt(fd, "notes"), previousCertificateId: fopt(fd, "previousCertificateId"), duplicateReason: fopt(fd, "duplicateReason"), referrerNodeId: fopt(fd, "referrerNodeId"), idemKey: fopt(fd, "saleKey") ?? fopt(fd, "_idem"),
  };
}

export interface QuoteView {
  productLabel: string;
  free: boolean;
  gift: boolean;
  cost: number | null;
  minPrice: number | null;
  defaultPrice: number | null;
  canEdit: boolean;
  requestedPrice: number;
  discount: number;
  capped: boolean;
  belowMin: number;
  finalPrice: number;
  margin: number | null;
  couponCode: string | null;
  couponIssuedAbove: boolean;
  voucher: { packageName: string; unitPrice: number; code: string | null } | null;
  voucherAvailable: number;
  duplicates: string[];
  errors: string[];
}

/** Conferência da venda (preço, cupom, voucher e aviso de duplicidade) — nada é gravado. */
export async function quoteSaleAction(fd: FormData) {
  return runAction<QuoteView>({ module: "dashboard" }, async (s) => {
    await guard(s);
    const node = await requireSellerNode(s.ctx);
    const input = saleInput(fd);
    if (!input.customerId) throw new BusinessError("Escolha o cliente.", "customer");
    const customer = await getCertCustomer(s.ctx, input.customerId);
    const q = await quoteNetworkSale(s.ctx, node, customer, input);
    return {
      productLabel: q.product.label, free: q.free, gift: q.gift, cost: q.terms?.cost ?? null, minPrice: q.terms?.minPrice ?? null, defaultPrice: q.terms?.defaultPrice ?? null, canEdit: q.terms?.canEdit ?? false,
      requestedPrice: q.price?.requestedPrice ?? 0, discount: q.price?.discount ?? 0, capped: Boolean(q.price?.capped), belowMin: q.price?.belowMin ?? 0, finalPrice: q.price?.finalPrice ?? 0,
      margin: q.terms && q.price ? q.price.finalPrice - (q.voucher ? Number(q.voucher.lot.unitPrice) : q.terms.cost) : null,
      couponCode: q.coupon?.code ?? null, couponIssuedAbove: Boolean(q.coupon && q.coupon.issuerNodeId !== node.id),
      voucher: q.voucher ? { packageName: q.voucher.lot.packageName, unitPrice: Number(q.voucher.lot.unitPrice), code: q.voucher.code?.code ?? null } : null, voucherAvailable: q.voucherAvailable,
      duplicates: q.duplicates.map(describeDuplicate), errors: q.errors,
    };
  });
}

export async function createSaleAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const r = await createNetworkSale(s.ctx, saleInput(fd));
    const next = r.status === "awaiting_payment" ? "Próxima etapa: enviar a cobrança ao cliente." : "Sem cobrança: a equipe de certificação agenda a validação do titular.";
    return { ok: true as const, data: { id: r.id }, message: `Venda ${r.protocol} registrada. ${next}`, redirect: `/rede/vendas/${r.id}` };
  });
}

export async function sendSaleChargeAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const res = await sendCertificateCharge(s.ctx, fstr(fd, "id"), { channel: fstr(fd, "channel") as any, to: fopt(fd, "to"), dueDate: fopt(fd, "dueDate"), message: fopt(fd, "message") });
    return { ok: true as const, data: res, message: res.channel === "email" ? `Cobrança enviada por e-mail para ${res.to}.` : `Envio por ${CHARGE_CHANNEL_LABEL[res.channel] ?? res.channel} registrado para ${res.to}.` };
  });
}

export async function cancelSaleAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const r = await cancelCertificateRequest(s.ctx, fstr(fd, "id"), { reason: fstr(fd, "reason") });
    return { ok: true as const, message: `Venda ${r.protocol} cancelada (voucher e cupom devolvidos, se houver).` };
  });
}

export async function requestSaleEmissionAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const r = await requestCertificateEmission(s.ctx, fstr(fd, "id"));
    return { ok: true as const, message: `Emissão de ${r.protocol} pedida à equipe de certificação.` };
  });
}

export async function recordSaleAuthorizationAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const f = fd.get("evidence");
    const evidence = f && typeof f !== "string" && (f as File).size ? { name: (f as File).name || "evidencia", mime: (f as File).type || "application/octet-stream", data: Buffer.from(await (f as File).arrayBuffer()) } : null;
    await recordCertificateAuthorization(s.ctx, fstr(fd, "id"), { notes: fstr(fd, "notes"), evidence });
    return { ok: true as const, message: "Autorização do titular registrada: o download está liberado (com confirmação de senha)." };
  });
}

// -------------------------------------------------------------------------------------------------------------- cupons

export async function createCouponAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const kind = fstr(fd, "kind") === "fixed" ? "fixed" : "percent";
    const pct = fstr(fd, "percent").replace(",", ".");
    const c = await createCoupon(s.ctx, {
      code: fstr(fd, "code"), kind, valueBps: kind === "percent" ? Math.round(Number(pct) * 100) : null, valueCents: kind === "fixed" ? fint(fd, "valueCents") : null,
      productKey: fopt(fd, "productKey"), nodeId: fd.has("nodeId") ? (fstr(fd, "nodeId") === "__all" ? null : fopt(fd, "nodeId") ?? undefined) : undefined, sellerUserId: fopt(fd, "sellerUserId"),
      validFrom: fopt(fd, "validFrom"), validTo: fstr(fd, "validTo"), maxUses: fint(fd, "maxUses", 0) || null, maxPerHolder: fint(fd, "maxPerHolder", 0) || null, notes: fopt(fd, "notes"),
    });
    return { ok: true as const, message: `Cupom ${c.code} criado.` };
  });
}

export async function setCouponActiveAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const active = fstr(fd, "active") === "1";
    const c = await setCouponActive(s.ctx, fstr(fd, "id"), active, fopt(fd, "reason"));
    return { ok: true as const, message: `Cupom ${c.code} ${active ? "reativado" : "desativado"}.` };
  });
}

// ------------------------------------------------------------------------------------------------------------- vouchers

export async function createPackageAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const items: Array<{ productKey: string; qty: number; unitPrice: number }> = [];
    for (let i = 0; i < 10; i++) {
      const productKey = fstr(fd, `item${i}_product`);
      if (!productKey) continue;
      items.push({ productKey, qty: fint(fd, `item${i}_qty`), unitPrice: fint(fd, `item${i}_price`) });
    }
    const p = await createVoucherPackage(s.ctx, { name: fstr(fd, "name"), validFrom: fopt(fd, "validFrom"), validTo: fstr(fd, "validTo"), items, recipientNodeId: fopt(fd, "recipientNodeId"), notes: fopt(fd, "notes") });
    return { ok: true as const, message: `Pacote ${p.code} criado.` };
  });
}

export async function purchasePackageAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const r = await purchaseVoucherPackage(s.ctx, fstr(fd, "packageId"), { buyerNodeId: fopt(fd, "buyerNodeId"), generateCodes: fbool(fd, "generateCodes"), idemKey: fstr(fd, "_idem") });
    return { ok: true as const, message: `Pacote ${r.purchase.packageName} ${fopt(fd, "buyerNodeId") ? "atribuído" : "comprado"}: ${r.lots.reduce((a, l) => a + Number(l.qty), 0)} unidade(s) no saldo.${r.purchase.financeNote ? ` ${r.purchase.financeNote}` : " Lançado no financeiro (a receber e a pagar)."}` };
  });
}

export async function setPackageActiveAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const active = fstr(fd, "active") === "1";
    await setVoucherPackageActive(s.ctx, fstr(fd, "id"), active);
    return { ok: true as const, message: active ? "Pacote reaberto." : "Pacote encerrado para novas compras." };
  });
}

export async function issueCodeAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const c = await issueVoucherCode(s.ctx, fstr(fd, "lotId"), { gift: fbool(fd, "gift"), notes: fopt(fd, "notes") });
    return { ok: true as const, data: { code: c.code }, message: `Código ${c.code} emitido${c.gift ? " (presente: o cliente final paga R$ 0)" : ""}.` };
  });
}

export async function cancelCodeAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    const c = await cancelVoucherCode(s.ctx, fstr(fd, "id"), fstr(fd, "reason"));
    return { ok: true as const, message: `Código ${c.code} cancelado; a unidade voltou ao saldo.` };
  });
}

// ----------------------------------------------------------------------------------------------------------- renovações

export async function registerContactAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: PATHS }, async (s) => {
    await guard(s);
    await registerRenewalContact(s.ctx, fstr(fd, "certificateId"), { contactDate: fopt(fd, "contactDate"), channel: fstr(fd, "channel"), result: fstr(fd, "result"), notes: fopt(fd, "notes"), nextAction: fopt(fd, "nextAction"), nextActionDate: fopt(fd, "nextActionDate") });
    return { ok: true as const, message: "Contato registrado." };
  });
}

export async function saveIdleDaysAction(fd: FormData) {
  return runAction({ module: "dashboard", revalidate: ["/rede/parametros", "/rede/renovacoes"] }, async (s) => {
    await guard(s);
    const v = await saveIdleAlertDays(s.ctx, fint(fd, "idleAlertDays"));
    return { ok: true as const, message: `Alerta de renovação sem ação: ${v.idleAlertDays} dia(s) antes do vencimento.` };
  });
}
