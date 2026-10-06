import { detId, isConflict, listAll } from "@/lib/db";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError, assert } from "@/lib/core/errors";
import { requirePerm, type Ctx } from "@/lib/core/ctx";
import { audit, diff } from "@/lib/core/audit";
import { nowIso } from "@/lib/dates";

/**
 * Terminais do PDV (Tela 39): identificação, filial, situação, parâmetros de caixa, série NFC-e,
 * impressora (navegador ou conector local), largura do papel, leitor e TEF.
 *
 * Impressão pelo navegador: a página de teste é aberta e o diálogo de impressão é acionado; o navegador
 * NÃO informa se a impressão física ocorreu — registramos apenas a abertura da página.
 * Conector local: GET <connectorUrl>/status feito pelo NAVEGADOR do computador do caixa (o conector escuta em 127.0.0.1);
 * o resultado medido (sucesso/falha) é registrado. O servidor nunca contata a URL do conector — evita que o cadastro do
 * terminal sirva para o servidor acessar endereços internos (SSRF) e devolver o que encontrou.
 * Contrato do conector em docs/integracoes.md, seção "Conector de periféricos".
 */

export const PRINTER_MODES = [
  { value: "browser", label: "Navegador (diálogo de impressão do sistema)" },
  { value: "connector", label: "Conector local (serviço HTTP no terminal)" },
  { value: "none", label: "Sem impressora" },
];
export const SCANNER_MODES = [
  { value: "keyboard_wedge", label: "Leitor como teclado (USB/HID teclado)" },
  { value: "hid", label: "Leitor HID via conector local" },
  { value: "none", label: "Sem leitor (digitação manual)" },
];
export const TEF_PROVIDERS = [
  { value: "manual_pos", label: "Maquininha avulsa (registro manual de NSU/autorização)" },
  { value: "tef_connector", label: "TEF via conector local" },
  { value: "none", label: "Sem cartão neste terminal" },
];
export const PAPER_WIDTHS = [
  { value: "80", label: "80 mm (48 colunas)" },
  { value: "58", label: "58 mm (32 colunas)" },
];

export interface TerminalInput {
  branchId: string;
  code: string;
  name: string;
  nfceSeries?: number | null;
  printerMode: string;
  printerName?: string | null;
  connectorUrl?: string | null;
  paperWidth: number;
  scannerMode: string;
  tefProvider: string;
  tefConfig?: Record<string, any> | null;
  allowNegativeStock: boolean;
  defaultWarehouseId?: string | null;
  drawerOnCash?: boolean;
}

function normalizeUrl(u: string | null | undefined): string | null {
  const v = (u ?? "").trim().replace(/\/+$/, "");
  if (!v) return null;
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    throw new BusinessError("URL do conector inválida (ex.: http://127.0.0.1:9100).", "invalid_url");
  }
  assert(parsed.protocol === "http:" || parsed.protocol === "https:", "O conector deve usar http:// ou https://.");
  assert(!parsed.username && !parsed.password, "A URL do conector não pode conter usuário ou senha.");
  assert(!parsed.search && !parsed.hash, "Informe só o endereço do conector (sem parâmetros ?… ou #…), ex.: http://127.0.0.1:9100.");
  return v;
}

async function validate(ctx: Ctx, input: TerminalInput, selfId?: string) {
  assert(input.name?.trim(), "Informe o nome do terminal.");
  assert(input.code?.trim(), "Informe o código do terminal.");
  const branch = await ctx.store.get("branches", input.branchId);
  assert(branch && branch.companyId === ctx.companyId, "Selecione uma filial da empresa.");
  assert(PRINTER_MODES.some((m) => m.value === input.printerMode), "Modo de impressão inválido.");
  assert(SCANNER_MODES.some((m) => m.value === input.scannerMode), "Modo do leitor inválido.");
  assert(TEF_PROVIDERS.some((m) => m.value === input.tefProvider), "Provedor de pagamento inválido.");
  assert([58, 80].includes(input.paperWidth), "Largura do papel deve ser 58 ou 80 mm.");
  const connectorUrl = normalizeUrl(input.connectorUrl);
  if (input.printerMode === "connector" || input.scannerMode === "hid" || input.tefProvider === "tef_connector") assert(connectorUrl, "Informe a URL do conector local para usar impressora, leitor HID ou TEF pelo conector.");
  if (input.defaultWarehouseId) {
    const wh = await ctx.store.get("warehouses", input.defaultWarehouseId);
    assert(wh && wh.branchId === input.branchId, "O depósito padrão deve pertencer à filial do terminal.");
  }
  const code = input.code.trim().toUpperCase();
  const all = await listAll(ctx.store, "terminals", { filters: [["eq", "companyId", ctx.companyId]] });
  if (all.some((t) => t.id !== selfId && t.code === code)) throw new BusinessError(`Já existe terminal com o código ${code}.`, "duplicate");
  if (input.nfceSeries != null) {
    assert(Number.isInteger(input.nfceSeries) && input.nfceSeries >= 1 && input.nfceSeries <= 999, "Série NFC-e deve estar entre 1 e 999.");
    const clash = all.find((t) => t.id !== selfId && t.branchId === input.branchId && t.status !== "inactive" && t.nfceSeries === input.nfceSeries);
    if (clash) throw new BusinessError(`A série NFC-e ${input.nfceSeries} já é usada pelo terminal ${clash.name} nesta filial. Cada terminal ativo usa sua própria série.`, "duplicate");
  }
  return {
    branchId: input.branchId,
    code,
    name: input.name.trim(),
    nfceSeries: input.nfceSeries ?? null,
    printerMode: input.printerMode,
    printerName: input.printerName?.trim() || null,
    connectorUrl,
    paperWidth: input.paperWidth,
    scannerMode: input.scannerMode,
    tefProvider: input.tefProvider,
    tefConfig: input.tefConfig ?? null,
    allowNegativeStock: Boolean(input.allowNegativeStock),
    defaultWarehouseId: input.defaultWarehouseId || null,
    drawerOnCash: Boolean(input.drawerOnCash),
  };
}

