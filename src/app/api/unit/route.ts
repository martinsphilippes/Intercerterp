import { NextResponse, type NextRequest } from "next/server";
import { getSession, UNIT_COOKIE } from "@/lib/server/session";
import { getStore } from "@/lib/db";
import { accessibleUnits, branchScopeOf } from "@/lib/auth/users";

/** Define a unidade ativa (usado na seleção automática quando há uma única opção). */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL("/login", req.url));
  // troca de empresa só a partir do próprio ERP (um link de outro site não muda o contexto de quem acessa várias empresas)
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return NextResponse.redirect(new URL("/selecionar-unidade", req.url));
  const c = req.nextUrl.searchParams.get("c") ?? "";
  const b = req.nextUrl.searchParams.get("b") ?? "";
  const userDoc = await getStore().get("users", s.user.id);
  const { companies, branches } = await accessibleUnits(getStore(), userDoc!);
  const canAll = branchScopeOf(userDoc, c) === null;
  const ok = companies.some((x) => x.id === c) && ((b === "all" && canAll) || branches.some((x) => x.id === b && x.companyId === c));
  const res = NextResponse.redirect(new URL(ok ? "/dashboard" : "/selecionar-unidade", req.url));
  if (ok) res.cookies.set(UNIT_COOKIE, `${c}:${b}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 31536000 });
  return res;
}
