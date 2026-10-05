import { getStore } from "../db";
import { getIntegration, logIntegration } from "@/domain/integrations";

/**
 * Envio de e-mail pelo canal configurado (Integrações → E-mail).
 * Retorna se foi efetivamente entregue ao provedor — nunca presume envio.
 */
export async function sendEmail(
  companyId: string | null,
  msg: { to: string; subject: string; html: string; attachments?: Array<{ filename: string; content: Buffer }> },
): Promise<{ delivered: boolean; channel: string; message?: string }> {
  const store = getStore();
  const integ = companyId ? await getIntegration(store, companyId, null, "email") : null;
  if (!integ) return { delivered: false, channel: "not_configured", message: "Canal de e-mail não configurado." };
  try {
    if (integ.provider === "resend") {
      const key = process.env[integ.secretRefs?.apiKey ?? "RESEND_API_KEY"];
      if (!key) return { delivered: false, channel: "resend", message: "Credencial do Resend ausente." };
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: integ.config?.from ?? "Intercert ERP <onboarding@resend.dev>",
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })),
        }),
        signal: AbortSignal.timeout(20000),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${body}`);
      await logIntegration(store, { companyId: companyId!, integrationId: integ.id, kind: "email", action: "send", status: "success", message: `E-mail para ${msg.to}: ${msg.subject}` });
      return { delivered: true, channel: "resend" };
    }
    if (integ.provider === "appwrite_messaging") {
      const { Client, Messaging, ID, Users, Query } = await import("node-appwrite");
      const { appwriteConfig } = await import("../db");
      const c = appwriteConfig();
      const client = new Client().setEndpoint(c.endpoint).setProject(c.projectId).setKey(c.apiKey);
      const users = await new Users(client).list({ queries: [Query.equal("email", msg.to)] });
      const target = users.users[0]?.targets?.find((t: any) => t.providerType === "email");
      if (!target) throw new Error("Destinatário sem alvo de e-mail no Appwrite (apenas usuários do sistema).");
      await new Messaging(client).createEmail({ messageId: ID.unique(), subject: msg.subject, content: msg.html, targets: [target.$id], html: true });
      await logIntegration(store, { companyId: companyId!, integrationId: integ.id, kind: "email", action: "send", status: "success", message: `E-mail para ${msg.to} enfileirado no Appwrite Messaging` });
      return { delivered: true, channel: "appwrite_messaging" };
    }
    return { delivered: false, channel: integ.provider, message: "Provedor de e-mail não suportado." };
  } catch (e: any) {
    await logIntegration(store, { companyId: companyId!, integrationId: integ.id, kind: "email", action: "send", status: "failure", message: e.message });
    return { delivered: false, channel: integ.provider, message: e.message };
  }
}
