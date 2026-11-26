"use server";
import { PermissionError } from "@/lib/core/errors";
import { canDo } from "@/lib/permissions";

import { runAction, fbool, fint, fjson, fopt, fstr } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { BusinessError } from "@/lib/core/errors";
import type { SessionInfo } from "@/lib/server/session";
import { unscoped } from "@/lib/db/scoped-store";
import { requireStore } from "@/domain/ecommerce/common";
import {
  applyTemplate,
  createStore,
  defaultPages,
  legalOf,
  pauseStore,
  paymentsOf,
  publishStore,
  saveCheckout,
  saveIdentity,
  saveLegalContact,
  savePages,
  savePayments,
  saveShipping,
  setThemeImage,
  shippingOf,
  type OwnZone,
} from "@/domain/ecommerce/store";
import { addDomain, removeDomain, setPrimaryDomain, verifyDomain } from "@/domain/ecommerce/domains";
import { addToCatalog, saveListing, setPresence, validateListings, MAX_IMAGES, listingOf } from "@/domain/ecommerce/catalog";
import { uploadStoreImage } from "@/domain/ecommerce/images";
import { prepareChannel } from "@/domain/ecommerce/channels";
import { cancelOrder, completeReturn, confirmDelivery, confirmPickup, confirmPicking, dispatchOrder, generateLabel, orderOfCompany, retryCharge } from "@/domain/ecommerce/orders";
import { invoiceOrder } from "@/domain/ecommerce/fiscal";
import { saveCoupon, saveRecoveryDraft, setCouponActive, testCoupon } from "@/domain/ecommerce/promotions";
import { simulatePaymentEvent } from "@/domain/ecommerce/checkout";
import { preparePayout, reconcileTransaction, setSettlementAccount, simulateCredits } from "@/domain/ecommerce/bank";
import { deliveryOptions } from "@/domain/ecommerce/shipping";
import { dismissEvent, reprocessEvent } from "@/domain/ecommerce/monitor";
import { QTY } from "@/lib/money";
import type { DeliveryMode } from "@/domain/ecommerce/common";
import type { TemplateKey } from "@/domain/ecommerce/templates";

const BASE = "/comercio-digital";
const opts = (...paths: string[]) => ({ module: "sales" as const, revalidate: [BASE, ...paths.map((p) => `${BASE}${p}`)] });
const guard = (s: SessionInfo) => requireFeature(s, "comercioDigital");
/** A ação exige a mesma operação que a tela que a oferece (inventário multiempresa D3). */
const requireAnyEcom = (s: SessionInfo, actions: string[]) => {
  if (!actions.some((a) => canDo(s.user, a as any))) throw new PermissionError();
};
const ids = (fd: FormData, key = "productIds") => fd.getAll(key).map(String).filter(Boolean);
const percentBps = (v: string | null) => (v ? Math.round(Number(v.replace(",", ".")) * 100) : 0);

// ───────────────────────────── Loja (Telas 49–51)

export async function createStoreAction(fd: FormData) {
  return runAction(opts(), async (s) => {
    await guard(s);
    await createStore(s.ctx, { name: fopt(fd, "name"), fulfillmentBranchId: fopt(fd, "branchId") });
    return { ok: true as const, message: "Loja virtual criada em rascunho. Escolha o modelo e personalize.", redirect: `${BASE}/modelos` };
  });
}

export async function applyTemplateAction(key: TemplateKey, _fd: FormData) {
  return runAction(opts("/modelos", "/editor"), async (s) => {
    await guard(s);
    await applyTemplate(s.ctx, key);
    return { ok: true as const, message: "Modelo aplicado ao rascunho. Siga para o editor para personalizar.", redirect: `${BASE}/editor` };
  });
}

