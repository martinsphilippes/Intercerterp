"use server";

import { runAction } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { analyzeDataCsv, dataImportDef, previewDataImport, runDataImport, type DataImportKind } from "@/domain/data-import";

/** Importação de cadastros e saldos (PLA-19): só administradores (Administração › criar) e com o recurso ligado. */

export async function analyzeDataCsvAction(kind: DataImportKind, text: string) {
  return runAction({ module: "admin", op: "create" }, async (s) => {
    await requireFeature(s, "importacaoCadastros");
    return analyzeDataCsv(dataImportDef(kind).kind, text);
  });
}

export async function previewDataImportAction(payload: { kind: DataImportKind; text: string; mapping: Record<string, string> }) {
  return runAction({ module: "admin", op: "create" }, async (s) => {
    await requireFeature(s, "importacaoCadastros");
    return previewDataImport(s.ctx, payload);
  });
}

export async function runDataImportAction(payload: { kind: DataImportKind; fileName: string; text: string; mapping: Record<string, string>; idemKey: string }) {
  return runAction({ module: "admin", op: "create", revalidate: ["/administracao/importacao", "/clientes", "/fornecedores", "/estoque", "/financeiro/receber", "/financeiro/pagar"] }, async (s) => {
    await requireFeature(s, "importacaoCadastros");
    const r = await runDataImport(s.ctx, payload);
    return { ok: true as const, data: { id: r.id }, message: `Importação nº ${r.number} concluída.`, redirect: `/administracao/importacao/${r.id}` };
  });
}
