import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/empty";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { certificationSettings } from "@/domain/accounting";
import { CERT_HOLDERS, CERT_PRODUCT_TYPES, CERT_SUPPLIERS } from "@/domain/accounting/cert-catalog";
import { NETWORK_LEVELS, levelPriceTable, networkSettings, networkViewer } from "@/domain/network";
import { SettingsForm } from "@/app/(app)/administracao/certificacao/settings-form";
import { LevelTableEditor, requireNetworkSession } from "../shared";

export const metadata = { title: "Preços da rede e catálogo" };

const label = (list: readonly { value: string; label: string }[], v: string | null | undefined) => list.find((x) => x.value === v)?.label ?? "—";

export default async function Page() {
  const s = await requireNetworkSession();
  const v = await networkViewer(s.ctx);
  if (!v.platform) redirect("/rede/minha");
  const [{ levelLabels }, settings, table] = await Promise.all([networkSettings(s.ctx.store), certificationSettings(s.ctx.store), levelPriceTable(s.ctx.store, null, [...NETWORK_LEVELS])]);
  const products = new Map(settings.catalog.map((p) => [p.key, p.label]));
  return (
    <>
      <PageHeader
        title="Preços da rede e catálogo"
        crumbs={[{ label: "Rede de certificação", href: "/rede" }, { label: "Preços e catálogo" }]}
        description="A Intercert compra da AC de 1º nível pelo custo AC e vende a quem está diretamente abaixo dela pela tabela padrão por nível. Cada parceiro define, do mesmo jeito, a tabela dos seus filhos — sempre acima do próprio custo."
      />
      <div className="space-y-4">
        <Card title="Catálogo com custo AC" description="Custo pago pela Intercert à AC de 1º nível (Soluti/Serpro), tipo, titular e se o preço pode ser alterado na rede (BirdID: fixo). O preço é o da cobrança da Intercert ao escritório (Tela 67).">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 text-left font-medium">Produto</th>
                  <th className="py-1 text-right font-medium">Custo AC</th>
                  <th className="py-1 text-right font-medium">Preço (Tela 67)</th>
                  <th className="py-1 pl-3 text-left font-medium">Tipo</th>
                  <th className="py-1 text-left font-medium">Titular</th>
                  <th className="py-1 text-left font-medium">AC</th>
                  <th className="py-1 text-left font-medium">Na rede</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {settings.catalog.map((p) => (
                  <tr key={p.key} className={p.active ? undefined : "text-slate-400"}>
                    <td className="py-1.5">{p.label}{!p.active && " (inativo)"}</td>
                    <td className="tabular py-1.5 text-right">{p.acCost == null ? "—" : formatMoney(p.acCost)}</td>
                    <td className="tabular py-1.5 text-right">{formatMoney(p.price)}</td>
                    <td className="py-1.5 pl-3">{label(CERT_PRODUCT_TYPES, p.type)}</td>
                    <td className="py-1.5">{label(CERT_HOLDERS, p.holder)}</td>
                    <td className="py-1.5">{label(CERT_SUPPLIERS, p.supplier)}</td>
                    <td className="py-1.5">{p.editable === false ? "Preço fixo" : "Editável"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-brand-700">Editar catálogo</summary>
            <div className="mt-3">
              <SettingsForm key={JSON.stringify(settings)} settings={settings} />
            </div>
          </details>
        </Card>
        <Card title="Tabela padrão da Intercert por nível" description="Para os parceiros diretamente abaixo da Intercert (normalmente os Masters). O custo nunca fica abaixo do custo AC.">
          {settings.catalog.some((p) => p.active && p.acCost == null) && <div className="mb-3"><Notice tone="warn">Há produtos sem custo AC: a margem da Intercert aparece calculada sobre custo zero.</Notice></div>}
          <LevelTableEditor rows={table.rows} labels={levelLabels} ownerNodeId={null} ownerName="Intercert" canEdit />
        </Card>
        <Card title="Histórico da tabela da Intercert">
          {table.history.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma regra ainda.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {table.history.slice(0, 100).map((r) => (
                <li key={r.id} className="py-1.5">
                  {levelLabels[r.level as keyof typeof levelLabels] ?? r.level} · {products.get(r.productKey) ?? r.productKey}: custo {formatMoney(r.cost)}, mínimo {formatMoney(r.minPrice)}, padrão {formatMoney(r.defaultPrice)} — desde {r.validFrom}
                  {r.validTo ? ` até ${r.validTo}` : ""}
                  {r.active === false ? " (substituída)" : ""} <span className="text-xs text-slate-500">· gravada em {formatDateTime(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