export async function saveIdentityAction(fd: FormData) {
  return runAction(opts("/editor", "/modelos"), async (s) => {
    await guard(s);
    const accent = fstr(fd, "accentCustom") || fstr(fd, "accentColor");
    await saveIdentity(s.ctx, {
      name: fstr(fd, "name"),
      title: fstr(fd, "title"),
      tagline: fstr(fd, "tagline"),
      accentColor: accent,
      editorial: fopt(fd, "editorial"),
      offerProductId: fopt(fd, "offerProductId"),
      sections: { categories: fbool(fd, "secCategories"), benefits: fbool(fd, "secBenefits"), featured: fbool(fd, "secFeatured") },
      benefits: [1, 2, 3, 4].map((i) => fstr(fd, `benefit${i}`)),
      seoTitle: fopt(fd, "seoTitle"),
      seoDescription: fopt(fd, "seoDescription"),
    });
    return { ok: true as const, message: "Alterações salvas no rascunho da loja." };
  });
}

export async function uploadThemeImageAction(which: "logo" | "hero", fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new BusinessError("Escolha a imagem.");
    const saved = await uploadStoreImage(s.ctx, { name: file.name, data: Buffer.from(await file.arrayBuffer()), purpose: which });
    await setThemeImage(s.ctx, which, saved.id);
    return { ok: true as const, message: which === "logo" ? "Logotipo atualizado." : "Imagem de destaque atualizada." };
  });
}

export async function removeThemeImageAction(which: "logo" | "hero", _fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    await setThemeImage(s.ctx, which, null);
    return { ok: true as const, message: "Imagem removida da loja." };
  });
}

export async function saveLegalContactAction(fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    await saveLegalContact(
      s.ctx,
      { companyName: fstr(fd, "companyName"), cnpj: fstr(fd, "cnpj"), address: fstr(fd, "address"), email: fstr(fd, "legalEmail"), phone: fstr(fd, "legalPhone") },
      { whatsapp: fstr(fd, "whatsapp"), email: fstr(fd, "contactEmail"), phone: fstr(fd, "contactPhone"), hours: fstr(fd, "hours") },
    );
    return { ok: true as const, message: "Dados do fornecedor e contato salvos." };
  });
}

export async function savePagesAction(fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    await savePages(s.ctx, { about: fstr(fd, "about"), exchanges: fstr(fd, "exchanges"), shipping: fstr(fd, "shipping"), privacy: fstr(fd, "privacy"), terms: fstr(fd, "terms") });
    return { ok: true as const, message: "Páginas da loja salvas." };
  });
}

export async function restoreDefaultPagesAction(_fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    const st = await requireStore(s.ctx);
    await savePages(s.ctx, defaultPages(st.name, legalOf(st)));
    return { ok: true as const, message: "Textos padrão restaurados com os dados atuais do fornecedor (revise antes de publicar)." };
  });
}

export async function saveCheckoutAction(fd: FormData) {
  return runAction(opts("/pagamentos"), async (s) => {
    await guard(s);
    await saveCheckout(s.ctx, { requireDoc: fbool(fd, "requireDoc"), minOrder: fint(fd, "minOrder"), orderPrefix: fstr(fd, "orderPrefix"), safetyStockQty: fint(fd, "safetyUnits") * QTY });
    return { ok: true as const, message: "Regras do checkout salvas." };
  });
}

export async function addDomainAction(fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    const d = await addDomain(s.ctx, fstr(fd, "domain"));
    return { ok: true as const, message: d.status === "active" ? `Domínio ${d.domain} verificado e ativo.` : `Domínio ${d.domain} cadastrado: configure o DNS conforme as instruções e verifique.` };
  });
}

export async function verifyDomainAction(id: string, _fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    const d = await verifyDomain(s.ctx, id);
    return { ok: true as const, message: d.status === "active" ? "Domínio verificado e ativo." : `Verificação: ${d.diagnostic}` };
  });
}

export async function setPrimaryDomainAction(id: string, _fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    await setPrimaryDomain(s.ctx, id);
    return { ok: true as const, message: "Domínio principal atualizado." };
  });
}

