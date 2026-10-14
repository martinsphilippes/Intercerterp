/**
 * Cálculos puros de lotes e validades (EST-02). Sem dependências de servidor: usados por `postMovements`, pelas telas
 * (PDV, inventário, relatório de validades) e pelos testes.
 *
 * Modelo: o saldo de cada lote fica no próprio saldo do SKU no depósito (`stock_balances.lots`, json) e é alterado
 * SOMENTE pelo movimento, na mesma transação que altera o físico (mesma sequência do saldo). Cada movimento de produto
 * com controle de lote grava a sua divisão por lote (`stock_movements.lots`), de modo que o saldo por lote é sempre
 * reconstruível a partir dos movimentos (`lotsFromMovements`).
 *  - "Sem lote" = físico − Σ lotes (estoque anterior ao controle, entradas sem lote, saídas sem saldo de lote).
 *  - Quantidades em milésimos; validade e fabricação em "AAAA-MM-DD".
 */

/** Saldo de um lote no depósito. */
export interface LotEntry {
  lot: string;
  expiry: string | null;
  mfg?: string | null;
  qty: number;
}

/** Parte de um movimento atribuída a um lote (`lot = null` = sem lote). Quantidade com sinal do efeito no saldo. */
export interface LotPart {
  lot: string | null;
  expiry?: string | null;
  mfg?: string | null;
  qty: number;
}

/** Código do lote normalizado (sem espaços nas pontas, até 60 caracteres); vazio = sem lote. */
export function normLot(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 60);
  return s || null;
}

