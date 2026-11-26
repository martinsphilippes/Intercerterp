"use server";

import { getStore, configuredBackend } from "@/lib/db";
import { timingSafeEqual } from "node:crypto";
import { isEmptyInstallation } from "@/lib/server/bootstrap";
import { getAuth } from "@/lib/auth/provider";
import { createCompanyWithDefaults } from "@/domain/setup";
import { onlyDigits, isValidCnpj } from "@/lib/core/text";
import type { ActionResult } from "@/lib/server/action";

function checkSetupToken(fd: FormData): string | null {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) {
    // Em produção com banco real a instalação exige token (evita que um visitante crie o administrador)
    return process.env.NODE_ENV === "production" && configuredBackend() === "postgres" ? "Defina a variável SETUP_TOKEN no servidor para concluir a instalação." : null;
  }
  const got = Buffer.from(String(fd.get("setupToken") ?? ""));
  const exp = Buffer.from(expected);
  return got.length === exp.length && timingSafeEqual(got, exp) ? null : "Token de instalação inválido (variável SETUP_TOKEN do servidor).";
}

async function emptyOrError(): Promise<string | null> {
  try {
    return (await isEmptyInstallation()) ? null : "A instalação já foi inicializada.";
  } catch (e: any) {
    return `Banco de dados indisponível: ${e?.message ?? e}`;
  }
}

/** Instalação inicial: somente quando ainda não existe nenhum usuário. */
export async function setupInstallationAction(fd: FormData): Promise<ActionResult> {
  const closed = await emptyOrError();
  if (closed) return { ok: false, error: closed };
  const bad = checkSetupToken(fd);
  if (bad) return { ok: false, error: bad };
  const store = getStore();
  const mode = String(fd.get("mode") ?? "company");
  if (mode === "demo") {
    const { seedDemo } = await import("@/domain/seed");
    await seedDemo(store, { historyDays: Number(process.env.DEMO_HISTORY_DAYS ?? 14) });
    const pwd = process.env.DEMO_PASSWORD ? "a senha definida em DEMO_PASSWORD" : "Intercert@2026";
    return { ok: true, message: `Demonstração carregada. Entre com admin / ${pwd}.`, redirect: "/login" };
  }
  const name = String(fd.get("companyName") ?? "").trim();
  const cnpj = onlyDigits(String(fd.get("cnpj") ?? ""));
  const adminName = String(fd.get("adminName") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!name || !adminName || !email) return { ok: false, error: "Preencha empresa, nome e e-mail do administrador." };
  if (cnpj && !isValidCnpj(cnpj)) return { ok: false, error: "CNPJ inválido." };
  if (password.length < 8) return { ok: false, error: "A senha deve ter ao menos 8 caracteres." };
  const { company } = await createCompanyWithDefaults(store, {
    name, cnpj, regime: String(fd.get("regime") ?? "simples"), uf: String(fd.get("uf") ?? ""), cityName: String(fd.get("city") ?? ""), cityCode: String(fd.get("cityCode") ?? ""),
  });
  const { findOne } = await import("@/lib/db");
  // reaproveita a linha de uma tentativa anterior sem credencial (mesmo e-mail)
  const prev = await findOne(store, "users", [["eq", "email", email]]);
  const user = prev && !prev.authId ? prev : await store.create("users", { name: adminName, email, login: email.split("@")[0], status: "active", isAdmin: true, companyIds: [company.id], branchIds: [], firstAccessAt: new Date().toISOString() });
  try {
    const authId = await getAuth().createUser(email, password, adminName);
    await store.update("users", user.id, { authId, companyIds: [company.id] });
  } catch (e: any) {
    if (!prev) await store.delete("users", user.id).catch(() => undefined);
    return { ok: false, error: `Não foi possível criar a credencial do administrador: ${e?.message ?? e}` };
  }
  return { ok: true, message: "Instalação concluída. Entre com o e-mail e a senha cadastrados.", redirect: "/login" };
}
