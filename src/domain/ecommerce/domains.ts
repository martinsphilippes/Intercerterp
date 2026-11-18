import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { BusinessError, assert } from "@/lib/core/errors";
import { requireAction, type Ctx } from "@/lib/core/ctx";
import { audit } from "@/lib/core/audit";
import { nowIso } from "@/lib/dates";
import { commerceEvent, randomToken, requireStore } from "./common";
import { domainsFor, dnsTargets } from "./providers";

/**
 * Domínio próprio da loja (Tela 51). Um domínio pertence a uma única loja (índice único global); a loja pode ter
 * vários (ex.: com e sem "www"), um deles principal. O domínio só passa a abrir a loja depois de verificado: até lá a
 * vitrine segue no endereço do ERP (/loja/<endereço>).
 */

export type DomainStatus = "pending_dns" | "active" | "misconfigured" | "error";

export const DOMAIN_STATUS_LABEL: Record<DomainStatus, string> = {
  pending_dns: "DNS pendente",
  active: "Ativo",
  misconfigured: "Apontamento incorreto",
  error: "Falha na verificação",
};

/** Hosts que nunca podem ser domínio de loja (endereços do próprio ERP e da hospedagem). */
function reservedHost(host: string) {
  const own = [process.env.APP_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]
    .map((u) => String(u ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase())
    .filter(Boolean);
  return own.includes(host) || /(^|\.)vercel\.app$|(^|\.)vercel\.com$|(^|\.)localhost$|^\d+\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * Normaliza e valida o domínio informado (Tela 51: "Informe somente o domínio, sem https://"). Devolve o domínio em
 * minúsculas sem ponto final, ou lança a mensagem do problema.
 */
export function normalizeDomain(raw: string): string {
  let d = String(raw ?? "").trim().toLowerCase();
  assert(d, "Informe o domínio da loja (ex.: www.minhaloja.com.br).", "invalid_domain");
  assert(!/^[a-z]+:\/\//.test(d), "Informe somente o domínio, sem https://.", "invalid_domain");
  assert(!/[/?#@:\s]/.test(d), "Informe somente o domínio, sem caminho, porta ou espaços (ex.: www.minhaloja.com.br).", "invalid_domain");
  d = d.replace(/\.$/, "");
  assert(d.length <= 253, "Domínio longo demais.", "invalid_domain");
  const labels = d.split(".");
  assert(labels.length >= 2, "Domínio incompleto: inclua a terminação (ex.: minhaloja.com.br).", "invalid_domain");
  for (const l of labels) assert(/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(l), `Parte inválida no domínio: "${l}". Use letras, números e hífen (sem acentos — domínios acentuados devem ser informados no formato xn--).`, "invalid_domain");
  assert(/^[a-z]{2,63}$|^xn--[a-z0-9-]+$/.test(labels[labels.length - 1]), "Terminação do domínio inválida.", "invalid_domain");
  assert(!reservedHost(d), "Este endereço é do próprio sistema ou da hospedagem e não pode ser usado como domínio da loja.", "invalid_domain");
  return d;
}

export async function listDomains(store: Store, storeId: string) {
  const rows = await listAll(unscoped(store), "store_domains", { filters: [["eq", "storeId", storeId]] });
  return rows.sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)) || String(a.domain).localeCompare(String(b.domain)));
}

/**
 * Cadastra o domínio na loja (formato + cadastro na hospedagem, quando houver integração) e já confere o DNS.
 * O mesmo domínio pode estar pendente em outra loja: só a loja que comprovar o controle (TXT com o código dela) ativa.
 */
export async function addDomain(ctx: Ctx, raw: string): Promise<Doc> {
  requireAction(ctx, "ecommerce.manage");
  const st = await requireStore(ctx);
  const domain = normalizeDomain(raw);
  const base = unscoped(ctx.store);
  const same = await listAll(base, "store_domains", { filters: [["eq", "domain", domain]] });
  const own = same.find((d) => d.storeId === st.id);
  if (own) return own;
  if (same.some((d) => d.status === "active")) throw new BusinessError("Este domínio já está verificado e em uso por outra loja.", "domain_taken");
  const mine = await listDomains(ctx.store, st.id);
  assert(mine.length < 5, "Limite de 5 domínios por loja.");
  const provider = await domainsFor(ctx.store, ctx.companyId);
  const reg = await provider.register(domain);
  let doc: Doc;
  try {
    doc = await base.create(
      "store_domains",
      {
        companyId: ctx.companyId,
        branchId: null,
        createdBy: ctx.user.id,
        storeId: st.id,
        domain,
        primary: mine.length === 0,
        status: "pending_dns",
        provider: provider.id,
        lastCheckAt: null,
        verifiedAt: null,
        diagnostic: reg.message.slice(0, 500),
        dns: { records: [], verifyToken: randomToken(12) },
      },
      detId("sdomain", st.id, domain),
    );
  } catch (e) {
    if (isConflict(e)) {
      const again = await base.get("store_domains", detId("sdomain", st.id, domain));
      if (again) return again;
    }
    throw e;
  }
  await commerceEvent(ctx.store, { companyId: ctx.companyId, storeId: st.id, area: "domain", action: "domain.add", status: reg.ok ? "ok" : "failed", reference: domain, diagnostic: reg.message, subject: `domain:${doc.id}` });
  await audit(ctx, { module: "sales", action: "ecommerce.domain_add", entityType: "store_domain", entityId: doc.id, summary: `Domínio ${domain} cadastrado na loja`, related: [`store:${st.id}`] });
  return verifyDomain(ctx, doc.id);
}

/** Confere apontamento e código de verificação (e, com a API da hospedagem, o cadastro no projeto). */
export async function verifyDomain(ctx: Ctx, domainId: string): Promise<Doc> {
  requireAction(ctx, "ecommerce.manage");
  const st = await requireStore(ctx);
  const base = unscoped(ctx.store);
  const d = await base.getOrThrow("store_domains", domainId);
  assert(d.storeId === st.id, "Domínio de outra loja.");
  const token = String(d.dns?.verifyToken ?? "");
  const provider = await domainsFor(ctx.store, ctx.companyId);
  let res = await provider.check(d.domain, token);
  if (res.status === "active") {
    // outra loja já comprovou o mesmo domínio: só pode haver um dono ativo
    const other = (await listAll(base, "store_domains", { filters: [["eq", "domain", d.domain]] })).find((x) => x.id !== d.id && x.status === "active");
    if (other) res = { ...res, status: "error", diagnostic: "Este domínio já está verificado por outra loja." };
  }
  const after = await base.update("store_domains", d.id, {
    status: res.status,
    diagnostic: res.diagnostic.slice(0, 500),
    dns: { ...(d.dns ?? {}), records: res.records },
    lastCheckAt: nowIso(),
    verifiedAt: res.status === "active" ? (d.verifiedAt ?? nowIso()) : (d.verifiedAt ?? null),
    provider: provider.id,
  });
  await commerceEvent(ctx.store, {
    companyId: ctx.companyId,
    storeId: st.id,
    area: "domain",
    action: "domain.check",
    status: res.status === "active" ? "ok" : res.status === "pending_dns" ? "pending" : "failed",
    reference: d.domain,
    diagnostic: res.diagnostic,
    subject: `domain:${d.id}`,
  });
  return after;
}

export async function setPrimaryDomain(ctx: Ctx, domainId: string) {
  requireAction(ctx, "ecommerce.manage");
  const st = await requireStore(ctx);
  const base = unscoped(ctx.store);
  const all = await listDomains(ctx.store, st.id);
  const target = all.find((d) => d.id === domainId);
  assert(target, "Domínio não encontrado nesta loja.");
  for (const d of all) if (Boolean(d.primary) !== (d.id === domainId)) await base.update("store_domains", d.id, { primary: d.id === domainId });
  await audit(ctx, { module: "sales", action: "ecommerce.domain_primary", entityType: "store_domain", entityId: domainId, summary: `Domínio principal da loja: ${target!.domain}`, related: [`store:${st.id}`] });
}

export async function removeDomain(ctx: Ctx, domainId: string, reason: string) {
  requireAction(ctx, "ecommerce.manage");
  const st = await requireStore(ctx);
  assert(reason.trim(), "Informe o motivo da remoção do domínio.");
  const base = unscoped(ctx.store);
  const d = await base.getOrThrow("store_domains", domainId);
  assert(d.storeId === st.id, "Domínio de outra loja.");
  await base.delete("store_domains", d.id);
  if (d.primary) {
    const rest = await listDomains(ctx.store, st.id);
    if (rest[0]) await base.update("store_domains", rest[0].id, { primary: true });
  }
  await audit(ctx, { module: "sales", action: "ecommerce.domain_remove", entityType: "store_domain", entityId: d.id, summary: `Domínio ${d.domain} removido da loja`, reason, related: [`store:${st.id}`] });
}

/** Loja aberta por um domínio próprio verificado (null quando o domínio não é de loja ou ainda não foi verificado). */
export async function storeByDomain(store: Store, host: string): Promise<Doc | null> {
  const h = String(host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!h) return null;
  const d = (await listAll(unscoped(store), "store_domains", { filters: [["eq", "domain", h]] })).find((x) => x.status === "active");
  if (!d) return null;
  return unscoped(store).get("stores", d.storeId);
}

export { dnsTargets };
