"use server";

import { runAction, fbool, fopt, fstr } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { NUTRITION_FIELDS, generateScaleLoad, saveScaleData } from "@/domain/scale";
import type { ScaleFileFormat } from "@/domain/scale-files";

const optInt = (fd: FormData, k: string): number | null => {
  const v = fstr(fd, k);
  if (v === "") return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/** Aba "Balança" do produto: PLU, validade, tara, informação nutricional e envio à balança (CAD-16). */
export async function saveScaleDataAction(fd: FormData) {
  const id = fstr(fd, "productId");
  return runAction({ module: "products", op: "edit", revalidate: [`/produtos/${id}`, "/produtos/balanca"] }, async (s) => {
    await requireFeature(s, "balanca");
    const nutrition: Record<string, string> = { portion: fstr(fd, "nutrition.portion") };
    for (const f of NUTRITION_FIELDS) nutrition[f.key] = fstr(fd, `nutrition.${f.key}`);
    await saveScaleData(s.ctx, id, {
      plu: optInt(fd, "plu"),
      shelfLifeDays: optInt(fd, "shelfLifeDays"),
      scaleTare: optInt(fd, "scaleTare"),
      scaleEnabled: fbool(fd, "scaleEnabled"),
      nutrition,
    });
    return { ok: true as const, message: "Dados de balança salvos." };
  });
}

/** Produtos › Balança: gera o arquivo de carga e devolve o arquivo para download (/api/files/<id>). */
export async function generateScaleLoadAction(fd: FormData) {
  return runAction({ module: "products", op: "edit", revalidate: ["/produtos/balanca"] }, async (s) => {
    await requireFeature(s, "balanca");
    const r = await generateScaleLoad(s.ctx, { format: fstr(fd, "format") as ScaleFileFormat, priceTableId: fopt(fd, "priceTableId") });
    return {
      ok: true as const,
      data: r,
      message: `Arquivo ${r.fileName} gerado com ${r.count} item(ns)${r.skipped.length ? ` — ${r.skipped.length} produto(s) com pendência ficaram fora` : ""}.`,
    };
  });
}
