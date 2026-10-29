/** Classificação dos produtos do catálogo da certificação (sem dependências de servidor: usada também nos formulários). */

export const CERT_PRODUCT_TYPES = [
  { value: "a1", label: "A1 (arquivo)" },
  { value: "a3", label: "A3 (cartão/token)" },
  { value: "birdid", label: "BirdID (nuvem)" },
  { value: "outro", label: "Outro" },
] as const;
export const CERT_HOLDERS = [
  { value: "pf", label: "Pessoa física (e-CPF)" },
  { value: "pj", label: "Pessoa jurídica (e-CNPJ)" },
] as const;
/** AC de 1º nível de quem a Intercert compra (AC2 da ICP-Brasil) */
export const CERT_SUPPLIERS = [
  { value: "soluti", label: "Soluti" },
  { value: "serpro", label: "Serpro" },
] as const;