export async function createTerminal(ctx: Ctx, input: TerminalInput) {
  requirePerm(ctx, "admin", "create");
  const data = await validate(ctx, input);
  const id = detId("terminal", ctx.companyId, data.code);
  try {
    const t = await ctx.store.create("terminals", { companyId: ctx.companyId, createdBy: ctx.user.id, ...data, status: "active" }, id);
    await audit({ ...ctx, branchId: data.branchId }, { module: "admin", action: "terminal.create", entityType: "terminal", entityId: t.id, summary: `Terminal ${t.code} — ${t.name} cadastrado`, after: data, related: [`branch:${data.branchId}`] });
    return t;
  } catch (e) {
    if (isConflict(e)) throw new BusinessError(`Já existe terminal com o código ${data.code}.`, "duplicate");
    throw e;
  }
}

export async function updateTerminal(ctx: Ctx, id: string, input: TerminalInput) {
  requirePerm(ctx, "admin", "edit");
  const before = await ctx.store.getOrThrow("terminals", id);
  assert(before.companyId === ctx.companyId, "Terminal de outra empresa.");
  const data = await validate(ctx, input, id);
  if (data.branchId !== before.branchId || data.nfceSeries !== (before.nfceSeries ?? null) || data.defaultWarehouseId !== (before.defaultWarehouseId ?? null)) {
    // continuidade e rastreabilidade do caixa: filial, série e depósito só mudam com o caixa fechado
    const open = await openSession(ctx.store, id);
    assert(!open, "Há caixa aberto neste terminal: feche-o antes de alterar filial, série NFC-e ou depósito de saída (as vendas da sessão precisam manter a mesma numeração e origem de estoque).");
  }
  const after = await ctx.store.update("terminals", id, data);
  const d = diff(before, after);
  if (Object.keys(d.after).length) await audit({ ...ctx, branchId: after.branchId }, { module: "admin", action: "terminal.update", entityType: "terminal", entityId: id, summary: `Terminal ${after.name} alterado`, before: d.before, after: d.after });
  return after;
}

export async function setTerminalStatus(ctx: Ctx, id: string, status: "active" | "inactive", reason?: string | null) {
  requirePerm(ctx, "admin", "edit");
  const t = await ctx.store.getOrThrow("terminals", id);
  assert(t.companyId === ctx.companyId, "Terminal de outra empresa.");
  if (status === "inactive") assert(!(await openSession(ctx.store, id)), "Há caixa aberto neste terminal; feche-o antes de inativar.");
  if (status === "active" && t.nfceSeries != null) {
    const clash = (await listAll(ctx.store, "terminals", { filters: [["eq", "branchId", t.branchId], ["eq", "status", "active"]] })).find((x) => x.id !== id && x.nfceSeries === t.nfceSeries);
    assert(!clash, `A série NFC-e ${t.nfceSeries} está em uso pelo terminal ${clash?.name}. Altere a série antes de reativar.`);
  }
  const after = await ctx.store.update("terminals", id, { status });
  await audit({ ...ctx, branchId: t.branchId }, { module: "admin", action: `terminal.${status}`, entityType: "terminal", entityId: id, summary: `Terminal ${t.name} ${status === "inactive" ? "inativado" : "reativado"}`, reason: reason ?? null });
  return after;
}

export async function openSession(store: Store, terminalId: string): Promise<Doc | null> {
  const r = await store.list("cash_sessions", { filters: [["eq", "terminalId", terminalId], ["eq", "status", ["open", "reopened"]]], limit: 1 });
  return r.items[0] ?? null;
}

