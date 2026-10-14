/**
 * Link de conversa do WhatsApp (wa.me) com texto pronto — sem API paga: o envio é feito pelo próprio operador no
 * aplicativo dele. Puro (usado em telas cliente e servidor).
 */

/** Número no formato internacional exigido pelo wa.me (somente dígitos, com DDI 55 quando ausente); null se inválido. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.length <= 11 ? `55${digits}` : digits;
}

/** URL `https://wa.me/<número>?text=<mensagem codificada>`; null quando o telefone não serve. */
export function whatsappUrl(phone: string | null | undefined, text: string): string | null {
  const n = whatsappNumber(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}
