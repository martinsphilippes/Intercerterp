"use client";

import { ShieldAlert } from "lucide-react";
import { Field, Input, Textarea } from "@/components/ui/form";
import type { OverdueStatus } from "@/domain/overdue";
import { OverdueAlert } from "../overdue-alert";

export interface OverdueReleaseDraft {
  reason: string;
  login: string;
  password: string;
}

/** Liberação está completa: motivo (≥ 5) e, sem a permissão do operador, login e senha de quem autoriza. */
export function overdueReleaseReady(d: OverdueReleaseDraft, canOverride: boolean) {
  return d.reason.trim().length >= 5 && (canOverride || Boolean(d.login.trim() && d.password));
}

/**
 * Pagamento de cliente inadimplente (VEN-07): mostra o alerta e, quando a política bloqueia a combinação de meios
 * escolhida, pede a liberação (motivo + permissão “Liberar venda para cliente inadimplente”). O servidor confere tudo
 * de novo na conclusão e registra a liberação na auditoria.
 */
export function OverdueReleasePanel({
  customerId, overdue, blocked, canOverride, canViewFinance, value, onChange,
}: {
  customerId: string;
  overdue: OverdueStatus;
  blocked: boolean;
  canOverride: boolean;
  canViewFinance: boolean;
  value: OverdueReleaseDraft;
  onChange: (v: OverdueReleaseDraft) => void;
}) {
  return (
    <div className="space-y-2">
      <OverdueAlert customerId={customerId} overdue={overdue} canReceive={canViewFinance} />
      {blocked && (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-amber-900">
            <ShieldAlert className="size-4" aria-hidden /> Liberar a venda
          </p>
          <p className="text-xs text-amber-900">
            {overdue.policy === "block_all" ? "A política da loja bloqueia vendas a este cliente." : "A política da loja bloqueia crediário/boleto a este cliente — troque para um meio à vista ou libere."}{" "}
            {canOverride ? "Você tem permissão para liberar: informe o motivo." : "Peça a um usuário com a permissão “Liberar venda para cliente inadimplente” que informe login e senha."}
          </p>
          <Field label="Motivo da liberação" required>
            <Textarea rows={2} maxLength={500} value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })} placeholder="Ex.: cliente comprometeu-se a quitar a parcela vencida até sexta" />
          </Field>
          {!canOverride && (
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Login de quem autoriza" value={value.login} onChange={(e) => onChange({ ...value, login: e.target.value })} autoComplete="off" aria-label="Login de quem autoriza" />
              <Input placeholder="Senha" type="password" value={value.password} onChange={(e) => onChange({ ...value, password: e.target.value })} autoComplete="new-password" aria-label="Senha de quem autoriza" />
            </div>
          )}
          <p className="text-xs text-amber-800">A liberação, o motivo e quem autorizou ficam registrados na auditoria da venda.</p>
        </div>
      )}
    </div>
  );
}
