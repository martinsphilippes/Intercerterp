import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { listAll } from "@/lib/db";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { lookups } from "@/lib/server/lookups";
import { today } from "@/lib/dates";
import { getFiscalConfig, DOC_STATUS_LABEL } from "@/domain/fiscal/service";
import { LC116_COMMON } from "@/domain/fiscal/lc116";
import { NfseForm } from "./nfse-form";

export const metadata = { title: "Emitir NFS-e" };

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string; cliente?: string; servico?: string }> }) {
  const s = await requireSession("fiscal", "create");
  const sp = await searchParams;
  if (!s.branch)
    return (
      <>
        <PageHeader title="Emitir nova NFS-e" crumbs={[{ label: "Fiscal" }, { label: "NFS-e", href: "/fiscal/nfse" }, { label: "Emitir" }]} />
        <Notice tone="warn">Selecione uma filial específica no topo da tela: o contexto consolidado é somente consulta.</Notice>
      </>
    );
  let doc: Record<string, any> | null = null;
  if (sp.id) {
    const d = await s.ctx.store.get("fiscal_documents", sp.id);
    if (!d || d.companyId !== s.ctx.companyId || d.model !== "nfse") redirect("/fiscal/nfse");
    // edição só na filial do documento (o detalhe orienta a trocar a filial)
    if (!["draft", "pending", "rejected"].includes(d.status) || d.branchId !== s.branch.id) redirect(`/fiscal/nfse/${d.id}`);
    doc = d;
  }
  const cfg = await getFiscalConfig(s.ctx.store, s.ctx.companyId, s.branch.id);
  const [customers, products, categories] = await Promise.all([
    listAll(s.ctx.store, "customers", { filters: [["eq", "companyId", s.ctx.companyId], ["ne", "status", "inactive"]], orderBy: [{ field: "name" }] }),
    listAll(s.ctx.store, "products", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "type", "service"]] }),
    lookups.finCategories(s.ctx, "revenue"),
  ]);
  const skus = products.length ? await listAll(s.ctx.store, "skus", { filters: [["eq", "productId", products.map((p) => p.id)]] }) : [];
  const prices = skus.length && s.branch.defaultPriceTableId ? await listAll(s.ctx.store, "prices", { filters: [["eq", "priceTableId", s.branch.defaultPriceTableId], ["eq", "skuId", skus.map((k) => k.id)]] }) : [];
  const priceByProduct = new Map(prices.map((p) => [p.productId, p.price]));
  const services = products.filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name, serviceListItem: p.serviceListItem ?? "", municipalCode: p.municipalServiceCode ?? "", issRateBps: p.issRateBps ?? 0, price: priceByProduct.get(p.id) ?? 0, description: p.description ?? p.name }));
  const lc = new Map(LC116_COMMON.map((i) => [i.code, `${i.code} — ${i.label}`]));
  for (const sv of services) if (sv.serviceListItem && !lc.has(sv.serviceListItem)) lc.set(sv.serviceListItem, `${sv.serviceListItem} — (serviço cadastrado: ${sv.name})`);
  const lc116 = [...lc.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true })).map(([value, label]) => ({ value, label }));
  if (!doc && (sp.cliente || sp.servico)) {
    const c = sp.cliente ? customers.find((x) => x.id === sp.cliente) : null;
    const sv = sp.servico ? services.find((x) => x.id === sp.servico) : null;
    doc = {
      partyId: c?.id ?? null,
      recipient: c ? { name: c.name, doc: c.doc, im: c.im, email: c.email, address: c.addresses?.[0] ?? {} } : {},
      service: sv ? { productId: sv.id, serviceListItem: sv.serviceListItem, municipalCode: sv.municipalCode, issRateBps: sv.issRateBps, amount: sv.price, description: sv.description } : {},
    };
  }
  return (
    <>
      <PageHeader
        title={doc?.id ? (doc.status === "rejected" ? "Corrigir NFS-e rejeitada" : "Editar NFS-e") : "Emitir nova NFS-e"}
        crumbs={[{ label: "Fiscal" }, { label: "NFS-e", href: "/fiscal/nfse" }, { label: doc?.id ? "Editar" : "Emitir" }]}
        description="Tomador, serviço, competência, valores e retenções no mesmo formulário. Base, ISS, retenções e líquido calculados por calcNfse (o servidor recalcula ao salvar)."
      />
      {!cfg && <div className="mb-4"><Notice tone="warn">Configuração fiscal não cadastrada: a NFS-e ficará pendente. <Link className="underline" href="/fiscal/configuracoes">Configurar</Link></Notice></div>}
      {cfg && cfg.nfseEnabled === false && <div className="mb-4"><Notice tone="warn">Emissão de NFS-e desabilitada na configuração fiscal desta filial.</Notice></div>}
      {doc?.status && doc.status !== "draft" && <div className="mb-4"><Notice tone="bad" title={DOC_STATUS_LABEL[doc.status]}>{doc.statusMessage} — corrija e use “Emitir NFS-e” (mesma referência {doc.ref}).</Notice></div>}
      <NfseForm
        doc={doc}
        tomadores={customers.map((c) => ({ id: c.id, name: c.name, doc: c.doc ?? "", im: c.im ?? "", email: c.email ?? "", address: c.addresses?.[0] ?? {} }))}
        services={services}
        lc116={lc116}
        categories={categories}
        prestador={`${s.company.name} • ${s.branch.cityName ?? "—"}/${s.branch.uf ?? "—"} • IM ${s.branch.im ?? s.company.im ?? "—"}`}
        branchCity={{ code: s.branch.cityCode ?? "", name: s.branch.cityName ?? "", uf: s.branch.uf ?? "" }}
        standard={cfg?.nfseStandard ?? "municipal"}
        today={today()}
      />
    </>
  );
}
