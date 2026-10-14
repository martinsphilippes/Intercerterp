"use server";

import { runAction, fstr } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { generateDominioFile, saveAccountingCodes } from "@/domain/accounting/dominio";

const PATHS = ["/financeiro/exportacao-dominio"];

/** Gera o arquivo de lançamentos do período para a Domínio (guardado em Arquivos, com download). */
export async function generateDominioAction(fd: FormData) {
  return runAction({ module: "finance", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "exportacaoDominio");
    const r = await generateDominioFile(s.ctx, { from: fstr(fd, "from"), to: fstr(fd, "to"), branchId: s.ctx.branchId ? null : fstr(fd, "branchId") || null });
    return { ok: true as const, data: r, message: `Arquivo gerado: ${r.lines} lançamento(s)${r.pending ? ` — ${r.pending} sem conta contábil (corrija antes de importar)` : ""}.` };
  });
}

/** Grava os códigos contábeis (Domínio) das categorias financeiras e contas financeiras. */
export async function saveAccountingCodesAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", revalidate: PATHS }, async (s) => {
    await requireFeature(s, "exportacaoDominio");
    const categories: Record<string, string> = {};
    const accounts: Record<string, string> = {};
    for (const [k, v] of fd.entries()) {
      if (typeof v !== "string") continue;
      if (k.startsWith("cat_")) categories[k.slice(4)] = v;
      if (k.startsWith("acc_")) accounts[k.slice(4)] = v;
    }
    const r = await saveAccountingCodes(s.ctx, { categories, accounts });
    return { ok: true as const, message: r.changed ? `${r.changed} código(s) contábil(is) atualizado(s).` : "Nenhuma alteração." };
  });
}