export async function removeDomainAction(id: string, fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    await removeDomain(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: "Domínio removido da loja." };
  });
}

export async function publishStoreAction(_fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    await publishStore(s.ctx);
    return { ok: true as const, message: "Loja publicada: a vitrine já recebe pedidos." };
  });
}

export async function pauseStoreAction(fd: FormData) {
  return runAction(opts("/editor"), async (s) => {
    await guard(s);
    await pauseStore(s.ctx, fstr(fd, "reason"));
    return { ok: true as const, message: "Loja pausada: a vitrine mostra o aviso de pausa; pedidos em andamento continuam." };
  });
}

// ───────────────────────────── Catálogo (Tela 52)

export async function addToCatalogAction(fd: FormData) {
  return runAction(opts("/catalogo"), async (s) => {
    await guard(s);
    const n = await addToCatalog(s.ctx, ids(fd));
    return { ok: true as const, message: n ? `${n} produto(s) incluído(s) no catálogo digital (fora da vitrine até publicar).` : "Os produtos selecionados já estavam no catálogo." };
  });
}

export async function setPresenceAction(published: boolean, fd: FormData) {
  return runAction(opts("/catalogo"), async (s) => {
    await guard(s);
    const list = ids(fd);
    if (!list.length) throw new BusinessError("Selecione ao menos um produto.");
    const n = await setPresence(s.ctx, list, published);
    return { ok: true as const, message: published ? `${n} produto(s) colocado(s) na vitrine (os com pendência bloqueante só aparecem depois de corrigidos).` : `${n} produto(s) retirado(s) da vitrine.` };
  });
}

export async function validateSelectionAction(fd: FormData) {
  return runAction(opts("/catalogo", "/monitor"), async (s) => {
    await guard(s);
    const list = ids(fd);
    if (!list.length) throw new BusinessError("Selecione os produtos a validar.");
    await addToCatalog(s.ctx, list);
    const rows = await validateListings(s.ctx, list);
    const failed = rows.filter((r) => (r.issues ?? []).some((i: { blocking?: boolean }) => i.blocking)).length;
    return { ok: true as const, message: failed ? `${rows.length - failed} produto(s) pronto(s); ${failed} com pendência registrada no monitor.` : `${rows.length} produto(s) validado(s) sem pendências.` };
  });
}

export async function saveListingAction(productId: string, fd: FormData) {
  return runAction(opts("/catalogo"), async (s) => {
    await guard(s);
    const num = (k: string) => (fopt(fd, k) ? Math.round(Number(fstr(fd, k).replace(",", "."))) : null);
    await saveListing(s.ctx, productId, {
      title: fstr(fd, "title"),
      slug: fopt(fd, "slug"),
      description: fstr(fd, "description"),
      categoryId: fopt(fd, "categoryId"),
      images: fd.getAll("images").map(String).filter(Boolean),
      priceOverride: fint(fd, "priceOverride") || null,
      compareAtPrice: fint(fd, "compareAtPrice") || null,
      weightGrams: num("weightGrams"),
      heightCm: num("heightCm"),
      widthCm: num("widthCm"),
      lengthCm: num("lengthCm"),
      featured: fbool(fd, "featured"),
      published: fbool(fd, "published"),
      seoTitle: fopt(fd, "seoTitle"),
      seoDescription: fopt(fd, "seoDescription"),
    });
    return { ok: true as const, message: "Produto da loja salvo e validado." };
  });
}

export async function uploadListingImageAction(productId: string, fd: FormData) {
  return runAction(opts("/catalogo"), async (s) => {
    await guard(s);
    const st = await requireStore(s.ctx);
    const l = await listingOf(s.ctx.store, st.id, productId);
    if (!l) throw new BusinessError("Inclua o produto no catálogo antes de enviar fotos.");
    if ((l.images ?? []).length >= MAX_IMAGES) throw new BusinessError(`Limite de ${MAX_IMAGES} fotos por produto.`);
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) throw new BusinessError("Escolha a foto.");
    const saved = await uploadStoreImage(s.ctx, { name: file.name, data: Buffer.from(await file.arrayBuffer()), purpose: "product" });
    await unscoped(s.ctx.store).update("store_products", l.id, { images: [...(l.images ?? []), saved.id] });
    await validateListings(s.ctx, [productId], { silent: true });
    return { ok: true as const, message: "Foto enviada." };
  });
}

