import { describe, it, expect } from "vitest";
import { templateSyncPlan, ACTIONS_ADDED_TO_TEMPLATES } from "@/lib/auth/role-sync";
import { ROLE_TEMPLATES } from "@/lib/permissions";

describe("sincronização de perfis de sistema com operações novas das fases", () => {
  it("perfil antigo (sem registro do modelo) recebe as operações novas do seu modelo, e só elas", () => {
    const tpl = ROLE_TEMPLATES.find((t) => t.key === "manager")!;
    const old = (tpl.actions as string[]).filter((a) => !ACTIONS_ADDED_TO_TEMPLATES.includes(a));
    const plan = templateSyncPlan({ system: true, key: "manager", actions: old, templateActions: null })!;
    expect(plan.missing.sort()).toEqual((tpl.actions as string[]).filter((a) => ACTIONS_ADDED_TO_TEMPLATES.includes(a)).sort());
    expect(plan.missing).toEqual(expect.arrayContaining(["pdv.receive_installments", "sales_doc.order", "sales.commissions", "purchase.pricing"]));
  });

  it("toda operação de modelo criada nas fases está na lista de acréscimos", () => {
    for (const a of ["purchase.pricing", "products.bulk_edit", "pdv.receive_installments", "pdv.reverse_receipt", "sale.overdue_override", "sales.commissions", "sales_doc.quote", "sales_doc.order", "sales_doc.cancel"]) {
      expect(ACTIONS_ADDED_TO_TEMPLATES).toContain(a);
    }
  });

  it("operações do §44 (remover item, cancelar atendimento, devolução acima do limite) chegam ao Gerente e ao Administrador já gravados, não ao Caixa", () => {
    for (const key of ["manager", "admin"]) {
      const tpl = ROLE_TEMPLATES.find((t) => t.key === key)!;
      const old = (tpl.actions as string[]).filter((a) => !["pdv.remove_item", "pdv.cancel_cart", "sale.return_over_limit"].includes(a));
      const plan = templateSyncPlan({ system: true, key, actions: old, templateActions: old })!;
      expect(plan.missing.sort()).toEqual(["pdv.cancel_cart", "pdv.remove_item", "sale.return_over_limit"]);
    }
    const cashier = ROLE_TEMPLATES.find((t) => t.key === "cashier")!;
    expect(cashier.actions).not.toContain("pdv.remove_item");
    for (const a of ["pdv.remove_item", "pdv.cancel_cart", "sale.return_over_limit"]) expect(ACTIONS_ADDED_TO_TEMPLATES).toContain(a);
  });

  it("operações do §45 (rede — vender, ver tudo do nó, vouchers, cupons, renovações) chegam aos perfis de parceiro já gravados conforme o modelo", () => {
    const NEW = ["network.sell", "network.sales_all", "network.vouchers", "network.coupons", "network.renewals"];
    const expected: Record<string, string[]> = {
      partner_admin: NEW, partner_manager: NEW, partner_seller: ["network.sell", "network.renewals"], partner_finance: ["network.sales_all"],
    };
    for (const [key, want] of Object.entries(expected)) {
      const tpl = ROLE_TEMPLATES.find((t) => t.key === key)!;
      const old = (tpl.actions as string[]).filter((a) => !NEW.includes(a));
      const plan = templateSyncPlan({ system: true, key, actions: old, templateActions: old })!;
      expect(plan.missing.sort()).toEqual([...want].sort());
    }
    for (const a of NEW) expect(ACTIONS_ADDED_TO_TEMPLATES).toContain(a);
    // perfis de loja e do escritório não recebem operações da rede (o contador mantém accounting.certificates)
    for (const key of ["admin", "manager", "firm_admin", "firm_manager"]) expect((ROLE_TEMPLATES.find((t) => t.key === key)!.actions as string[]).some((a) => a.startsWith("network."))).toBe(false);
    expect(ROLE_TEMPLATES.find((t) => t.key === "firm_admin")!.actions).toContain("accounting.certificates");
  });

  it("perfil já sincronizado com o modelo atual não muda", () => {
    const tpl = ROLE_TEMPLATES.find((t) => t.key === "cashier")!;
    expect(templateSyncPlan({ system: true, key: "cashier", actions: [...tpl.actions], templateActions: [...tpl.actions] })).toBeNull();
  });
});
