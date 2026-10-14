"use server";

import { runAction, fstr, fopt } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { BusinessError } from "@/lib/core/errors";
import { importCteXml } from "@/domain/freight-cte";

const PATHS = ["/compras/cte", "/compras/recebimentos", "/financeiro/pagar", "/fiscal/entradas"];

/** Importa o XML do CT-e de frete, vincula aos recebimentos e gera a conta a pagar à transportadora. */
export async function importCteAction(fd: FormData) {
  return runAction({ module: "purchases", requireBranch: true, revalidate: PATHS }, async (s) => {
    await requireFeature(s, "cteEntrada");
    const file = fd.get("xml");
    if (!(file instanceof File) || file.size === 0) return { ok: false as const, error: "Selecione o arquivo XML do CT-e." };
    if (file.size > 5_000_000) return { ok: false as const, error: "Arquivo muito grande (máx. 5 MB)." };
    const xml = await file.text();
    try {
      const r = await importCteXml(s.ctx, {
        xml,
        fileName: file.name,
        receiptIds: fd.getAll("receiptIds").map(String).filter(Boolean),
        entryCfop: fopt(fd, "entryCfop"),
        paymentTermId: fstr(fd, "paymentTermId") === "__carrier" ? undefined : fopt(fd, "paymentTermId"),
        categoryId: fopt(fd, "categoryId"),
        notes: fopt(fd, "notes"),
      });
      return { ok: true as const, message: `CT-e nº ${r.cteNumber} lançado: frete rateado e conta a pagar gerada.`, redirect: `/compras/cte/${r.id}` };
    } catch (e) {
      if (e instanceof BusinessError && e.code === "duplicate" && (e.details as any)?.id) return { ok: true as const, message: `${e.message} Abrindo o lançamento existente (nada foi duplicado).`, redirect: `/compras/cte/${(e.details as any).id}` };
      throw e;
    }
  });
}
