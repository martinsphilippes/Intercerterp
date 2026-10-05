import Link from "next/link";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { EmptyState } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { formatBps } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { categoryPath, CSOSN_OPTIONS, CST_ICMS_OPTIONS } from "@/domain/products";
import { AuxDialog } from "./aux-forms";
import { setAuxStatusAction, deleteAuxAction } from "./actions";

export const metadata = { title: "Cadastros auxiliares" };

type Coll = "categories" | "brands" | "units" | "price_tables" | "tax_groups";

function RowActions({ collection, id, active, used, canEdit, canDelete, kindLabel }: { collection: Coll; id: string; active: boolean; used: number; canEdit: boolean; canDelete: boolean; kindLabel: string }) {
  return (
    <span className="flex justify-end gap-1">
      {canEdit &&
        (active ? (
          <ActionButton size="sm" variant="ghost" action={setAuxStatusAction.bind(null, collection, id, false)} label="Inativar" confirm={`Inativar ${kindLabel}? Registros existentes continuam com a referência.`} />
        ) : (
          <ActionButton size="sm" variant="ghost" action={setAuxStatusAction.bind(null, collection, id, true)} label="Reativar" />
        ))}
      {canDelete && used === 0 && <ActionButton size="sm" variant="ghost" action={deleteAuxAction.bind(null, collection, id)} label="Excluir" confirm={`Excluir ${kindLabel}? Só é permitido sem uso.`} />}
    </span>
  );
}

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("products");
  const { tab = "categorias" } = await searchParams;
  const ctx = s.ctx;
  const cf = [["eq", "companyId", ctx.companyId]] as any[];
  const [categories, brands, units, tables, groups, products, prices] = await Promise.all([
    listAll(ctx.store, "categories", { filters: cf }),
    listAll(ctx.store, "brands", { filters: cf, orderBy: [{ field: "name", dir: "asc" }] }),
    listAll(ctx.store, "units", { filters: cf, orderBy: [{ field: "code", dir: "asc" }] }),
    listAll(ctx.store, "price_tables", { filters: cf, orderBy: [{ field: "name", dir: "asc" }] }),
    listAll(ctx.store, "tax_groups", { filters: cf, orderBy: [{ field: "name", dir: "asc" }] }),
    listAll(ctx.store, "products", { filters: cf }),
    listAll(ctx.store, "prices", { filters: cf }),
  ]);
  const count = (pred: (p: any) => boolean) => products.filter(pred).length;
  const canCreate = can(s.user, "products", "create");
  const canEdit = can(s.user, "products", "edit");
  const canDelete = can(s.user, "products", "delete");
  const catOpts = categories.map((c) => ({ value: c.id, label: categoryPath(categories, c.id) })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const base = "/produtos/cadastros";
  return (
    <>
      <PageHeader title="Cadastros auxiliares" crumbs={[{ label: "Produtos", href: "/produtos" }, { label: "Cadastros auxiliares" }]} description="Categorias, marcas, unidades, tabelas de preço e grupos tributários usados no cadastro de produtos. Itens em uso são inativados, não excluídos." />
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "categorias", label: "Categorias", count: categories.length },
          { key: "marcas", label: "Marcas", count: brands.length },
          { key: "unidades", label: "Unidades", count: units.length },
          { key: "tabelas", label: "Tabelas de preço", count: tables.length },
          { key: "grupos", label: "Grupos tributários", count: groups.length },
        ]}
      />
      {tab === "categorias" && (
        <Card title="Categorias" description="Hierarquia com categoria pai; filtros por categoria incluem as subcategorias." actions={canCreate && <AuxDialog kind="categoria" parents={catOpts} />} bodyClass="p-0">
          {categories.length === 0 ? <EmptyState title="Nenhuma categoria" /> : (
            <table className="table-base w-full text-sm">
              <thead><tr><th>Categoria</th><th className="text-right">Produtos</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {catOpts.map((o) => {
                  const c = categories.find((x) => x.id === o.value)!;
                  const used = count((p) => p.categoryId === c.id) + categories.filter((x) => x.parentId === c.id).length;
                  return (
                    <tr key={c.id}>
                      <td>{o.label}</td>
                      <td className="tabular text-right"><Link className="text-brand-700 hover:underline" href={`/produtos?category=${c.id}`}>{count((p) => p.categoryId === c.id)}</Link></td>
                      <td><StatusBadge kind="generic" status={c.status ?? "active"} /></td>
                      <td className="whitespace-nowrap text-right"><div className="flex items-center justify-end gap-1">{canEdit && <AuxDialog kind="categoria" row={c} parents={catOpts} />}<RowActions collection="categories" id={c.id} active={c.status !== "inactive"} used={used} canEdit={canEdit} canDelete={canDelete} kindLabel="a categoria" /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "marcas" && (
        <Card title="Marcas" actions={canCreate && <AuxDialog kind="marca" />} bodyClass="p-0">
          {brands.length === 0 ? <EmptyState title="Nenhuma marca" /> : (
            <table className="table-base w-full text-sm">
              <thead><tr><th>Marca</th><th className="text-right">Produtos</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {brands.map((b) => {
                  const used = count((p) => p.brandId === b.id);
                  return (
                    <tr key={b.id}>
                      <td>{b.name}</td>
                      <td className="tabular text-right"><Link className="text-brand-700 hover:underline" href={`/produtos?brand=${b.id}`}>{used}</Link></td>
                      <td><StatusBadge kind="generic" status={b.status ?? "active"} /></td>
                      <td className="whitespace-nowrap text-right"><div className="flex items-center justify-end gap-1">{canEdit && <AuxDialog kind="marca" row={b} />}<RowActions collection="brands" id={b.id} active={b.status !== "inactive"} used={used} canEdit={canEdit} canDelete={canDelete} kindLabel="a marca" /></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {tab === "unidades" && (
        <Card title="Unidades de medida" description="Quantidades são guardadas em milésimos da unidade; conversões (ex.: 1 CX = 12 UN) ficam no cadastro de cada produto." actions={canCreate && <AuxDialog kind="unidade" />} bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead><tr><th>Código</th><th>Descrição</th><th className="text-right">Casas decimais</th><th className="text-right">Produtos</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {units.map((u) => {
                const used = count((p) => p.unitCode === u.code);
                return (
                  <tr key={u.id}>
                    <td className="font-mono">{u.code}</td>
                    <td>{u.name}</td>
                    <td className="tabular text-right">{u.decimals ?? 0}</td>
                    <td className="tabular text-right">{used}</td>
                    <td><StatusBadge kind="generic" status={u.status ?? "active"} /></td>
                    <td className="whitespace-nowrap text-right"><div className="flex items-center justify-end gap-1">{canEdit && <AuxDialog kind="unidade" row={u} />}<RowActions collection="units" id={u.id} active={u.status !== "inactive"} used={used} canEdit={canEdit} canDelete={canDelete} kindLabel="a unidade" /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {tab === "tabelas" && (
        <Card title="Tabelas de preço" description="Uma tabela padrão ativa. Preços por SKU, filial e vigência ficam no cadastro de cada produto." actions={canCreate && <AuxDialog kind="tabela" />} bodyClass="p-0">
          <table className="table-base w-full text-sm">
            <thead><tr><th>Tabela</th><th>Tipo</th><th className="text-right">Preços</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {tables.map((t) => {
                const used = prices.filter((p) => p.priceTableId === t.id).length;
                return (
                  <tr key={t.id}>
                    <td>{t.name}{t.isDefault && <Badge tone="brand" className="ml-2">Padrão</Badge>}</td>
                    <td>{({ retail: "Varejo", wholesale: "Atacado / revenda", promo: "Promocional" } as Record<string, string>)[t.kind] ?? "Outra"}</td>
                    <td className="tabular text-right">{used}</td>
                    <td><StatusBadge kind="generic" status={t.active ? "active" : "inactive"} /></td>
                    <td className="whitespace-nowrap text-right"><div className="flex items-center justify-end gap-1">{canEdit && <AuxDialog kind="tabela" row={t} />}{!t.isDefault && <RowActions collection="price_tables" id={t.id} active={t.active} used={used} canEdit={canEdit} canDelete={canDelete} kindLabel="a tabela" />}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {tab === "grupos" && (
        <Card title="Grupos tributários" description="CFOP por operação e CST/CSOSN conforme o regime; alíquotas por grupo — nada é fixo para todos os produtos." actions={canCreate && <AuxDialog kind="grupo" cstSimples={CSOSN_OPTIONS} cstNormal={CST_ICMS_OPTIONS} />} bodyClass="p-0">
          {groups.length === 0 ? <EmptyState title="Nenhum grupo tributário" /> : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead><tr><th>Grupo</th><th>Regime</th><th>CST/CSOSN</th><th>CFOP interna · interestadual · devolução</th><th className="text-right">ICMS</th><th className="text-right">PIS · COFINS</th><th>Vigência</th><th className="text-right">Produtos</th><th>Situação</th><th /></tr></thead>
                <tbody>
                  {groups.map((g) => {
                    const used = count((p) => p.taxGroupId === g.id);
                    return (
                      <tr key={g.id}>
                        <td>{g.name}</td>
                        <td>{g.regime === "normal" ? "Normal" : "Simples"}</td>
                        <td className="font-mono">{g.cstCsosn ?? "—"}</td>
                        <td className="font-mono text-xs">{[g.cfopInternal, g.cfopInterstate, g.cfopReturn].map((x) => x ?? "—").join(" · ")}</td>
                        <td className="tabular text-right">{formatBps(g.icmsRateBps)}</td>
                        <td className="tabular text-right text-xs">{formatBps(g.pisRateBps)} · {formatBps(g.cofinsRateBps)}</td>
                        <td className="text-xs">{g.validFrom || g.validTo ? `${formatDate(g.validFrom)} a ${formatDate(g.validTo)}` : "—"}</td>
                        <td className="tabular text-right">{used}</td>
                        <td><StatusBadge kind="generic" status={g.active === false ? "inactive" : "active"} /></td>
                        <td className="whitespace-nowrap text-right"><div className="flex items-center justify-end gap-1">{canEdit && <AuxDialog kind="grupo" row={g} cstSimples={CSOSN_OPTIONS} cstNormal={CST_ICMS_OPTIONS} />}<RowActions collection="tax_groups" id={g.id} active={g.active !== false} used={used} canEdit={canEdit} canDelete={canDelete} kindLabel="o grupo" /></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