export async function removeListingImageAction(productId: string, fileId: string, _fd: FormData) {
  return runAction(opts("/catalogo"), async (s) => {
    await guard(s);
    const st = await requireStore(s.ctx);
    const l = await listingOf(s.ctx.store, st.id, productId);
    if (!l) throw new BusinessError("Produto fora do catálogo.");
    await unscoped(s.ctx.store).update("store_products", l.id, { images: (l.images ?? []).filter((x: string) => x !== fileId) });
    await validateListings(s.ctx, [productId], { silent: true });
    return { ok: true as const, message: "Foto removida." };
  });
}

// ───────────────────────────── Canais (Tela 53)

export async function prepareChannelAction(key: string, fd: FormData) {
  return runAction(opts("/canais", "/monitor"), async (s) => {
    await guard(s);
    await prepareChannel(s.ctx, key, { accountName: fstr(fd, "accountName"), catalogScope: fstr(fd, "catalogScope") === "categories" ? "categories" : "all", categoryIds: fd.getAll("categoryIds").map(String).filter(Boolean), notes: fopt(fd, "notes") });
    return { ok: true as const, message: "Conta preparada em rascunho. Salvar não conecta: a ativação depende do conector do canal." };
  });
}

// ───────────────────────────── Pedidos e expedição (Telas 54 e 59)

const orderPaths = (id: string) => opts("/pedidos", `/pedidos/${id}`, "/expedicao", "/monitor", "/banco");

export async function invoiceOrderAction(id: string, _fd: FormData) {
  return runAction({ ...orderPaths(id), revalidate: [...orderPaths(id).revalidate, "/fiscal/nfe"] }, async (s) => {
    await guard(s);
    const o = await invoiceOrder(s.ctx, id);
    return { ok: true as const, message: o.fiscalStatus === "authorized" ? "NF-e autorizada: pedido liberado para a expedição." : `NF-e enviada (${o.fiscalStatus}). A autorização libera a expedição.` };
  });
}

export async function cancelOrderAction(id: string, fd: FormData) {
  return runAction(orderPaths(id), async (s) => {
    await guard(s);
    const o = await cancelOrder(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: o.refundStatus === "pending" ? "Pedido cancelado; estorno ao cliente pendente." : "Pedido cancelado e reserva liberada." };
  });
}

export async function confirmPickingAction(id: string, fd: FormData) {
  return runAction(orderPaths(id), async (s) => {
    await guard(s);
    const o = await confirmPicking(s.ctx, id, { volumes: fint(fd, "volumes", 1), note: fopt(fd, "note") });
    return { ok: true as const, message: o.status === "ready_for_pickup" ? "Separação conferida: pedido pronto para retirada (cliente avisado)." : "Separação e conferência registradas." };
  });
}

export async function generateLabelAction(id: string, _fd: FormData) {
  return runAction(orderPaths(id), async (s) => {
    await guard(s);
    const o = await generateLabel(s.ctx, id);
    return { ok: true as const, message: `Etiqueta ${o.delivery?.trackingCode}: ${o.delivery?.labelNote ?? ""}` };
  });
}

export async function dispatchOrderAction(id: string, _fd: FormData) {
  return runAction(orderPaths(id), async (s) => {
    await guard(s);
    await dispatchOrder(s.ctx, id);
    return { ok: true as const, message: "Despacho registrado e estoque baixado." };
  });
}

export async function confirmPickupAction(id: string, fd: FormData) {
  return runAction(orderPaths(id), async (s) => {
    await guard(s);
    await confirmPickup(s.ctx, id, fstr(fd, "code"));
    return { ok: true as const, message: "Retirada confirmada e estoque baixado." };
  });
}

