import crypto from "node:crypto";
import { listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { unscoped } from "@/lib/db/scoped-store";
import { storeByDomain } from "./domains";

/**
 * Resolução da loja na vitrine pública (Telas 61–64): pelo endereço no ERP (/loja/<endereço>) ou pelo domínio próprio
 * verificado (o middleware reescreve o host para /loja/~<host>). A vitrine só lê dados da empresa dona da loja.
 */

export const previewCookieName = (storeId: string) => `ic_prev_${storeId.slice(0, 16)}`;
export const cartCookieName = (storeId: string) => `ic_cart_${storeId.slice(0, 16)}`;

export interface ResolvedStore {
  st: Doc;
  /** prefixo dos links: "" no domínio próprio, "/loja/<endereço>" no endereço do ERP */
  basePath: string;
  viaDomain: boolean;
}

/** `ref` = endereço da loja ou "~host" (domínio próprio). */
export async function resolveStore(store: Store, ref: string): Promise<ResolvedStore | null> {
  const r = decodeURIComponent(String(ref ?? ""));
  if (r.startsWith("~")) {
    const st = await storeByDomain(store, r.slice(1));
    return st ? { st, basePath: "", viaDomain: true } : null;
  }
  if (!/^[a-z0-9-]{1,80}$/.test(r)) return null;
  const st = (await listAll(unscoped(store), "stores", { filters: [["eq", "slug", r]] }))[0];
  return st ? { st, basePath: `/loja/${st.slug}`, viaDomain: false } : null;
}

export type StoreAccess = "open" | "preview" | "paused" | "closed";

/** Loja publicada abre para todos; rascunho/pausa só com a prévia do ERP (cookie com o token da loja). */
export function storeAccess(st: Doc, previewToken: string | null | undefined): StoreAccess {
  const preview = Boolean(previewToken && st.previewToken && previewToken.length === st.previewToken.length && crypto.timingSafeEqual(Buffer.from(previewToken), Buffer.from(st.previewToken)));
  if (st.status === "published") return "open";
  if (preview) return "preview";
  return st.status === "paused" ? "paused" : "closed";
}
