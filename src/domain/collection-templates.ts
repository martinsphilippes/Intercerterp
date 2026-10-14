/**
 * Modelos de mensagem de cobrança pelo WhatsApp (PLA-27) — parte pura (sem banco), usada no servidor e nas telas.
 * Os modelos ficam no parâmetro `collection.whatsappTemplates` (empresa; filial pode substituir), com padrão embutido.
 * Variáveis entre chaves; linha que usa variável sem valor (ex.: {link_pix} sem chave Pix configurada) é omitida.
 */

export type CollectionTemplateKind = "reminder" | "overdue" | "renegotiation";

export const COLLECTION_TEMPLATE_KINDS: Array<{ key: CollectionTemplateKind; label: string; hint: string }> = [
  { key: "reminder", label: "Lembrete antes do vencimento", hint: "Para parcelas a vencer (ou vencendo hoje)." },
  { key: "overdue", label: "Parcela vencida", hint: "Para parcelas em atraso; o valor já inclui multa e juros sugeridos." },
  { key: "renegotiation", label: "Proposta de renegociação", hint: "Convite para negociar um atraso maior." },
];

export const COLLECTION_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "cliente", label: "Nome do cliente" },
  { key: "valor", label: "Valor da parcela (atualizado com multa e juros quando vencida)" },
  { key: "vencimento", label: "Data de vencimento" },
  { key: "dias_atraso", label: "Dias em atraso (0 se a vencer)" },
  { key: "empresa", label: "Nome da empresa" },
  { key: "link_pix", label: "Link ou chave Pix para pagamento (linha omitida se não houver)" },
  { key: "parcela", label: "Número da parcela (ex.: 2/3)" },
  { key: "documento", label: "Documento / venda de origem" },
];

export const COLLECTION_TEMPLATES_KEY = "collection.whatsappTemplates";
export const MAX_TEMPLATE_LENGTH = 1000;

export interface CollectionTemplates {
  reminder: string;
  overdue: string;
  renegotiation: string;
  /** link de pagamento ou chave Pix usado em {link_pix}; vazio = chave Pix da conta financeira, se houver */
  pixLink: string;
}

export const DEFAULT_COLLECTION_TEMPLATES: CollectionTemplates = {
  reminder:
    "Olá, {cliente}! Passando para lembrar que a parcela {parcela} ({documento}), no valor de {valor}, vence em {vencimento}.\nPara pagar pelo Pix: {link_pix}\nQualquer dúvida, é só responder esta mensagem.\n{empresa}",
  overdue:
    "Olá, {cliente}. Consta em aberto a parcela {parcela} ({documento}), vencida em {vencimento} — {dias_atraso} dia(s) de atraso. Valor atualizado com multa e juros: {valor}.\nPara pagar pelo Pix: {link_pix}\nSe o pagamento já foi feito, por favor desconsidere.\n{empresa}",
  renegotiation:
    "Olá, {cliente}. A parcela {parcela} ({documento}), vencida em {vencimento}, está em aberto há {dias_atraso} dia(s) (valor atualizado: {valor}). Sabemos que imprevistos acontecem: podemos combinar uma renegociação que caiba no seu orçamento. Responda esta mensagem para conversarmos.\n{empresa}",
  pixLink: "",
};

/** Valor salvo (parcial ou antigo) completado com os padrões. */
export function withTemplateDefaults(saved: Partial<CollectionTemplates> | null | undefined): CollectionTemplates {
  const out = { ...DEFAULT_COLLECTION_TEMPLATES };
  for (const k of ["reminder", "overdue", "renegotiation", "pixLink"] as const) {
    const v = saved?.[k];
    if (typeof v === "string" && (k === "pixLink" || v.trim())) out[k] = v;
  }
  return out;
}

const VAR_RE = /\{([a-z_]+)\}/g;

/**
 * Substitui as variáveis conhecidas. Uma linha que referencia variável conhecida SEM valor é removida inteira
 * (ex.: "Para pagar pelo Pix: {link_pix}" some quando não há chave). Variáveis desconhecidas ficam como estão.
 */
export function renderCollectionTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  const known = new Set(COLLECTION_VARIABLES.map((v) => v.key));
  const value = (k: string) => {
    const v = vars[k];
    return v == null ? "" : String(v).trim();
  };
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const refs = [...line.matchAll(VAR_RE)].map((m) => m[1]).filter((k) => known.has(k));
    if (refs.some((k) => value(k) === "")) continue;
    out.push(line.replace(VAR_RE, (m, k: string) => (known.has(k) ? value(k) : m)));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Modelo sugerido para a parcela: vencida → "overdue"; a vencer/vence hoje → "reminder". */
export function suggestedTemplate(dueDate: string, ref: string): CollectionTemplateKind {
  return dueDate < ref ? "overdue" : "reminder";
}
