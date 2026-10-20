"use server";

import { fbool, fstr, runAction } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { generateFiscalFile } from "@/domain/fiscal/files/service";
import { filesQuery, toRequest } from "./params";

const PATHS = ["/fiscal/arquivos"];

/** Gera o arquivo fiscal do período (guardado em Arquivos, com download e histórico). */
export async function generateFiscalFileAction(fd: FormData) {
  return runAction({ module: "fiscal", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "arquivosFiscais");
    const raw: Record<string, string> = {};
    for (const k of ["arquivo", "periodo", "filial", "finalidade", "inventario", "saldo", "recibo"]) raw[k] = fstr(fd, k);
    const r = await generateFiscalFile(s.ctx, { ...toRequest(filesQuery(raw, s.ctx.branchId)), acceptPendencies: fbool(fd, "accept") });
    return { ok: true as const, data: r, message: r.reused ? `Mesmo conteúdo do último arquivo do período: ${r.fileName}.` : `Arquivo gerado: ${r.fileName} (${r.lines} linhas).` };
  });
}
