import { getStore } from "../db";
import { getIntegration, logIntegration } from "@/domain/integrations";

/**
 * Envio de e-mail pelo canal configurado (Integrações → E-mail).
 * Retorna se foi efetivamente entregue ao provedor — nunca presume envio. Integração gravada com um provedor desligado
 * (ex.: o antigo Appwrite Messaging) vale como canal não configurado (`getIntegration`).
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
      // vínculo removido ("Remover vínculo"): sem recorrer ao nome padrão da variável
      const ref = integ.secretRefs ? integ.secretRefs.apiKey : "RESEND_API_KEY";
      const key = ref ? process.env[ref] : undefined;
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
    return { delivered: false, channel: integ.provider, message: "Provedor de e-mail não suportado." };
  } catch (e: any) {
    await logIntegration(store, { companyId: companyId!, integrationId: integ.id, kind: "email", action: "send", status: "failure", message: e.message });
    return { delivered: false, channel: integ.provider, message: e.message };
  }
}
