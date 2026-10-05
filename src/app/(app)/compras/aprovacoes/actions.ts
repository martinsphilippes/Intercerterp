"use server";

import { runAction, fstr, fint, fjson, fbool } from "@/lib/server/action";
import { decideRequest, revokeDecision, savePolicy, type Decision, type PolicyInput } from "@/domain/approvals";
import { getSetting, setSetting } from "@/lib/core/settings";
import { audit } from "@/lib/core/audit";
import { requirePerm } from "@/lib/core/ctx";
import { formatMoney } from "@/lib/money";

const PATHS = ["/compras/aprovacoes", "/compras/pedidos"];

export async function decideAction(fd: FormData) {
  const id = fstr(fd, "requestId");
  return runAction({ module: "purchases", revalidate: [`/compras/aprovacoes/${id}`, ...PATHS] }, async (s) => {
    const decision = fstr(fd, "decision") as Decision;
    if (!["approve", "adjust", "reject"].includes(decision)) return { ok: false as const, error: "Escolha uma decisão." };
    const note = fstr(fd, "note").slice(0, 500);
    const r = await decideRequest(s.ctx, id, decision, note || null);
    const msg = decision === "approve" ? (r.request.status === "approved" ? "Solicitação aprovada. Os pedidos aguardam o registro de envio ao fornecedor." : "Etapa aprovada — encaminhada para a próxima etapa.") : decision === "adjust" ? "Devolvida para ajuste." : "Solicitação rejeitada.";
    return { ok: true as const, message: msg };
  });
}

export async function revokeAction(decisionId: string, requestId: string, fd: FormData) {
  return runAction({ module: "purchases", revalidate: [`/compras/aprovacoes/${requestId}`, ...PATHS] }, async (s) => {
    await revokeDecision(s.ctx, decisionId, fstr(fd, "reason"));
    return { ok: true as const, message: "Decisão revista — a solicitação voltou para análise na mesma etapa." };
  });
}

export async function savePolicyAction(fd: FormData) {
  return runAction({ module: "admin", op: "edit", revalidate: ["/compras/aprovacoes/politica", "/compras/aprovacoes"] }, async (s) => {
    const input: PolicyInput = {
      name: fstr(fd, "name"),
      rules: { tiers: fjson(fd, "tiers", []), distinctApprovers: fbool(fd, "distinctApprovers") },
      autoApproveBelow: fint(fd, "autoApproveBelow"),
      allowSelfApproval: fbool(fd, "allowSelfApproval"),
      expiredProposalAction: (fstr(fd, "expiredProposalAction") as any) || "warn",
      reviewOnRevision: (fstr(fd, "reviewOnRevision") as any) || "relevant",
    };
    await savePolicy(s.ctx, input);
    // orçamento mensal de compras por filial (parâmetro purchase.monthlyBudget)
    const budgets: Record<string, number> = fjson(fd, "budgets", {});
    requirePerm(s.ctx, "admin", "edit");
    for (const [branchId, value] of Object.entries(budgets)) {
      if (!s.branches.some((b) => b.id === branchId)) continue;
      const v = Math.max(0, Math.round(Number(value) || 0));
      const cur = Number(await getSetting(s.ctx.store, s.ctx.companyId, branchId, "purchase.monthlyBudget", 0)) || 0;
      if (cur === v) continue;
      await setSetting(s.ctx.store, s.ctx.companyId, branchId, "purchase.monthlyBudget", v, s.user.id);
      await audit(s.ctx, { module: "purchases", action: "purchase.budget", entityType: "setting", entityId: `purchase.monthlyBudget:${branchId}`, summary: `Orçamento mensal de compras da filial ${s.branches.find((b) => b.id === branchId)?.name}: ${v ? formatMoney(v) : "não controlado"}` });
    }
    return { ok: true as const, message: "Política de aprovação salva." };
  });
}
