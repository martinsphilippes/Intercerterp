"use server";

import { runAction, fbool, fstr } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { generateSintegraFile } from "@/domain/fiscal/files/sintegra";
import { readSintegraParams, toSintegraOptions } from "./params";

const PATHS = ["/fiscal/arquivos/sintegra"];

/** Gera o arquivo Sintegra do estabelecimento/período (guardado em Arquivos, com histórico e download). */
export async function generateSintegraAction(fd: FormData) {
  return runAction({ module: "fiscal", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "arquivosFiscais");
    const p = readSintegraParams((k) => fstr(fd, k), s.ctx.branchId ?? "");
    const r = await generateSintegraFile(s.ctx, { ...toSintegraOptions(p), branchId: s.ctx.branchId ?? p.branchId, allowPendencies: fbool(fd, "allowPendencies") });
    return {
      ok: true as const,
      data: r,
      message: r.reused ? `Arquivo idêntico já gerado: ${r.fileName} (${r.lines} registros).` : `Arquivo gerado: ${r.fileName} (${r.lines} registros)${r.errors ? ` — COM ${r.errors} pendência(s) bloqueante(s)` : ""}. Valide no validador Sintegra da UF antes de enviar.`,
    };
  });
}
