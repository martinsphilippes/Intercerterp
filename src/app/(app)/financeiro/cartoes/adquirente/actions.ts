"use server";

import { runAction, fjson, fstr } from "@/lib/server/action";
import { requireAction } from "@/lib/core/ctx";
import { assert } from "@/lib/core/errors";
import { requireFeature } from "@/lib/server/features";
import { applyAcquirerFile, previewAcquirerFile } from "@/domain/card-reconciliation";
import type { AcquirerLayout } from "@/domain/bank/acquirer";

const MAX_FILE = 10 * 1024 * 1024;
const RV = ["/financeiro/cartoes", "/financeiro/cartoes/adquirente", "/financeiro/receber", "/financeiro/fluxo-caixa"];

async function input(fd: FormData) {
  const f = fd.get("file");
  assert(f && typeof f !== "string" && (f as File).size, "Selecione o arquivo da adquirente (CSV).");
  const file = f as File;
  assert(file.size <= MAX_FILE, "Arquivo maior que 10 MB.");
  assert(fstr(fd, "accountId"), "Selecione a conta onde a adquirente credita.");
  const layout = fjson<AcquirerLayout | null>(fd, "layout", null);
  return { accountId: fstr(fd, "accountId"), fileName: file.name || "adquirente.csv", mime: file.type || "text/csv", data: Buffer.from(await file.arrayBuffer()), layout };
}

/** Prévia do casamento (nada é gravado): colunas, linhas e situação de cada linha. */
export async function previewAcquirerAction(fd: FormData) {
  return runAction({ module: "finance" }, async (s) => {
    await requireFeature(s, "taxasCartao");
    const pv = await previewAcquirerFile(s.ctx, await input(fd));
    return { ...pv, sniff: { ...pv.sniff, rows: pv.sniff.rows.slice(0, 5) }, matches: pv.matches.slice(0, 1000), totalMatches: pv.matches.length, issues: pv.issues.slice(0, 300) };
  });
}

/** Baixa as linhas casadas e grava o relatório de divergências (idempotente pelo arquivo + conta). */
export async function applyAcquirerAction(fd: FormData) {
  return runAction({ module: "finance", op: "edit", requireBranch: true, revalidate: RV }, async (s) => {
    await requireFeature(s, "taxasCartao");
    requireAction(s.ctx, "finance.settle");
    const r = await applyAcquirerFile(s.ctx, await input(fd));
    const n = r.import.summary?.byStatus?.applied ?? 0;
    return {
      ok: true as const,
      message: r.alreadyImported ? "Este arquivo já foi conciliado nesta conta — nada foi baixado de novo." : `Conciliação concluída: ${n} recebível(is) baixado(s).`,
      redirect: `/financeiro/cartoes/adquirente/${r.import.id}`,
    };
  });
}
