/** Rótulos e links compartilhados pelas telas fiscais (seguro para componentes cliente). */

export const MODEL_LABEL: Record<string, string> = { nfe: "NF-e", nfce: "NFC-e", nfse: "NFS-e" };

export const ORIGIN_LABEL: Record<string, string> = {
  sale: "Venda",
  transfer: "Transferência",
  purchase_order: "Devolução a fornecedor",
  return: "Devolução de venda",
  manual: "Avulsa",
  service: "Serviço",
  disable: "Inutilização",
};

export function originHref(type?: string | null, id?: string | null): string | null {
  if (!type || !id) return null;
  switch (type) {
    case "sale":
      return `/vendas/${id}`;
    case "transfer":
      return `/estoque/transferencias/${id}`;
    case "purchase_order":
      return `/compras/pedidos/${id}`;
    case "return":
      return `/vendas/devolucoes/${id}`;
    case "service":
      return `/produtos/${id}`;
    default:
      return null;
  }
}

export function partyHref(type?: string | null, id?: string | null): string | null {
  if (!type || !id) return null;
  if (type === "customer") return `/clientes/${id}`;
  if (type === "supplier") return `/fornecedores/${id}`;
  return null;
}

export const STATUS_OPTIONS = [
  { value: "draft", label: "Rascunho" },
  { value: "pending", label: "Pendente de cadastro/configuração" },
  { value: "queued", label: "Na fila" },
  { value: "processing", label: "Processando" },
  { value: "authorized", label: "Autorizado" },
  { value: "rejected", label: "Rejeitado" },
  { value: "denied", label: "Denegado" },
  { value: "error", label: "Erro de comunicação" },
  { value: "cancelled", label: "Cancelado" },
  { value: "discarded", label: "Descartado" },
  { value: "unused", label: "Inutilizado" },
];

export function docNumberLabel(d: Record<string, any>) {
  if (d.model === "nfse") return d.number ? `nº ${d.number}` : d.rpsNumber ? `RPS ${d.rpsNumber}` : "Sem RPS";
  return d.number ? `${String(d.number).padStart(9, "0").replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3")}` : "Sem numeração";
}

export function formatKey(k?: string | null) {
  if (!k) return "—";
  return k.replace(/(\d{4})(?=\d)/g, "$1 ");
}

export const OP_LABEL: Record<string, string> = { saida: "Saída", entrada: "Entrada" };
