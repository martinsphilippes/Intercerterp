"use server";

import { runAction, fstr, fopt, fbool, fint } from "@/lib/server/action";
import { createTerminal, updateTerminal, setTerminalStatus, recordBrowserPrintPage, checkConnectorFromServer, recordConnectorCheck, describeConnectorBody, type TerminalInput, type ConnectorStatus } from "@/domain/terminals";

function parse(fd: FormData): TerminalInput {
  const series = fstr(fd, "nfceSeries");
  return {
    branchId: fstr(fd, "branchId"),
    code: fstr(fd, "code"),
    name: fstr(fd, "name"),
    nfceSeries: series === "" ? null : fint(fd, "nfceSeries"),
    printerMode: fstr(fd, "printerMode") || "browser",
    printerName: fopt(fd, "printerName"),
    connectorUrl: fopt(fd, "connectorUrl"),
    paperWidth: fint(fd, "paperWidth", 80),
    scannerMode: fstr(fd, "scannerMode") || "keyboard_wedge",
    tefProvider: fstr(fd, "tefProvider") || "manual_pos",
    tefConfig: { acquirer: fopt(fd, "tefAcquirer"), merchantId: fopt(fd, "tefMerchantId") },
    allowNegativeStock: fbool(fd, "allowNegativeStock"),
    defaultWarehouseId: fopt(fd, "defaultWarehouseId"),
    drawerOnCash: fbool(fd, "drawerOnCash"),
  };
}

export async function saveTerminalAction(fd: FormData) {
  const id = fopt(fd, "id");
  return runAction({ module: "admin", op: id ? "edit" : "create", revalidate: ["/administracao/terminais"] }, async (s) => {
    const t = id ? await updateTerminal(s.ctx, id, parse(fd)) : await createTerminal(s.ctx, parse(fd));
    return { ok: true as const, message: id ? "Terminal atualizado." : "Terminal cadastrado.", redirect: `/administracao/terminais/${t.id}` };
  });
}

export async function setTerminalStatusAction(id: string, status: "active" | "inactive", fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: [`/administracao/terminais/${id}`] }, async (s) => {
    await setTerminalStatus(s.ctx, id, status, fopt(fd, "reason"));
    return { ok: true as const, message: status === "inactive" ? "Terminal inativado." : "Terminal reativado." };
  });
}

export async function recordPrintPageAction(id: string, userAgent: string) {
  return runAction({ module: "admin" }, async (s) => ({ message: await recordBrowserPrintPage(s.ctx, id, { userAgent }) }));
}

export async function checkConnectorServerAction(id: string) {
  return runAction({ module: "admin", op: "edit", revalidate: [`/administracao/terminais/${id}`] }, async (s) => {
    const r = await checkConnectorFromServer(s.ctx, id);
    return { ok: true as const, data: r, message: r.verified ? (r.ok ? `Conector respondeu: ${r.message}` : `Falha: ${r.message}`) : r.message };
  });
}

/** Resultado medido no navegador do terminal (o conector local só é alcançável a partir da própria máquina). */
export async function recordBrowserConnectorAction(id: string, status: { ok: boolean; httpStatus?: number; latencyMs?: number; error?: string; body?: unknown }) {
  return runAction({ module: "admin", op: "edit", revalidate: [`/administracao/terminais/${id}`] }, async (s) => {
    const message = status.error ? `Falha ao contatar o conector a partir do navegador: ${String(status.error).slice(0, 200)}` : `HTTP ${status.httpStatus} em ${status.latencyMs} ms — ${describeConnectorBody(status.body)}`;
    const ok = !status.error && Boolean(status.ok) && (status.body as any)?.ok !== false;
    const r: ConnectorStatus = { ok, verified: true, origin: "browser", httpStatus: status.httpStatus, latencyMs: status.latencyMs, message };
    await recordConnectorCheck(s.ctx, id, r);
    return { ok: true as const, data: r };
  });
}
