import { today } from "@/lib/dates";
import type { DemoRefs } from "../base";

/**
 * Demonstração de promoções do varejo de balcão (CAD-15), idempotente (registros com id determinístico):
 *  - "Meias — leve 3, pague 2" (SKU da meia esportiva);
 *  - "Terça da papelaria — 10%" (categoria Papelaria, somente às terças-feiras).
 * Roda depois dos demais módulos: as vendas de demonstração já gravadas não mudam. A fidelidade (CAD-21) nasce
 * desligada e não é ligada pela demonstração (Parâmetros › Recursos).
 */
export async function seed(refs: DemoRefs): Promise<unknown> {
  const sd = refs.seeder;
  const base = { companyId: refs.company.id, branchId: null, isDemo: true, active: true };
  const out: Record<string, unknown> = {};
  const meia = refs.skus["meia-u"];
  if (meia) {
    const p = await sd.put("promotions", "meias-leve3-pague2", {
      ...base, name: "Meias — leve 3, pague 2", kind: "buy_x_pay_y", scope: "sku", targetIds: [meia.id], buyQty: 3000, payQty: 2000, validFrom: today(),
      notes: "Demonstração: a cada 3 meias do mesmo item, 1 sai de graça.",
    });
    out.meias = p.id;
  }
  const papelaria = refs.categories["Papelaria"];
  if (papelaria) {
    const p = await sd.put("promotions", "terca-papelaria", {
      ...base, name: "Terça da papelaria — 10%", kind: "min_qty", scope: "category", targetIds: [papelaria.id], minQty: 1000, percentBps: 1000, weekdays: [2], validFrom: today(),
      notes: "Demonstração: 10% de desconto em toda a papelaria às terças-feiras.",
    });
    out.terca = p.id;
  }
  return out;
}
