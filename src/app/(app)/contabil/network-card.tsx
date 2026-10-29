import "server-only";
import Link from "@/components/ui/link";
import { Card } from "@/components/ui/card";
import type { SessionInfo } from "@/lib/server/session";
import { featureOn } from "@/lib/server/features";
import { formatMoney } from "@/lib/money";
import { networkSettings, networkViewer, nodePriceTable } from "@/domain/network";

/**
 * Escritório que é CONTADOR da rede de certificação (§43): cartão "Minha rede" com a revenda acima e os preços do
 * escritório (custo, mínimo e padrão). Escritório fora da rede ou recurso desligado: nada aparece.
 */
export async function FirmNetworkCard({ s }: { s: SessionInfo }) {
  if (!(await featureOn(s, "redeCertificacao"))) return null;
  const v = await networkViewer(s.ctx);
  const me = v.myNode;
  if (!me) return null;
  const { levelLabels } = await networkSettings(s.ctx.store);
  const parent = me.parentNodeId ? v.nodes.find((n) => n.id === me.parentNodeId) : null;
  const prices = (await nodePriceTable(s.ctx.store, me.id)).filter((r) => r.price);
  return (
    <section aria-label="Minha rede de certificação" className="mb-5">
      <Card
        title={`Minha rede de certificação — ${levelLabels.contador}`}
        description={`Acima: ${parent?.name ?? "Intercert"}${me.status !== "active" ? ` · seu nó está ${me.status === "suspended" ? "suspenso" : "encerrado"}` : ""}`}
        actions={<Link href="/rede/minha" className="text-xs text-brand-700 hover:underline">Abrir minha rede</Link>}
      >
        {prices.length === 0 ? (
          <p className="text-sm text-slate-500">{parent?.name ?? "A Intercert"} ainda não definiu os seus preços.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="mb-1 text-left text-xs font-medium text-slate-500">Meus preços</caption>
              <thead className="text-xs text-slate-500">
                <tr>
                  <th className="py-1 text-left font-medium">Produto</th>
                  <th className="py-1 text-right font-medium">Custo</th>
                  <th className="py-1 text-right font-medium">Mínimo</th>
                  <th className="py-1 text-right font-medium">Padrão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {prices.map((r) => (
                  <tr key={r.product.key}>
                    <td className="py-1.5">{r.product.label}{r.price!.canEdit ? "" : " (preço fixo)"}</td>
                    <td className="tabular py-1.5 text-right">{formatMoney(r.price!.cost)}</td>
                    <td className="tabular py-1.5 text-right">{formatMoney(r.price!.minPrice)}</td>
                    <td className="tabular py-1.5 text-right">{formatMoney(r.price!.defaultPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  );
}
