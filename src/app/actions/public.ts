"use server";

import { getStore } from "@/lib/db";
import { nextNumber } from "@/lib/core/numbering";
import type { ActionResult } from "@/lib/server/action";

/** Chamado aberto sem login (ex.: problema de acesso). Persistido internamente com empresa "public". */
export async function publicTicketAction(fd: FormData): Promise<ActionResult<{ number: number }>> {
  const name = String(fd.get("name") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim();
  const message = String(fd.get("message") ?? "").trim();
  if (!name || !email || message.length < 10) return { ok: false, error: "Preencha nome, e-mail e uma descrição (mín. 10 caracteres)." };
  const store = getStore();
  const number = await nextNumber(store, "ticket:public");
  const t = await store.create("tickets", { companyId: "public", number, category: "acesso", priority: "normal", subject: `Acesso — ${name}`, status: "open", context: { name, email, origin: "login" }, lastMessageAt: new Date().toISOString() });
  await store.create("ticket_messages", { companyId: "public", ticketId: t.id, userName: `${name} <${email}>`, body: message, internal: false });
  return { ok: true, data: { number } };
}
