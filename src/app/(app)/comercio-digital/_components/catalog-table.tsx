"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/ui/link";
import { Badge } from "@/components/ui/badge";
import { buttonClass, Spinner } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/server/action";

export interface CatalogRowView {
  productId: string;
  name: string;
  code: string;
  category: string | null;
  available: string;
  price: string;
  inCatalog: boolean;
  published: boolean;
  blocking: string[];
  warnings: string[];
}

type Bulk = (fd: FormData) => Promise<ActionResult<any>>;

/** Tela 52: seleção de produtos do ERP com ações em lote (sem recarregar a página a cada clique). */
export function CatalogTable({ rows, canEdit, actions, query = "" }: { rows: CatalogRowView[]; canEdit: boolean; actions: { add: Bulk; publish: Bulk; unpublish: Bulk; validate: Bulk }; query?: string }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const all = useMemo(() => rows.map((r) => r.productId), [rows]);
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const run = (key: string, action: Bulk) => {
    if (!sel.size) {
      toast("error", "Selecione ao menos um produto.");
      return;
    }
    const fd = new FormData();
    for (const id of sel) fd.append("productIds", id);
    setBusy(key);
    start(async () => {
      const r = await action(fd);
      setBusy(null);
      if (!r.ok) toast("error", r.error);
      else {
        toast("success", r.message ?? "Feito.");
        setSel(new Set());
        router.refresh();
      }
    });
  };
  const allChecked = sel.size > 0 && sel.size === all.length;
  return (
    <div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <span className="text-sm text-slate-600" aria-live="polite">{sel.size ? `${sel.size} selecionado(s)` : "Selecione produtos para as ações em lote"}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" disabled={pending} onClick={() => run("add", actions.add)} className={buttonClass("secondary", "sm")}>{busy === "add" && <Spinner />} Incluir no catálogo</button>
            <button type="button" disabled={pending} onClick={() => run("publish", actions.publish)} className={buttonClass("secondary", "sm")}>{busy === "publish" && <Spinner />} Colocar na vitrine</button>
            <button type="button" disabled={pending} onClick={() => run("unpublish", actions.unpublish)} className={buttonClass("ghost", "sm")}>{busy === "unpublish" && <Spinner />} Retirar da vitrine</button>
            <button type="button" disabled={pending} onClick={() => run("validate", actions.validate)} className={buttonClass("accent", "sm")}>{busy === "validate" && <Spinner />} Validar seleção para envio</button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table-base w-full text-sm">
          <thead>
            <tr>
              {canEdit && (
                <th className="w-10">
                  <input type="checkbox" aria-label="Selecionar todos" checked={allChecked} onChange={() => setSel(allChecked ? new Set() : new Set(all))} />
                </th>
              )}
              <th>Produto / SKU</th>
              <th>Estoque ERP</th>
              <th>Preço on-line</th>
              <th>Vitrine</th>
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId} className={sel.has(r.productId) ? "bg-brand-50/60" : undefined}>
                {canEdit && (
                  <td>
                    <input type="checkbox" aria-label={`Selecionar ${r.name}`} checked={sel.has(r.productId)} onChange={() => toggle(r.productId)} />
                  </td>
                )}
                <td>
                  <span className="block font-medium text-ink">{r.name}</span>
                  <span className="block text-xs text-slate-500">{[r.code, r.category].filter(Boolean).join(" · ")}</span>
                </td>
                <td className="tabular">{r.available}</td>
                <td className="tabular">{r.price}</td>
                <td>
                  {!r.inCatalog ? (
                    <Badge>Fora do catálogo</Badge>
                  ) : r.blocking.length ? (
                    <Badge tone="warn" title={r.blocking.join("; ")}>{r.blocking[0]}{r.blocking.length > 1 ? ` +${r.blocking.length - 1}` : ""}</Badge>
                  ) : r.published ? (
                    <Badge tone="good">Na vitrine</Badge>
                  ) : (
                    <Badge tone="info">No rascunho</Badge>
                  )}
                  {r.warnings.length > 0 && r.inCatalog && <span className="mt-0.5 block text-xs text-slate-500">{r.warnings.join("; ")}</span>}
                </td>
                <td className="text-right">
                  <Link href={`/comercio-digital/catalogo?${query ? `${query}&` : ""}editar=${r.productId}#editar`} className={buttonClass("secondary", "sm")} scroll={false}>
                    Editar
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
