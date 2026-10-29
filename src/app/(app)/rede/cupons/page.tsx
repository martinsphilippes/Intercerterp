import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { listAll } from "@/lib/db";
import { unscoped } from "@/lib/db/scoped-store";
import { formatDate } from "@/lib/dates";
import { canDo } from "@/lib/permissions";
import { certificationSettings } from "@/domain/accounting";
import { describeCoupon, listCoupons, networkViewer } from "@/domain/network";
import { requireNetworkSession } from "../shared";
import { CouponForm, CouponToggle } from "./forms";

export const metadata = { title: "Cupons da rede" };

const STATUS: Record<string, [string, "good" | "neutral" | "warn" | "bad" | "info"]> = { active: ["ativo", "good"], inactive: ["inativo", "neutral"], expired: ["vencido", "bad"], scheduled: ["agendado", "info"], exhausted: ["esgotado", "warn"] };

export default async function Page() {
  const s = await requireNetworkSession();
  const v = await networkViewer(s.ctx);
  const crumbs = [{ label: "Rede de certificação", href: v.platform ? "/rede" : "/rede/minha" }, { label: "Cupons" }];
  const manage = v.platform || canDo(s.user, "network.coupons");
  if (!manage && !canDo(s.user, "network.sales_all")) {
    return (
      <>
        <PageHeader title="Cupons" crumbs={crumbs} />
        <Notice tone="warn">Cupons são criados pelo administrador ou gestor do parceiro (operação “Criar e gerir cupons”). Na venda, basta digitar o código.</Notice>
      </>
    );
  }
  const [rows, settings] = await Promise.all([listCoupons(s.ctx), certificationSettings(s.ctx.store)]);
  const label = (k: string | null) => (k ? (settings.catalog.find((p) => p.key === k)?.label ?? k) : "qualquer produto");
  const nodes = v.nodes.filter((n) => v.visible.has(n.id) && n.status === "active" && n.level !== "contador");
  const sellers: Array<{ value: string; label: string; nodeId: string }> = [];
  for (const n of nodes) {
    for (const u of await listAll(unscoped(s.ctx.store), "users", { filters: [["eq", "companyIds", n.nodeCompanyId], ["eq", "status", "active"]] })) sellers.push({ value: u.id, label: u.name, nodeId: n.id });
  }
  const canCreate = manage && (v.platform || (v.myNode && v.myNode.status === "active"));
  return (
    <>
      <PageHeader title="Cupons" crumbs={crumbs} description="Descontos para as vendas do seu nó e dos parceiros abaixo. O emissor do cupom fica registrado no retrato de cada venda." />
      {canCreate && (
        <Card title="Novo cupom" className="mb-4">
          <CouponForm products={settings.catalog.filter((p) => p.active && !p.free).map((p) => ({ value: p.key, label: p.label }))} nodes={nodes.map((n) => ({ value: n.id, label: n.name }))} sellers={sellers} platform={v.platform} />
        </Card>
      )}
      <Card title="Cupons" bodyClass="p-0">
        {rows.length === 0 ? <p className="p-4 text-sm text-slate-500">Nenhum cupom.</p> : (
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2"><span className="font-mono font-semibold">{c.code}</span><Badge tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge><span>{describeCoupon(c)}</span></p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {c.nodeName ? `${c.nodeName} e abaixo` : "Toda a rede"}{c.sellerName ? ` · vendedor ${c.sellerName}` : ""} · {label(c.productKey)} · {formatDate(c.validFrom)} a {formatDate(c.validTo)} · emitido por {c.issuerName}
                  </p>
                  <p className="text-xs text-slate-500">Usos: {Number(c.usedCount ?? 0)}{c.maxUses ? ` de ${c.maxUses}` : ""}{c.maxPerHolder ? ` · ${c.maxPerHolder} por titular` : ""}</p>
                </div>
                {c.manageable && <CouponToggle id={c.id} active={c.active !== false} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
