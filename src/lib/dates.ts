/**
 * Datas: armazenamos instantes em UTC (ISO) e datas de calendário como "AAAA-MM-DD".
 * Recortes por período usam o fuso da empresa (padrão America/Sao_Paulo) e o intervalo
 * técnico [início do 1º dia, início do dia seguinte ao último) — incluindo integralmente o último dia.
 */

export const DEFAULT_TZ = process.env.APP_TIMEZONE || "America/Sao_Paulo";

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** Data de calendário (AAAA-MM-DD) do instante no fuso informado. */
export function toLocalDate(d: Date | string = new Date(), tz = DEFAULT_TZ): string {
  const p = parts(typeof d === "string" ? new Date(d) : d, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function today(tz = DEFAULT_TZ): string {
  return toLocalDate(new Date(), tz);
}

/** Deslocamento (ms) do fuso em relação ao UTC para um instante. */
function tzOffsetMs(d: Date, tz: string): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Instante UTC correspondente à meia-noite local de `date`. */
export function startOfLocalDay(date: string, tz = DEFAULT_TZ): string {
  const [y, m, d] = date.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d));
  const off = tzOffsetMs(guess, tz);
  const t = new Date(guess.getTime() - off);
  // reajuste para transições de horário de verão
  const off2 = tzOffsetMs(t, tz);
  return new Date(guess.getTime() - off2).toISOString();
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  return t.toISOString().slice(0, 10);
}

/** Intervalo técnico [from 00:00, to+1 00:00) em UTC ISO. */
export function dayRange(from: string, to: string, tz = DEFAULT_TZ): { start: string; end: string } {
  return { start: startOfLocalDay(from, tz), end: startOfLocalDay(addDays(to, 1), tz) };
}

export function diffDays(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function monthStart(date: string): string {
  return date.slice(0, 8) + "01";
}

export function monthEnd(date: string): string {
  return addDays(addMonths(monthStart(date), 1), -1);
}

export function formatDate(v: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!v) return "—";
  const date = v.length === 10 ? v : toLocalDate(v, tz);
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateTime(v: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!v) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date(v));
}

/** Hora local (HH:MM ou HH:MM:SS) no fuso da instalação — igual no servidor e no navegador (sem erro de hidratação). */
export function formatTime(v: string | number | Date | null | undefined, withSeconds = false, tz = DEFAULT_TZ): string {
  if (v == null || v === "") return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) }).format(new Date(v));
}

/** Data e hora com segundos no fuso da instalação. */
export function formatDateTimeSeconds(v: string | number | Date | null | undefined, tz = DEFAULT_TZ): string {
  if (v == null || v === "") return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: tz, dateStyle: "short", timeStyle: "medium" }).format(new Date(v));
}

export function formatMonth(period: string): string {
  const [y, m] = period.split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(m) - 1]}/${y}`;
}

/** Aceita "dd/mm/aaaa" ou "aaaa-mm-dd". */
export function parseDateInput(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  throw new Error(`Data inválida: ${v}`);
}

export function nowIso(): string {
  return new Date().toISOString();
}
