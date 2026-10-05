import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { freshStore } from "./helpers";
import { seedBase } from "@/domain/seed/base";
import { saveParameters, loadParameters } from "@/app/(app)/administracao/parametros/params";

describe("tmp", () => {
  it("params", async () => {
    const store = freshStore();
    const refs = await seedBase(store);
    const admin = await refs.ctxFor("admin");
    const values: Record<string, string> = { "sales.presaleExpiryHours": "48", "sales.allowNegativeStock": "false", "notifications.stockMin": "true", "sales.consumerFinalAllowed": "true", "cash.withdrawalApprovalAbove": "0", "replenishment.coverageDays": "14", "replenishment.historyDays": "90", "purchase.monthlyBudget": "0" };
    const r = await saveParameters(admin, refs.branches.shopping.id, values, [], "x");
    console.log(r);
    const st = await loadParameters(store, refs.company.id, refs.branches.shopping.id);
    console.log(st.find((s) => s.def.key === "sales.presaleExpiryHours"));
  });
});
