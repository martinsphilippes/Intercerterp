/**
 * Normalização das buscas de texto ("contém" e "começa com"): sem acentos e sem diferença de maiúsculas.
 * Única para todos os armazenamentos — a memória aplica aos dois lados; o Postgres aplica ao termo aqui e à coluna
 * com a função `ic_norm` criada junto com as tabelas (mesma regra para as letras latinas acentuadas).
 */
export function normText(v: unknown): unknown {
  if (typeof v === "string") return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return v;
}
