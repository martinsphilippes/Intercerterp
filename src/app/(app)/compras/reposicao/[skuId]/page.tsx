import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Info } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { formatMoney, formatQty } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { sp, type SearchParams } from "@/lib/list";
import { computeBranchReplenishment, replenishmentSettings } from "@/domain/replenishment";
import { SimulationForm } from "./simulation-form";

export const metadata = { title: "Detalhe da sugestão de reposição" };

function Ind({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "warn" | "bad" | "good" }) {
  return (
    <div className="rounded-md border border-line bg-white p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`tabular mt-0.5 text-lg font-semibold ${tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-emerald-700" : "text-ink"}`}>{value}</p>
    </div>
  );
}

export default async function Page({ params, searchParams }: { params: Promise<{ skuId: string }>; searchParams: Promise<SearchParams> }) {
  const s = await requireSession("purchases");
  const { skuId } = await params;
  const qp = await searchParams;
  const sku = await s.ctx.store.get("skus", skuId);
  if (!sku || sku.companyId !== s.ctx.companyId) notFound();
  const branchId = sp(qp, "branch") || s.ctx.branchId || s.branches[0]?.id;
  const branch = s.branches.find((b) => b.id === branchId);
  if (!branch) notFound();
  const cfg = await replenishmentSettings(s.ctx.store, s.ctx.companyId, branchId);
  const coverageDays = Number(sp(qp, "cobertura")) || cfg.coverageDays;
  const historyDays = Number(sp(qp, "historico")) || cfg.historyDays;
  const supplierSim = sp(qp, "fornecedor") || null;
  const costSim = sp(qp, "custo") !== "" ? Number(sp(qp, "custo")) : null;
  const leadSim = sp(qp, "prazo") !== "" ? Number(sp(qp, "prazo")) : null;
  const simulated = supplierSim != null || costSim != null || leadSim != null;
  const [r] = await computeBranchReplenishment(s.ctx.store, s.ctx.companyId, { branchId, coverageDays, historyDays, skuIds: [skuId], supplierId: supplierSim, costOverride: costSim, leadOverride: leadSim });
  const back = `/compras/reposicao?branch=${branchId}&cobertura=${coverageDays}&historico=${historyDays}`;
  if (!r)
    return (
      <>
        <PageHeader title={sku.name ?? sku.sku} crumbs={[{ label: "Reposição", href: back }, { label: sku.sku }]} />
        <p className="text-sm text-slate-600">Produto sem cálculo de reposição (serviço, inativo ou sem vínculo com o fornecedor simulado). <Link className="text-brand-700 underline" href={`/compras/reposicao/${skuId}?branch=${branchId}`}>Limpar simulação</Link></p>
      </>
    );
  const avgDailyUnits = r.hasHistory ? r.netConsumption / historyDays / 1000 : 0;
  const lines = [
    ...r.confirmedLines.map((l) => ({ ...l, calc: "Considerado" as const })),
    ...r.outsideLines.map((l) => ({ ...l, calc: (l.expectedDate ? "Após o horizonte" : "Sem previsão") as string })),
    ...r.draftLines.map((l) => ({ ...l, calc: "Rascunho/análise — abatido da sugestão, não conta como estoque" })),
  ];
  return (
    <>
      <PageHeader
        title={r.name}
        crumbs={[{ label: "Reposição", href: back }, { label: "Detalhamento da sugestão" }]}
        description={`${r.sku} · ${branch.name} · unidade ${r.unitCode} · ABC ${r.abc ?? "—"}`}
        badges={<><StatusBadge kind="replenishment" status={r.situation} />{simulated && <Badge tone="accent">Simulação aplicada</Badge>}</>}
        actions={<Link href={back} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"><ArrowLeft className="size-4" /> Voltar</Link>}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Ind label="Estoque físico" value={formatQty(r.physical, r.unitCode)} />
        <Ind label="Reservas" value={formatQty(r.reserved, r.unitCode)} />
        <Ind label="Disponível" value={formatQty(r.available, r.unitCode)} tone={r.belowMin ? "warn" : undefined} />
        <Ind label="Consumo médio" value={r.hasHistory ? `${avgDailyUnits.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${r.unitCode}/dia` : "sem histórico"} tone={r.hasHistory ? undefined : "warn"} />
        <Ind label="Estoque mínimo" value={formatQty(r.minQty, r.unitCode)} />
        <Ind label="Alvo calculado" value={formatQty(r.target, r.unitCode)} />
        <Ind label="Confirmado no horizonte" value={formatQty(r.confirmedInHorizon, r.unitCode)} />
        <Ind label="Já em rascunho" value={formatQty(r.draftQty, r.unitCode)} />
        <Ind label="Sugestão de compra" value={formatQty(r.suggested, r.unitCode)} tone="good" />
      </div>
      <p className="mt-4 flex items-start gap-2 rounded-md bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Horizonte: <b>{r.horizonDays} dias</b> ({r.leadTimeDays} de prazo — {r.leadTimeSource} — + {r.coverageDays} de cobertura), até <b>{formatDate(r.horizonEnd)}</b> · Lote mínimo: <b>{r.supplierMinQty ? formatQty(r.supplierMinQty, r.unitCode) : "—"}</b> · Múltiplo de compra: <b>{r.multiple ? formatQty(r.multiple, r.unitCode) : "—"}</b>
        </span>
      </p>
      {r.shortageBeforeArrival && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />O consumo projetado pode esgotar o saldo em {formatDate(r.stockoutDate)}, antes {r.nextArrival ? `da próxima entrega (${formatDate(r.nextArrival)})` : "do prazo de uma nova compra"}. Avalie antecipar entregas ou transferir estoque.
        </p>
      )}
      {r.outsideLines.length > 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />Há entrega fora do horizonte ({formatQty(r.confirmedOutside, r.unitCode)}). Confira a possibilidade de antecipá-la antes de acrescentar outra compra.
        </p>
      )}
      {r.limitation && <p className="mt-3 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-900">{r.limitation}</p>}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Pedidos já em aberto" bodyClass="p-0">
          {lines.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">Nenhum pedido com saldo a receber.</p>
          ) : (
            <table className="table-base w-full text-sm">
              <thead><tr><th>Pedido</th><th className="text-right">Saldo a receber</th><th>Previsão</th><th>No cálculo</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.orderId}>
                    <td><Link className="text-brand-700 hover:underline" href={`/compras/pedidos/${l.orderId}`}>nº {l.number}</Link><span className="block text-xs text-slate-500">{l.supplierName} · <StatusBadge kind="purchase" status={l.status} /></span></td>
                    <td className="tabular text-right">{formatQty(l.remaining, r.unitCode)}</td>
                    <td>{formatDate(l.expectedDate)}</td>
                    <td className="text-xs">{l.calc === "Considerado" ? <Badge tone="good">Considerado</Badge> : l.calc.startsWith("Rascunho") ? <span className="text-slate-500">{l.calc}</span> : <Badge tone="warn">{l.calc}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Como a sugestão foi calculada">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
            <li>Consumo: {formatQty(r.soldQty)} vendido(s) − {formatQty(r.returnedQty)} devolvido(s) = {formatQty(r.netConsumption)} em {historyDays} dias → {r.hasHistory ? `${avgDailyUnits.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} ${r.unitCode}/dia` : "sem histórico"}.</li>
            <li>Previsão no horizonte: ⌈{avgDailyUnits.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} × {r.horizonDays}⌉ = {formatQty(r.forecast)}.</li>
            <li>Alvo = máx(mínimo {formatQty(r.minQty)}, {r.hasHistory ? `previsão ${formatQty(r.forecast)}` : `alvo cadastrado ${formatQty(r.targetQty)}`}) + segurança {formatQty(r.safetyQty)} = <b>{formatQty(r.target)}</b>.</li>
            <li>Necessidade = máx(0, {formatQty(r.target)} − disponível {formatQty(r.available)} − confirmado {formatQty(r.confirmedInHorizon)}) = <b>{formatQty(r.grossNeed)}</b>.</li>
            <li>Após rascunhos/análise ({formatQty(r.draftQty)}): {formatQty(r.afterDrafts)}.</li>
            <li>Arredondamento ao lote mínimo {r.supplierMinQty ? formatQty(r.supplierMinQty) : "—"} e múltiplo {r.multiple ? formatQty(r.multiple) : "—"}: <b>{formatQty(r.suggested, r.unitCode)}</b> · estimativa {formatMoney(r.suggestedCost)} ({formatMoney(r.unitCost)}/{r.unitCode}).</li>
            <li>Cobertura do disponível: {r.daysOfCover != null ? `${r.daysOfCover} dia(s) — ruptura estimada em ${formatDate(r.stockoutDate)}` : "sem consumo para projetar"}.</li>
          </ol>
        </Card>
      </div>
      <Card className="mt-5" title="Parâmetros desta simulação" description="Fornecedor, custo e prazo valem só para esta prévia (não alteram cadastros). O rascunho criado usa os valores aplicados.">
        <SimulationForm
          skuId={skuId}
          branchId={branchId}
          coverageDays={coverageDays}
          historyDays={historyDays}
          supplierId={r.supplierId}
          unitCost={r.unitCost}
          leadTimeDays={r.leadTimeDays}
          suggested={r.suggested}
          options={r.supplierOptions.map((o) => ({ value: o.supplierId, label: `${o.name}${o.lastCost != null ? ` · ${formatMoney(o.lastCost)}` : ""}${o.leadTimeDays != null ? ` · ${o.leadTimeDays} d` : ""}${o.preferred ? " · preferencial" : ""}` }))}
          backHref={back}
        />
      </Card>
    </>
  );
}
