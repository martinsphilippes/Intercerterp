"use server";

import { getStore } from "@/lib/db";
import { isEmptyInstallation } from "@/lib/server/bootstrap";
import { getAuth } from "@/lib/auth/provider";
import { createCompanyWithDefaults } from "@/domain/setup";
import { onlyDigits, isValidCnpj } from "@/lib/core/text";
import type { ActionResult } from "@/lib/server/action";

/** Instalação inicial: somente quando ainda não existe nenhum usuário. */
export async function setupInstallationAction(fd: FormData): Promise<ActionResult> {
  if (!(await isEmptyInstallation())) return { ok: false, error: "A instalação já foi inicializada." };
  const store = getStore();
  const mode = String(fd.get("mode") ?? "company");
  if (mode === "demo") {
    const { seedDemo } = await import("@/domain/seed");
    await seedDemo(store, { historyDays: 45 });
    return { ok: true, message: "Demonstração carregada. Entre com admin / Intercert@2026.", redirect: "/login" };
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
  const user = await store.create("users", { name: adminName, email, login: email.split("@")[0], status: "active", isAdmin: true, companyIds: [company.id], branchIds: [], firstAccessAt: new Date().toISOString() });
  const authId = await getAuth().createUser(email, password, adminName);
  await store.update("users", user.id, { authId });
  return { ok: true, message: "Instalação concluída. Entre com o e-mail e a senha cadastrados.", redirect: "/login" };
}
