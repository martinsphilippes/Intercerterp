/** Normaliza texto para pesquisa (minúsculas, sem acentos). */
export function searchable(...parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1000);
}

export function onlyDigits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

export function isValidCpf(v: string): boolean {
  const c = onlyDigits(v);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

export function isValidCnpj(v: string): boolean {
  const c = onlyDigits(v);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(c[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

export function formatDoc(v: string | null | undefined): string {
  const c = onlyDigits(v);
  if (c.length === 11) return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (c.length === 14) return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return v ?? "";
}

export function formatPhone(v: string | null | undefined): string {
  const c = onlyDigits(v);
  if (c.length === 11) return c.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (c.length === 10) return c.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return v ?? "";
}