export async function confirmDeliveryAction(id: string, fd: FormData) {
  return runAction(orderPaths(id), async (s) => {
    await guard(s);
    await confirmDelivery(s.ctx, id, fopt(fd, "note"));
    return { ok: true as const, message: "Entrega concluída." };
  });
}

export async function completeReturnAction(id: string, fd: FormData) {
  return runAction(orderPaths(id), async (s) => {
    await guard(s);
    const o = await completeReturn(s.ctx, id, fstr(fd, "note"));
    return { ok: true as const, message: o.refundStatus === "pending" ? "Devolução registrada; estorno pendente." : "Devolução registrada e estorno feito." };
  });
}

export async function retryChargeAction(id: string, _fd: FormData) {
  return runAction(orderPaths(id), async (s) => {
    await guard(s);
    requireAnyEcom(s, ["ecommerce.orders"]);
    const o = await orderOfCompany(s.ctx, id);
    const after = await retryCharge(s.ctx.store, o);
    return { ok: true as const, message: after.payment?.status === "error" ? `Cobrança ainda não gerada: ${after.payment?.message ?? ""}` : "Cobrança gerada novamente." };
  });
}

// ───────────────────────────── Promoções e carrinhos (Tela 55)

export async function saveCouponAction(fd: FormData) {
  return runAction(opts("/promocoes"), async (s) => {
    await guard(s);
    const c = await saveCoupon(s.ctx, {
      code: fstr(fd, "code"),
      description: fopt(fd, "description"),
      percentBps: percentBps(fopt(fd, "percent")),
      capAmount: fint(fd, "capAmount"),
      minOrder: fint(fd, "minOrder"),
      freeShipping: fbool(fd, "freeShipping"),
      active: fbool(fd, "active"),
      validFrom: fopt(fd, "validFrom"),
      validTo: fopt(fd, "validTo"),
      usageLimit: fint(fd, "usageLimit") || null,
      perCustomerLimit: fint(fd, "perCustomerLimit") || null,
    });
    return { ok: true as const, message: `Cupom ${c.code} salvo${c.active ? " e ativo" : " (pausado)"}.`, redirect: `${BASE}/promocoes?cupom=${encodeURIComponent(c.code)}` };
  });
}

export async function setCouponActiveAction(id: string, active: boolean, _fd: FormData) {
  return runAction(opts("/promocoes"), async (s) => {
    await guard(s);
    await setCouponActive(s.ctx, id, active);
    return { ok: true as const, message: active ? "Cupom ativado." : "Cupom pausado." };
  });
}

export async function testCouponAction(couponId: string, fd: FormData) {
  return runAction<{ discount: number; problem: string | null; totalGoods: number }>({ module: "sales" }, async (s) => {
    await guard(s);
    const st = await requireStore(s.ctx);
    const c = await unscoped(s.ctx.store).getOrThrow("store_coupons", couponId);
    if (c.storeId !== st.id) throw new BusinessError("Cupom de outra loja.");
    const goods = fint(fd, "goods");
    const r = testCoupon(c, goods);
    return { ok: true as const, data: r, message: r.problem ? `Não se aplica: ${r.problem}` : `Desconto de ${(r.discount / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} sobre ${(goods / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em produtos.` };
  });
}

export async function saveRecoveryDraftAction(cartId: string, fd: FormData) {
  return runAction(opts("/promocoes"), async (s) => {
    await guard(s);
    await saveRecoveryDraft(s.ctx, cartId, fstr(fd, "message"));
    return { ok: true as const, message: "Mensagem salva em rascunho. Nenhuma mensagem foi enviada." };
  });
}

// ───────────────────────────── Gateway e checkout (Tela 56)

