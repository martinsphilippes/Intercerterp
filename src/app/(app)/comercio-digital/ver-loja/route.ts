import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/session";
import { canDo } from "@/lib/permissions";
import { isFeatureOn, featureDefaultFor } from "@/lib/core/settings";
import { storeOfCompany } from "@/domain/ecommerce/common";
import { primaryDomainOf } from "@/domain/ecommerce/store";
import { previewCookieName } from "@/domain/ecommerce/storefront";

/**
 * "Ver loja pública" / "Ver prévia da loja": loja publicada abre no endereço público (domínio próprio ativo ou
 * /loja/<endereço>); em rascunho ou pausada, grava o cookie de prévia (só para quem está logado no ERP com acesso ao
 * comércio digital) e abre a vitrine com a faixa "Prévia".
 */
export async function GET(req: Request) {
  const s = await requireApiSession("text");
  if (s instanceof NextResponse) return s;
  const allowed = ["ecommerce.manage", "ecommerce.catalog", "ecommerce.orders", "ecommerce.marketing"].some((a) => canDo(s.user, a as any));
  if (!allowed || !(await isFeatureOn(s.ctx.store, s.ctx.companyId, s.ctx.branchId, "comercioDigital", featureDefaultFor("comercioDigital", s.company.kind)))) return new NextResponse("Sem acesso ao comércio digital.", { status: 403 });
  const st = await storeOfCompany(s.ctx.store, s.ctx.companyId);
  const origin = new URL(req.url).origin;
  if (!st) return NextResponse.redirect(new URL("/comercio-digital", origin));
  if (st.status === "published") {
    const domain = await primaryDomainOf(s.ctx.store, st.id);
    return NextResponse.redirect(domain ? `https://${domain}` : new URL(`/loja/${st.slug}`, origin));
  }
  const res = NextResponse.redirect(new URL(`/loja/${st.slug}`, origin));
  res.cookies.set(previewCookieName(st.id), st.previewToken, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https"), path: `/loja/${st.slug}`, maxAge: 8 * 3600 });
  return res;
}
