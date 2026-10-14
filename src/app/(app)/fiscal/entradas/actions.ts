"use server";

import { runAction, fstr, fopt, fint, fbool } from "@/lib/server/action";
import { requireFeature } from "@/lib/server/features";
import { BusinessError } from "@/lib/core/errors";
import { createNoStockEntry } from "@/domain/no-stock-entries";

const PATHS = ["/fiscal/entradas", "/compras/recebimentos", "/financeiro/pagar"];

/** Nota de entrada sem estoque (serviço tomado, uso e consumo, despesa com nota) — com XML ou digitada. */
export async function createNoStockEntryAction(fd: FormData) {
  return runAction({ module: "purchases", requireBranch: true, revalidate: PATHS }, async (s) => {
    await requireFeature(s, "livroEntradas");
    const file = fd.get("xml");
    const hasFile = file instanceof File && file.size > 0;
    if (hasFile && file.size > 5_000_000) return { ok: false as const, error: "Arquivo muito grande (máx. 5 MB)." };
    const xml = hasFile ? await (file as File).text() : null;
    const optInt = (k: string) => (fstr(fd, k) === "" ? null : fint(fd, k));
    try {
      const r = await createNoStockEntry(s.ctx, {
        idemKey: fstr(fd, "_idem"),
        xml,
        fileName: hasFile ? (file as File).name : null,
        supplierId: fopt(fd, "supplierId"),
        docModel: (fstr(fd, "docModel") || "other") as "55" | "nfse" | "other",
        nfeKey: fopt(fd, "nfeKey"),
        number: fopt(fd, "number"),
        series: fopt(fd, "series"),
        issueDate: fopt(fd, "issueDate"),
        cfop: fopt(fd, "cfop"),
        description: fopt(fd, "description"),
        total: optInt("total"),
        icmsBase: optInt("icmsBase"),
        icms: optInt("icms"),
        ipi: optInt("ipi"),
        st: optInt("st"),
        categoryId: fopt(fd, "categoryId"),
        costCenterId: fopt(fd, "costCenterId"),
        paymentTermId: fstr(fd, "paymentTermId") === "__supplier" ? undefined : fopt(fd, "paymentTermId"),
        paymentMethodId: fopt(fd, "paymentMethodId"),
        createPayable: fbool(fd, "createPayable"),
        notes: fopt(fd, "notes"),
      });
      return { ok: true as const, message: `Nota de entrada sem estoque registrada (nº ${r.number}).`, redirect: `/compras/recebimentos/${r.id}` };
    } catch (e) {
      if (e instanceof BusinessError && e.code === "duplicate" && (e.details as any)?.id) return { ok: false as const, error: `${e.message} Abra o recebimento existente em Compras › Recebimentos.` };
      throw e;
    }
  });
}
