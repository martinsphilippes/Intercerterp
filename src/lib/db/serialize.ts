import { getCollection } from "./schema";

/** Converte valores da aplicação para o formato persistido (JSON → string, etc). */
export function toStored(collection: string, data: Record<string, any>): Record<string, any> {
  const def = getCollection(collection);
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "id" || key === "createdAt" || key === "updatedAt") continue;
    const f = def.fields[key];
    if (!f) throw new Error(`Campo desconhecido "${key}" em ${collection}`);
    if (value === undefined) continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    switch (f.type) {
      case "json":
        out[key] = typeof value === "string" ? value : JSON.stringify(value);
        break;
      case "int":
      case "money":
      case "qty":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          throw new Error(`Campo ${collection}.${key} exige inteiro (recebido ${String(value)})`);
        }
        out[key] = value;
        break;
      case "bool":
        out[key] = Boolean(value);
        break;
      case "strings":
        out[key] = Array.isArray(value) ? value.map(String) : [];
        break;
      case "string":
      case "text":
        out[key] = String(value);
        if (f.size && out[key].length > f.size) out[key] = out[key].slice(0, f.size);
        break;
      default:
        out[key] = value;
    }
  }
  return out;
}

export function fromStored(collection: string, data: Record<string, any>): Record<string, any> {
  const def = getCollection(collection);
  const out: Record<string, any> = {};
  for (const [key, f] of Object.entries(def.fields)) {
    let v = data[key];
    if (v === undefined) v = null;
    if (f.type === "json" && typeof v === "string") {
      try {
        v = JSON.parse(v);
      } catch {
        /* mantém string */
      }
    }
    if (f.type === "strings" && v == null) v = [];
    out[key] = v;
  }
  return out;
}
