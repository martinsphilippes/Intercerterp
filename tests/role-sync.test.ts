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

  it("perfil já sincronizado com o modelo atual não muda", () => {
    const tpl = ROLE_TEMPLATES.find((t) => t.key === "cashier")!;
    expect(templateSyncPlan({ system: true, key: "cashier", actions: [...tpl.actions], templateActions: [...tpl.actions] })).toBeNull();
  });
});