/** Data AAAA-MM-DD válida ou null. */
export function normDate(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Ordem FEFO: vence primeiro sai primeiro (sem validade por último; empate pelo código do lote). */
export function fefoCompare(a: { lot: string | null; expiry?: string | null }, b: { lot: string | null; expiry?: string | null }) {
  const ea = a.expiry ?? "9999-99-99";
  const eb = b.expiry ?? "9999-99-99";
  if (ea !== eb) return ea < eb ? -1 : 1;
  return String(a.lot ?? "").localeCompare(String(b.lot ?? ""));
}

export function sortFefo<T extends { lot: string | null; expiry?: string | null }>(lots: T[]): T[] {
  return [...lots].sort(fefoCompare);
}

/** Soma dos lotes. */
export const lotsTotal = (lots: Array<{ qty: number }> | null | undefined) => (lots ?? []).reduce((a, l) => a + (l.qty ?? 0), 0);

/** Saldo sem lote (físico − Σ lotes). */
export const unlottedQty = (physical: number, lots: LotEntry[] | null | undefined) => physical - lotsTotal(lots);

/** Junta partes do mesmo lote (mantém a primeira validade/fabricação conhecida) e descarta as nulas. */
export function mergeParts(parts: LotPart[]): LotPart[] {
  const out: LotPart[] = [];
  for (const p of parts) {
    if (!p.qty) continue;
    const cur = out.find((x) => x.lot === p.lot);
    if (cur) {
      cur.qty += p.qty;
      cur.expiry = cur.expiry ?? p.expiry ?? null;
      cur.mfg = cur.mfg ?? p.mfg ?? null;
    } else out.push({ lot: p.lot, expiry: p.expiry ?? null, mfg: p.mfg ?? null, qty: p.qty });
  }
  return out.filter((p) => p.qty !== 0);
}

/**
 * Divide uma SAÍDA (`qty` positivo, em milésimos) entre os lotes:
 *  1. lote escolhido (PDV, ajuste manual) até o saldo dele;
 *  2. lotes dentro da validade em ordem FEFO;
 *  3. saldo sem lote;
 *  4. lotes vencidos (FEFO) — só quando não há outro saldo;
 *  5. o que faltar (venda sem saldo permitida) fica como "sem lote" (deixa o sem-lote negativo, nunca um lote).
 * Devolve as partes com quantidade POSITIVA (o chamador aplica o sinal).
 */
export function allocateExit(lots: LotEntry[] | null | undefined, physical: number, qty: number, preferred?: string | null, today?: string | null): LotPart[] {
  const list = (lots ?? []).filter((l) => l.qty > 0);
  const parts: LotPart[] = [];
  let need = qty;
  const take = (l: LotEntry | null, max: number) => {
    const q = Math.min(need, Math.max(0, max));
    if (q <= 0) return;
    parts.push(l ? { lot: l.lot, expiry: l.expiry ?? null, mfg: l.mfg ?? null, qty: q } : { lot: null, qty: q });
    need -= q;
  };
  const pref = normLot(preferred);
  const used = new Set<string>();
  if (pref) {
    const l = list.find((x) => x.lot === pref);
    if (l) {
      take(l, l.qty);
      used.add(l.lot);
    }
  }
  const sorted = sortFefo(list.filter((l) => !used.has(l.lot)));
  const expired = (l: LotEntry) => Boolean(today && l.expiry && l.expiry < today);
  for (const l of sorted) if (need > 0 && !expired(l)) take(l, l.qty);
  if (need > 0) take(null, unlottedQty(physical, lots ?? []));
  for (const l of sorted) if (need > 0 && expired(l)) take(l, l.qty);
  if (need > 0) parts.push({ lot: null, qty: need });
  return mergeParts(parts);
}

/**
 * Divide uma ENTRADA que desfaz uma saída (devolução, cancelamento, recebimento de transferência) entre os lotes de
 * onde a saída tirou, descontando o que já voltou antes (`prior`). O que exceder volta "sem lote".
 * `source` e `prior` com quantidades em módulo; devolve partes positivas.
 */
export function allocateBack(source: LotPart[] | null | undefined, prior: LotPart[] | null | undefined, qty: number): LotPart[] {
  const back = new Map<string, number>();
  for (const p of prior ?? []) if (p.lot) back.set(p.lot, (back.get(p.lot) ?? 0) + Math.abs(p.qty));
  const parts: LotPart[] = [];
  let need = qty;
  for (const s of mergeParts((source ?? []).map((p) => ({ ...p, qty: Math.abs(p.qty) })))) {
    if (need <= 0) break;
    if (!s.lot) continue;
    const already = back.get(s.lot) ?? 0;
    const room = s.qty - already;
    back.set(s.lot, Math.max(0, already - s.qty));
    if (room <= 0) continue;
    const q = Math.min(need, room);
    parts.push({ lot: s.lot, expiry: s.expiry ?? null, mfg: s.mfg ?? null, qty: q });
    need -= q;
  }
  if (need > 0) parts.push({ lot: null, qty: need });
  return mergeParts(parts);
}

/**
 * Inventário por lote: partes (com sinal) que levam os lotes do saldo atual às quantidades contadas. A diferença entre
 * o ajuste total do item (`totalQty`, regra da base temporal) e a soma das diferenças por lote vai para o "sem lote".
 */
export function targetSplit(lots: LotEntry[] | null | undefined, target: LotPart[], totalQty: number): LotPart[] {
  const cur = new Map((lots ?? []).map((l) => [l.lot, l]));
  const want = new Map<string, LotPart>();
  for (const t of target) {
    const lot = normLot(t.lot);
    if (!lot) continue;
    const prev = want.get(lot);
    want.set(lot, { lot, expiry: prev?.expiry ?? t.expiry ?? null, mfg: prev?.mfg ?? t.mfg ?? null, qty: (prev?.qty ?? 0) + Math.max(0, t.qty) });
  }
  const parts: LotPart[] = [];
  for (const lot of new Set([...cur.keys(), ...want.keys()])) {
    const have = cur.get(lot)?.qty ?? 0;
    const w = want.get(lot);
    const delta = (w?.qty ?? 0) - have;
    if (delta) parts.push({ lot, expiry: cur.get(lot)?.expiry ?? w?.expiry ?? null, mfg: cur.get(lot)?.mfg ?? w?.mfg ?? null, qty: delta });
  }
  const rest = totalQty - parts.reduce((a, p) => a + p.qty, 0);
  if (rest) parts.push({ lot: null, qty: rest });
  return mergeParts(parts);
}

/** Aplica as partes de um movimento aos lotes do saldo (lotes zerados saem da lista; ordem FEFO). */
export function applyParts(lots: LotEntry[] | null | undefined, parts: LotPart[]): LotEntry[] {
  const map = new Map<string, LotEntry>((lots ?? []).map((l) => [l.lot, { ...l }]));
  for (const p of parts) {
    if (!p.lot || !p.qty) continue;
    const cur = map.get(p.lot);
    if (cur) {
      cur.qty += p.qty;
      if (!cur.expiry && p.expiry) cur.expiry = p.expiry;
      if (!cur.mfg && p.mfg) cur.mfg = p.mfg;
    } else map.set(p.lot, { lot: p.lot, expiry: p.expiry ?? null, mfg: p.mfg ?? null, qty: p.qty });
  }
  return sortFefo([...map.values()].filter((l) => l.qty !== 0));
}

/** Reconstrói o saldo por lote a partir das partes gravadas nos movimentos (conferência do saldo do depósito). */
export function lotsFromMovements(movements: Array<{ lots?: LotPart[] | null }>): LotEntry[] {
  let lots: LotEntry[] = [];
  for (const m of movements) if (Array.isArray(m.lots)) lots = applyParts(lots, m.lots);
  return lots;
}

/** Situação da validade em relação à data de referência e à antecedência do alerta. */
export function expiryStatus(expiry: string | null | undefined, today: string, alertDays: number): "expired" | "expiring" | "ok" | "none" {
  if (!expiry) return "none";
  if (expiry < today) return "expired";
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + alertDays * 86400000).toISOString().slice(0, 10);
  return expiry <= limit ? "expiring" : "ok";
}

/** Dias até a validade (negativo = vencido há N dias). */
export function daysToExpiry(expiry: string, today: string) {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}
