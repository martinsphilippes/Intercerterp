import Link from "@/components/ui/link";
import { Bike, Network, Store as StoreIcon, Truck } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionForm } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/form";
import { MoneyInput } from "@/components/ui/money-input";
import { Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { shippingOf } from "@/domain/ecommerce/store";
import { getIntegration } from "@/domain/integrations";
import { ZonesEditor } from "../_components/zones-editor";
import { SampleQuote } from "../_components/sample-quote";
import { sampleQuoteAction, saveShippingAction } from "../actions";
import { ecomStorePage } from "../_lib";

export const metadata = { title: "Frete e logística" };

/** Tela 58 — Frete e plataformas logísticas: retirada, entrega própria, entrega por terceiros e transportadora. */
export default async function Page() {
  const { s, st } = await ecomStorePage(["ecommerce.manage", "ecommerce.orders"]);
  const manage = canDo(s.user, "ecommerce.manage");
  const ship = shippingOf(st);
  const integ = await getIntegration(s.ctx.store, s.ctx.companyId, null, "store_logistics");
  const branches = s.branches.filter((b) => b.status !== "inactive");
  const cards = [
    { key: "pickup", title: "Retirada na loja", Icon: StoreIcon, text: "O cliente compra on-line e retira no balcão com o código do pedido.", on: ship.modes.pickup.enabled, status: "Sem integração" },
    { key: "own", title: "Entrega própria", Icon: Bike, text: "Entregador da empresa, com preço e prazo por faixa de CEP.", on: ship.modes.own.enabled, status: `${ship.modes.own.zones.length} faixa(s)` },
    { key: "third_party", title: "Entrega por terceiros", Icon: Network, text: "Aplicativo ou parceiro de entrega rápida na região (cotação e chamada pelo conector).", on: ship.modes.third_party.enabled, status: integ && integ.provider === "delivery_api" ? "Conector configurado" : "Simulação" },
    { key: "carrier", title: "Transportadora / plataforma", Icon: Truck, text: "Cotações, contratação, etiquetas e rastreio por plataforma de fretes ou transportadora direta.", on: ship.modes.carrier.enabled, status: integ && integ.provider === "carrier_api" ? "Conector configurado" : "Simulação" },
  ];
  return (
    <>
      <PageHeader title="Frete e plataformas logísticas" crumbs={[{ label: "Comércio digital", href: "/comercio-digital" }, { label: "Frete e logística" }]} description="Defina as formas de entrega e revise a cotação que aparecerá no carrinho e no checkout." actions={<Link href="/comercio-digital/expedicao" className={buttonClass("secondary")}>Ver expedição</Link>} />
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ key, title, Icon, text, on, status }) => (
          <div key={key} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
              <p className="font-semibold text-ink">{title}</p>
            </div>
            <p className="mt-2 text-sm text-slate-600">{text}</p>
            <div className="mt-3 flex items-center justify-between">
              <Badge tone={on ? "good" : "neutral"}>{on ? "Ativa" : "Desligada"}</Badge>
              <span className="text-xs text-slate-500">{status}</span>
            </div>
          </div>
        ))}
      </div>
      <Notice tone="info">O fornecedor logístico será escolhido na homologação (Administração › Integrações › Logística da loja). Até lá, transportadora e entrega por terceiros usam a tabela de referência da simulação: nenhum frete é contratado.</Notice>
      <div className="mt-4 grid gap-4 xl:grid-cols-5 [&>*]:min-w-0">
        <Card title="Regras da loja" className="xl:col-span-3">
          <ActionForm action={saveShippingAction} className="space-y-5">
            <fieldset disabled={!manage} className="space-y-5">
              <FormGrid cols={3}>
                <Field label="Filial de expedição" htmlFor="fulfillmentBranchId"><Select id="fulfillmentBranchId" name="fulfillmentBranchId" defaultValue={st.fulfillmentBranchId} options={branches.map((b) => ({ value: b.id, label: b.name }))} /></Field>
                <Field label="CEP de origem" htmlFor="originZip"><Input id="originZip" name="originZip" defaultValue={ship.originZip.replace(/^(\d{5})(\d{3})$/, "$1-$2")} inputMode="numeric" /></Field>
                <Field label="Prazo de separação (dias)" htmlFor="handlingDays"><Input id="handlingDays" name="handlingDays" type="number" min={0} max={30} defaultValue={ship.handlingDays} /></Field>
              </FormGrid>
              <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold text-ink">Retirada na loja</legend>
                <Checkbox name="pickup" defaultChecked={ship.modes.pickup.enabled} label="Oferecer retirada" />
                <div className="flex flex-wrap gap-3 text-sm">
                  {branches.map((b) => (
                    <label key={b.id} className="flex items-center gap-1.5"><input type="checkbox" name="pickupBranchIds" value={b.id} defaultChecked={(st.pickupBranchIds ?? []).includes(b.id)} /> {b.name}</label>
                  ))}
                </div>
                <FormGrid cols={2}>
                  <Field label="Pronto em até (horas)" htmlFor="readyHours"><Input id="readyHours" name="readyHours" type="number" min={0} max={168} defaultValue={ship.modes.pickup.readyHours} /></Field>
                  <Field label="Instruções ao cliente" htmlFor="pickupInstructions"><Input id="pickupInstructions" name="pickupInstructions" defaultValue={ship.modes.pickup.instructions} /></Field>
                </FormGrid>
              </fieldset>
              <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold text-ink">Entrega própria</legend>
                <Checkbox name="own" defaultChecked={ship.modes.own.enabled} label="Oferecer entrega própria nas faixas de CEP" />
                <ZonesEditor initial={ship.modes.own.zones} />
              </fieldset>
              <fieldset className="space-y-2 rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold text-ink">Entrega por terceiros e transportadora</legend>
                <Checkbox name="third_party" defaultChecked={ship.modes.third_party.enabled} label="Entrega por terceiros (aplicativo) na região metropolitana" />
                <FormGrid cols={2}>
                  <Field label="Nome exibido no checkout" htmlFor="thirdPartyLabel"><Input id="thirdPartyLabel" name="thirdPartyLabel" defaultValue={ship.modes.third_party.label} /></Field>
                  <Field label="Raio máximo (km)" htmlFor="maxDistanceKm"><Input id="maxDistanceKm" name="maxDistanceKm" type="number" min={1} max={200} defaultValue={ship.modes.third_party.maxDistanceKm} /></Field>
                </FormGrid>
                <Checkbox name="carrier" defaultChecked={ship.modes.carrier.enabled} label="Transportadora: entrega padrão e entrega expressa" />
              </fieldset>
              <FormGrid cols={2}>
                <Field label="Frete grátis a partir de" hint="Use zero para desativar. O mínimo considera produtos após desconto."><MoneyInput name="freeShippingMin" defaultValue={ship.freeShippingMin} ariaLabel="Frete grátis a partir de" /></Field>
                <Field label="Frete grátis vale para">
                  <div className="flex flex-col gap-1 text-sm">
                    <label className="flex items-center gap-1.5"><input type="checkbox" name="freeShippingModes" value="carrier" defaultChecked={ship.freeShippingModes.includes("carrier")} /> Entrega padrão (transportadora)</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" name="freeShippingModes" value="own" defaultChecked={ship.freeShippingModes.includes("own")} /> Entrega própria</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" name="freeShippingModes" value="third_party" defaultChecked={ship.freeShippingModes.includes("third_party")} /> Entrega por terceiros</label>
                  </div>
                </Field>
              </FormGrid>
              <FormGrid cols={4}>
                <Field label="Embalagem padrão: peso (g)" htmlFor="pkgWeight"><Input id="pkgWeight" name="pkgWeight" type="number" min={1} defaultValue={ship.package.weightGrams} /></Field>
                <Field label="Altura (cm)" htmlFor="pkgHeight"><Input id="pkgHeight" name="pkgHeight" type="number" min={1} defaultValue={ship.package.heightCm} /></Field>
                <Field label="Largura (cm)" htmlFor="pkgWidth"><Input id="pkgWidth" name="pkgWidth" type="number" min={1} defaultValue={ship.package.widthCm} /></Field>
                <Field label="Comprimento (cm)" htmlFor="pkgLength"><Input id="pkgLength" name="pkgLength" type="number" min={1} defaultValue={ship.package.lengthCm} /></Field>
              </FormGrid>
              {manage && <button type="submit" className={buttonClass("accent", "lg", "w-full")}>Salvar regras de entrega</button>}
            </fieldset>
          </ActionForm>
        </Card>
        <Card title="Cotação de exemplo" className="xl:col-span-2">
          <SampleQuote action={sampleQuoteAction} />
        </Card>
      </div>
    </>
  );
}
