/** Opções do registro de contato de renovação (§45) — sem dependências de servidor: usadas também nos formulários. */

export const CONTACT_CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "Telefone" },
  { value: "email", label: "E-mail" },
  { value: "in_person", label: "Presencial" },
  { value: "other", label: "Outro" },
] as const;
export const CONTACT_RESULTS = [
  { value: "will_renew", label: "Vai renovar" },
  { value: "thinking", label: "Vai pensar / retornar" },
  { value: "no_answer", label: "Não atendeu" },
  { value: "renewed_elsewhere", label: "Renovou em outro lugar" },
  { value: "not_interested", label: "Não tem interesse" },
  { value: "other", label: "Outro" },
] as const;
export const CONTACT_CHANNEL_LABEL: Record<string, string> = Object.fromEntries(CONTACT_CHANNELS.map((c) => [c.value, c.label]));
export const CONTACT_RESULT_LABEL: Record<string, string> = Object.fromEntries(CONTACT_RESULTS.map((c) => [c.value, c.label]));
