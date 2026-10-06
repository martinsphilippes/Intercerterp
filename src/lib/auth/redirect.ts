/**
 * Destino após o login (`?next=`): somente caminho relativo interno. Recusa URL absoluta, protocolo relativo ("//host"),
 * barra invertida ("/\\host" — navegadores tratam como "//"), caracteres de controle e esquemas ("javascript:").
 */
export function safeNextPath(raw: unknown, fallback = "/dashboard"): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v || v.length > 2000) return fallback;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(v)) return fallback;
  try {
    const u = new URL(v, "http://interno.invalid");
    if (u.origin !== "http://interno.invalid") return fallback;
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return fallback;
  }
}
