import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { listAll } from "@/lib/db";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { lookups } from "@/lib/server/lookups";
import { getFiscalConfig, DOC_STATUS_LABEL } from "@/domain/fiscal/service";
import { docToInput, loadOrigin, partyRecipient, type NfeInput, type NfeOriginType } from "@/domain/fiscal/nfe";
import { BusinessError } from "@/lib/core/errors";
import { NfeWizard } from "./nfe-wizard";

export const metadata = { title: "Emitir NF-e" };

const NATURES = ["Venda de mercadoria", "Venda de mercadoria adquirida de terceiros", "Devolução de venda", "Devolução de mercadoria ao fornecedor", "Transferência de mercadoria entre filiais", "Remessa para conserto", "Remessa em bonificação", "Entrada de mercadoria", "Outras saídas"];

export default async function Page({ searchParams }: { searchParams: Promise<{ origem?: string; rascunho?: string }> }) {
  const s = await requireSession("fiscal", "create");
  const sp = await searchParams;
  if (!s.branch)
    return (
      <>
        <PageHeader title="Emitir nova NF-e" crumbs={[{ label: "Fiscal" }, { label: "NF-e", href: "/fiscal/nfe" }, { label: "Emitir" }]} />
        <Notice tone="warn">Selecione uma filial específica no topo da tela: o contexto consolidado é somente consulta.</Notice>
      </>
    );
  const branchId = s.branch.id;
  const cfg = await getFiscalConfig(s.ctx.store, s.ctx.companyId, branchId);
  let initial: NfeInput = {
    branchId,
    origin: { type: "manual" },
    nature: cfg?.defaultNature || "Venda de mercadoria",
    purpose: "normal",
    operationType: "saida",
    presence: cfg?.defaultPresence ?? "1",
    recipient: { partyType: "customer", name: "", doc: "", address: {}, finalConsumer: false },
    items: [],
    freight: 0,
    insurance: 0,
    other: 0,
    transport: { mode: "9" },
    payments: [],
    referencedKeys: [],
    effects: { stock: false, financial: false },
  };
  let draftId: string | null = null;
  let draftStatus: string | null = null;
  let savedAt: string | null = null;
  let effectsLocked = false;
  let originLabel: string | null = null;
  let originHref: string | null = null;
  let warnings: string[] = [];
  let blockers: string[] = [];
  let loadError: string | null = null;
  if (sp.rascunho) {
    const d = await s.ctx.store.get("fiscal_documents", sp.rascunho);
    if (!d || d.companyId !== s.ctx.companyId || d.model !== "nfe") loadError = "Rascunho não encontrado.";
    else if (!["draft", "pending", "rejected"].includes(d.status) || d.branchId !== branchId) redirect(`/fiscal/nfe/${d.id}`);
    else {
      initial = docToInput(d);
      draftId = d.id;
      draftStatus = d.status;
      savedAt = d.updatedAt;
      effectsLocked = ["sale", "transfer", "return"].includes(d.originType);
      if (d.originType !== "manual") {
        const o = await loadOrigin(s.ctx, d.originType as NfeOriginType, d.originId, branchId).catch(() => null);
        if (o) {
          originLabel = o.label;
          originHref = o.href;
        }
      }
    }
  } else if (sp.origem) {
    const [type, id] = sp.origem.split(":");
    try {
      if (!["sale", "transfer", "purchase_order", "return"].includes(type) || !id) throw new BusinessError("Origem inválida.");
      const o = await loadOrigin(s.ctx, type as NfeOriginType, id, branchId);
      if (o.existingDocId) {
        const ex = await s.ctx.store.get("fiscal_documents", o.existingDocId);
        if (ex && ["draft", "pending", "rejected"].includes(ex.status)) redirect(`/fiscal/nfe/nova?rascunho=${ex.id}`);
        if (ex) redirect(`/fiscal/nfe/${ex.id}`);
      }
      initial = { ...o.input, nature: o.input.nature };
      effectsLocked = o.effectsLocked;
      originLabel = o.label;
      originHref = o.href;
      warnings = o.warnings;
      blockers = o.blockers;
    } catch (e: any) {
      if (e?.digest?.startsWith?.("NEXT_REDIRECT")) throw e;
      loadError = e.message;
    }
  }
  const [customersRaw, suppliersRaw, taxGroups, warehouses, terms] = await Promise.all([
    listAll(s.ctx.store, "customers", { filters: [["eq", "companyId", s.ctx.companyId], ["ne", "status", "inactive"]], orderBy: [{ field: "name" }] }),
    listAll(s.ctx.store, "suppliers", { filters: [["eq", "companyId", s.ctx.companyId], ["ne", "status", "inactive"]], orderBy: [{ field: "name" }] }),
    lookups.taxGroups(s.ctx),
    lookups.warehouses(s.ctx, branchId),
    lookups.paymentTerms(s.ctx),
  ]);
  const skuIds = initial.items.map((i) => i.skuId);
  const skuNames: Record<string, { sku: string; name: string; unit: string; ncm: string }> = {};
  if (skuIds.length) {
    const skus = await listAll(s.ctx.store, "skus", { filters: [["eq", "id", skuIds]] });
    const prods = new Map((await listAll(s.ctx.store, "products", { filters: [["eq", "id", [...new Set(skus.map((k) => k.productId))]]] })).map((p) => [p.id, p]));
    for (const k of skus) skuNames[k.id] = { sku: k.sku, name: k.name ?? prods.get(k.productId)?.name ?? k.sku, unit: k.unitCode ?? "UN", ncm: prods.get(k.productId)?.ncm ?? "" };
  }
  const env = cfg?.provider === "simulated" ? "Simulação (sem validade fiscal)" : cfg?.environment === "producao" ? "Produção" : "Homologação";
  return (
    <>
      <PageHeader
        title={draftId ? (draftStatus === "rejected" ? "Corrigir NF-e rejeitada" : "Editar rascunho de NF-e") : "Emitir nova NF-e"}
        crumbs={[{ label: "Fiscal" }, { label: "NF-e", href: "/fiscal/nfe" }, { label: draftId ? "Rascunho" : "Emitir" }]}
        description="Preencha os dados, valide a tributação e transmita o documento. Totais e tributos são calculados no servidor."
        actions={draftId && <Link className="text-sm text-brand-700 underline" href={`/fiscal/nfe/${draftId}`}>Abrir documento</Link>}
      />
      {loadError && <div className="mb-4"><Notice tone="bad">{loadError}</Notice></div>}
      {!cfg && <div className="mb-4"><Notice tone="warn">Configuração fiscal da filial não cadastrada: o documento ficará pendente. <Link className="underline" href="/fiscal/configuracoes">Configurar</Link></Notice></div>}
      {draftStatus === "rejected" && <div className="mb-4"><Notice tone="bad" title={`Situação: ${DOC_STATUS_LABEL[draftStatus]}`}>Corrija os dados e use “Validar e transmitir”: a retransmissão usa a mesma referência e o mesmo número.</Notice></div>}
      <NfeWizard
        initial={initial}
        draftId={draftId}
        draftStatus={draftStatus}
        savedAt={savedAt}
        effectsLocked={effectsLocked}
        originLabel={originLabel}
        originHref={originHref}
        warnings={warnings}
        blockers={blockers}
        customers={customersRaw.map((c) => ({ id: c.id, name: `${c.name}${c.doc ? ` — ${c.doc}` : ""}`, recipient: partyRecipient(c, "customer") }))}
        suppliers={suppliersRaw.map((c) => ({ id: c.id, name: `${c.tradeName || c.name}${c.doc ? ` — ${c.doc}` : ""}`, recipient: partyRecipient(c, "supplier") }))}
        taxGroups={taxGroups}
        warehouses={warehouses}
        terms={terms}
        branchUf={s.branch.uf ?? s.branch.address?.uf ?? ""}
        context={`Modelo 55 · Série ${cfg?.nfeSeries ?? 1} · ${env} · ${s.branch.name}`}
        natures={NATURES}
        skuNames={skuNames}
      />
    </>
  );
}
