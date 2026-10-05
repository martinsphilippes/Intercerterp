import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Timeline } from "@/components/ui/timeline";
import { listAll } from "@/lib/db";
import { getSetting } from "@/lib/core/settings";
import { can } from "@/lib/permissions";
import { activePolicy, DEFAULT_POLICY, policyId } from "@/domain/approvals";
import { PolicyForm } from "./policy-form";

export const metadata = { title: "Política de aprovação de compras" };

export default async function Page() {
  const s = await requireSession("purchases");
  const doc = await activePolicy(s.ctx.store, s.ctx.companyId);
  const roles = (await listAll(s.ctx.store, "roles")).filter((r) => !r.companyId || r.companyId === s.ctx.companyId).map((r) => ({ value: r.id, label: r.name }));
  const users = (await listAll(s.ctx.store, "users", { filters: [["eq", "status", "active"]] })).filter((u) => u.isAdmin || (u.companyIds ?? []).includes(s.ctx.companyId)).map((u) => ({ value: u.id, label: u.name }));
  const budgets: Record<string, number> = {};
  for (const b of s.branches) budgets[b.id] = Number(await getSetting(s.ctx.store, s.ctx.companyId, b.id, "purchase.monthlyBudget", 0)) || 0;
  const p = doc ?? { ...DEFAULT_POLICY, rules: DEFAULT_POLICY.rules };
  return (
    <>
      <PageHeader title="Política de aprovação de compras" crumbs={[{ label: "Aprovações", href: "/compras/aprovacoes" }, { label: "Política" }]} description={doc ? "Configuração vigente. Alterações valem para novas solicitações e reenvios (as solicitações em andamento guardam a política do envio)." : "Nenhuma política salva: vale o padrão de uma etapa."} />
      <PolicyForm
        canEdit={can(s.user, "admin", "edit")}
        roles={roles}
        users={users}
        branches={s.branches.map((b) => ({ value: b.id, label: b.name }))}
        budgets={budgets}
        policy={{ name: p.name, tiers: p.rules.tiers, autoApproveBelow: p.autoApproveBelow ?? 0, allowSelfApproval: Boolean(p.allowSelfApproval), distinctApprovers: Boolean(p.rules.distinctApprovers), expiredProposalAction: p.expiredProposalAction ?? "warn", reviewOnRevision: p.reviewOnRevision ?? "relevant" }}
      />
      <Card className="mt-5" title="Histórico de alterações">
        <Timeline store={s.ctx.store} refs={[`approval_policy:${policyId(s.ctx.companyId)}`]} />
      </Card>
    </>
  );
}