export async function savePaymentsAction(fd: FormData) {
  return runAction(opts("/pagamentos"), async (s) => {
    await guard(s);
    const st = await requireStore(s.ctx);
    const cur = paymentsOf(st);
    await savePayments(s.ctx, {
      methods: {
        pix: { enabled: fbool(fd, "pix"), expiresMinutes: fint(fd, "pixMinutes", 30) },
        card: { enabled: fbool(fd, "card"), maxInstallments: fint(fd, "maxInstallments", 6), minInstallment: fint(fd, "minInstallment", 0) },
        boleto: { enabled: fbool(fd, "boleto"), dueDays: fint(fd, "boletoDays", 3) },
      },
      autoInvoice: fbool(fd, "autoInvoice"),
      feeBps: cur.feeBps,
      settlementDays: cur.settlementDays,
    });
    return { ok: true as const, message: "Meios de pagamento salvos." };
  });
}

export async function simulateEventAction(fd: FormData) {
  return runAction(opts("/pagamentos", "/pedidos", "/monitor", "/banco", "/expedicao"), async (s) => {
    await guard(s);
    requireAnyEcom(s, ["ecommerce.manage", "ecommerce.finance"]);
    const o = await orderOfCompany(s.ctx, fstr(fd, "orderId"));
    const type = fstr(fd, "type") as "approved" | "pending" | "failed" | "expired";
    if (!["approved", "pending", "failed", "expired"].includes(type)) throw new BusinessError("Evento inválido.");
    const repeat = fopt(fd, "repeatOf");
    const r = await simulatePaymentEvent(s.ctx.store, o, type, { repeatOf: repeat });
    // mantém o mesmo pedido selecionado no simulador (para repetir o evento e acompanhar o efeito)
    return { ok: true as const, message: `${r.outcome === "duplicate" ? "Evento repetido" : r.outcome === "ignored" ? "Evento ignorado" : "Evento aplicado"}: ${r.message}`, redirect: `${BASE}/pagamentos?pedido=${o.id}` };
  });
}

// ───────────────────────────── Banco (Tela 57)

export async function simulateCreditsAction(_fd: FormData) {
  return runAction(opts("/banco", "/monitor"), async (s) => {
    await guard(s);
    requireAnyEcom(s, ["ecommerce.finance"]);
    const n = await simulateCredits(s.ctx);
    return { ok: true as const, message: n ? `${n} crédito(s) simulado(s) no prazo do meio de pagamento.` : "Nenhum crédito previsto até hoje." };
  });
}

export async function reconcileAction(txId: string, fd: FormData) {
  return runAction({ ...opts("/banco", "/monitor"), revalidate: [`${BASE}/banco`, `${BASE}/monitor`, "/financeiro/receber"] }, async (s) => {
    await guard(s);
    const accountId = fstr(fd, "accountId");
    if (!accountId) throw new BusinessError("Escolha a conta que recebeu o crédito.");
    const tx = await reconcileTransaction(s.ctx, txId, accountId);
    return { ok: true as const, message: tx?.status === "reconciled" ? "Recebível conciliado na conta." : "Parcelas creditadas conciliadas; as futuras ficam para os próximos créditos." };
  });
}

export async function setSettlementAccountAction(fd: FormData) {
  return runAction(opts("/banco"), async (s) => {
    await guard(s);
    await setSettlementAccount(s.ctx, fstr(fd, "accountId"));
    return { ok: true as const, message: "Conta dos créditos da loja definida." };
  });
}

export async function preparePayoutAction(fd: FormData) {
  return runAction(opts("/banco"), async (s) => {
    await guard(s);
    await preparePayout(s.ctx, { amount: fint(fd, "amount"), notes: fopt(fd, "notes"), idemKey: fstr(fd, "_idem") || String(Date.now()) });
    return { ok: true as const, message: "Repasse preparado em rascunho: nenhum valor foi movimentado." };
  });
}

// ───────────────────────────── Frete (Tela 58)