export async function terminalSessions(store: Store, terminalId: string) {
  return listAll(store, "cash_sessions", { filters: [["eq", "terminalId", terminalId]], orderBy: [{ field: "openedAt", dir: "desc" }] }, 500);
}

/** Registra que a página de teste de impressão foi aberta no navegador (sem presumir impressão física). */
export async function recordBrowserPrintPage(ctx: Ctx, id: string, info: { userAgent?: string | null }) {
  requirePerm(ctx, "admin", "view");
  const t = await ctx.store.getOrThrow("terminals", id);
  assert(t.companyId === ctx.companyId, "Terminal de outra empresa.");
  const at = nowIso();
  const result = "Página de teste aberta no navegador e diálogo de impressão acionado — o navegador não confirma a impressão física; confira o cupom impresso.";
  await ctx.store.update("terminals", id, { lastPrinterTestAt: at, lastPrinterTestResult: result });
  await audit({ ...ctx, branchId: t.branchId }, { module: "admin", action: "terminal.print_test_page", entityType: "terminal", entityId: id, summary: `Página de teste de impressão aberta para ${t.name} (impressão física não verificável)`, after: { userAgent: info.userAgent?.slice(0, 200) ?? null } });
  return result;
}

export interface ConnectorStatus {
  ok: boolean;
  verified: boolean;
  origin: "server" | "browser";
  httpStatus?: number;
  latencyMs?: number;
  message: string;
}

/** Interpreta a resposta do GET /status do conector (contrato em docs/integracoes.md). */
export function describeConnectorBody(body: any): string {
  if (!body || typeof body !== "object") return "resposta sem JSON válido";
  const parts: string[] = [];
  if (body.version) parts.push(`versão ${body.version}`);
  const p = body.printer;
  if (p) parts.push(`impressora ${p.name ?? "—"}: ${p.ready ? "pronta" : `indisponível${p.error ? ` (${p.error})` : ""}`}${p.paperWidth ? `, papel ${p.paperWidth} mm` : ""}`);
  const sc = body.scanner;
  if (sc) parts.push(`leitor: ${sc.connected ? "conectado" : "desconectado"}`);
  const tef = body.tef;
  if (tef) parts.push(`TEF ${tef.provider ?? ""}: ${tef.ready ? "pronto" : "indisponível"}`.replace("  ", " "));
  return parts.join(" · ") || "conector respondeu sem detalhes de periféricos";
}

/**
 * Terminal sem conector configurado: registra "não verificado". Com conector, o teste é sempre feito pelo navegador
 * do computador do caixa (`recordConnectorCheck` com origem "browser") — o servidor não faz requisições à URL cadastrada.
 */
export async function recordConnectorNotConfigured(ctx: Ctx, id: string): Promise<ConnectorStatus> {
  requirePerm(ctx, "admin", "edit");
  const t = await ctx.store.getOrThrow("terminals", id);
  assert(t.companyId === ctx.companyId, "Terminal de outra empresa.");
  const status: ConnectorStatus = t.connectorUrl
    ? { ok: false, verified: false, origin: "browser", message: "Não verificado: o conector é testado pelo navegador do computador do caixa (botão “Testar conector”); o servidor não acessa o endereço do conector." }
    : { ok: false, verified: false, origin: "server", message: "Não verificado: terminal sem conector local configurado." };
  return recordConnectorCheck(ctx, t, status);
}

/** Registra o resultado medido pelo NAVEGADOR do terminal (topologia usual: conector em 127.0.0.1). */
export async function recordConnectorCheck(ctx: Ctx, tOrId: Doc | string, status: ConnectorStatus): Promise<ConnectorStatus> {
  const t = typeof tOrId === "string" ? await ctx.store.getOrThrow("terminals", tOrId) : tOrId;
  assert(t.companyId === ctx.companyId, "Terminal de outra empresa.");
  const origin = status.origin === "browser" ? "pelo navegador" : "pelo servidor";
  const text = status.verified ? `${status.ok ? "Conector OK" : "Conector com falha"} (verificado ${origin}): ${status.message}` : status.message;
  await ctx.store.update("terminals", t.id, { lastPrinterTestAt: nowIso(), lastPrinterTestResult: text.slice(0, 300) });
  await audit({ ...ctx, branchId: t.branchId }, {
    module: "admin", action: "terminal.connector_check", entityType: "terminal", entityId: t.id, summary: `Verificação do conector de ${t.name}: ${text}`.slice(0, 500),
    after: { origin: status.origin, httpStatus: status.httpStatus ?? null, latencyMs: status.latencyMs ?? null, verified: status.verified }, result: status.verified && !status.ok ? "failure" : "success",
  });
  return status;
}
