import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { ensureBootstrap } from "@/lib/server/bootstrap";
import { featureDefaultFor, isFeatureOn } from "@/lib/core/settings";
import { cartCookieName, previewCookieName, resolveStore, storeAccess, type StoreAccess } from "@/domain/ecommerce/storefront";
import { themeOf } from "@/domain/ecommerce/store";
import { onAccent } from "@/domain/ecommerce/templates";

export interface StoreRequest {
  store: Store;
  st: Doc;
  basePath: string;
  viaDomain: boolean;
  access: StoreAccess;
  cartToken: string | null;
  accent: string;
  onAccent: string;
}

/** Loja da requisição (endereço /loja/<endereço> ou domínio próprio), com acesso e carrinho — uma leitura por requisição. */
export const loadStore = cache(async (ref: string): Promise<StoreRequest | null> => {
  await ensureBootstrap();
  const store = getStore();
  const r = await resolveStore(store, ref);
  if (!r) return null;
  const company = await store.get("companies", r.st.companyId);
  // empresa inativa ou suspensa pelo contrato: a vitrine sai do ar (pedidos e histórico preservados)
  if (!company || company.status === "inactive" || company.status === "suspended") return null;
  // comércio digital desligado na empresa: a vitrine sai do ar junto
  if (!(await isFeatureOn(store, r.st.companyId, null, "comercioDigital", featureDefaultFor("comercioDigital", company.kind)))) return null;
  const jar = await cookies();
  const access = storeAccess(r.st, jar.get(previewCookieName(r.st.id))?.value);
  const raw = jar.get(cartCookieName(r.st.id))?.value ?? null;
  const theme = themeOf(r.st);
  return { store, st: r.st, basePath: r.basePath, viaDomain: r.viaDomain, access, cartToken: raw && /^[0-9a-f]{32}$/.test(raw) ? raw : null, accent: theme.accentColor, onAccent: onAccent(theme.accentColor) };
});

/** Exige loja visível (publicada, ou em prévia pelo ERP). Pausada só mostra o aviso da pausa (no layout). */
export async function requireStore(ref: string): Promise<StoreRequest> {
  const s = await loadStore(ref);
  if (!s || s.access === "closed") notFound();
  return s;
}

/** IP do cliente (limite de pedidos não pagos por acesso). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

export const money = (c: number | null | undefined) => ((c ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