export async function saveShippingAction(fd: FormData) {
  return runAction(opts("/frete", "/editor"), async (s) => {
    await guard(s);
    const st = await requireStore(s.ctx);
    const cur = shippingOf(st);
    const zones = fjson<OwnZone[]>(fd, "zones", []);
    await saveShipping(s.ctx, {
      originZip: fstr(fd, "originZip"),
      handlingDays: fint(fd, "handlingDays", cur.handlingDays),
      freeShippingMin: fint(fd, "freeShippingMin"),
      freeShippingModes: fd.getAll("freeShippingModes").map(String) as DeliveryMode[],
      modes: {
        pickup: { enabled: fbool(fd, "pickup"), readyHours: fint(fd, "readyHours", cur.modes.pickup.readyHours), instructions: fstr(fd, "pickupInstructions") || cur.modes.pickup.instructions },
        own: { enabled: fbool(fd, "own"), zones },
        third_party: { enabled: fbool(fd, "third_party"), provider: cur.modes.third_party.provider, label: fstr(fd, "thirdPartyLabel") || cur.modes.third_party.label, maxDistanceKm: fint(fd, "maxDistanceKm", cur.modes.third_party.maxDistanceKm) },
        carrier: { enabled: fbool(fd, "carrier"), provider: cur.modes.carrier.provider },
      },
      package: { weightGrams: fint(fd, "pkgWeight", cur.package.weightGrams), heightCm: fint(fd, "pkgHeight", cur.package.heightCm), widthCm: fint(fd, "pkgWidth", cur.package.widthCm), lengthCm: fint(fd, "pkgLength", cur.package.lengthCm) },
      pickupBranchIds: fd.getAll("pickupBranchIds").map(String).filter(Boolean),
      fulfillmentBranchId: fstr(fd, "fulfillmentBranchId"),
    });
    return { ok: true as const, message: "Regras de entrega salvas: o carrinho e o checkout já usam as novas opções." };
  });
}

export async function sampleQuoteAction(fd: FormData) {
  return runAction<{ options: Array<{ id: string; label: string; detail: string; price: number; free: boolean; simulated: boolean }>; problems: string[] }>({ module: "sales" }, async (s) => {
    await guard(s);
    const st = await requireStore(s.ctx);
    const value = fint(fd, "value", 15000);
    const weight = fint(fd, "weight", 800);
    // pacote demonstrativo (Tela 58): produto fictício com o peso informado
    const fake = await deliveryOptionsForSample(s, st, fstr(fd, "zip"), value, weight);
    return { ok: true as const, data: fake };
  });
}

async function deliveryOptionsForSample(s: SessionInfo, st: any, zip: string, value: number, weight: number) {
  const tmp = { ...st, shipping: { ...(st.shipping ?? {}), package: { ...(st.shipping?.package ?? {}), weightGrams: weight } } };
  const res = await deliveryOptions(s.ctx.store, tmp, { zip, lines: [{ skuId: "amostra", productId: "amostra", qty: QTY, unitPrice: value }], goodsAfterDiscount: value });
  return { options: res.options.map((o) => ({ id: o.id, label: o.label, detail: o.detail, price: o.price, free: o.free, simulated: o.simulated })), problems: res.problems };
}

// ───────────────────────────── Monitor (Tela 60)

export async function reprocessEventAction(id: string, _fd: FormData) {
  return runAction(opts("/monitor", "/catalogo", "/pedidos"), async (s) => {
    await guard(s);
    const r = await reprocessEvent(s.ctx, id);
    return { ok: true as const, message: `Reprocessado (${r.status === "ok" ? "concluído" : r.status === "failed" ? "ainda com falha" : r.status === "pending" ? "pendente" : "ignorado"}): ${r.message}` };
  });
}

export async function dismissEventAction(id: string, fd: FormData) {
  return runAction(opts("/monitor"), async (s) => {
    await guard(s);
    await dismissEvent(s.ctx, id, fstr(fd, "reason"));
    return { ok: true as const, message: "Evento marcado como ignorado." };
  });
}

