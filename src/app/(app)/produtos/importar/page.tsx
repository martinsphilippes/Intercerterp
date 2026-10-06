import Link from "@/components/ui/link";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { listAll } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { nameMap } from "@/lib/server/lookups";
import { IMPORT_MODES } from "@/domain/product-import";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Importar produtos" };

export default async function Page() {
  const s = await requireSession("products", "create");
  const imports = await listAll(s.ctx.store, "product_imports", { filters: [["eq", "companyId", s.ctx.companyId]], orderBy: [{ field: "createdAt", dir: "desc" }] }, 30);
  const users = await nameMap(s.ctx, "users");
  const modeLabel = new Map(IMPORT_MODES.map((m) => [m.value, m.label]));
  return (
    <>
      <PageHeader
        title="Importar produtos (CSV)"
        crumbs={[{ label: "Produtos", href: "/produtos" }, { label: "Importar" }]}
        description="Mapeie as colunas, confira a prévia linha a linha e importe com uma política de atualização explícita. Reenviar a mesma importação não duplica produtos."
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ImportWizard modes={IMPORT_MODES} />
        <Card title="Importações anteriores" bodyClass="p-0">
          {imports.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Nenhuma importação realizada.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {imports.map((i) => (
                <li key={i.id} className="px-4 py-3">
                  <Link href={`/produtos/importar/${i.id}`} className="font-medium text-brand-700 hover:underline">
                    Nº {i.number} — {i.fileName}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(i.createdAt)} · {users.get(i.createdBy) ?? "—"} · {modeLabel.get(i.mode) ?? i.mode} ({i.matchBy === "sku" ? "por SKU" : "por código"})
                  </p>
                  {i.totals && (
                    <p className="tabular mt-1 text-xs">
                      {i.totals.create} criado(s) · {i.totals.update} atualizado(s) · {i.totals.skip} ignorado(s) · <span className={i.totals.error ? "text-red-700" : ""}>{i.totals.error} erro(s)</span>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
