"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Select, Checkbox } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { saveIntegrationAction } from "../actions";

type Prov = { id: string; label: string; secrets: string[]; config: string[]; defaultRefs?: Record<string, string>; test: string; simulated?: boolean };

/** Configuração de integração não fiscal: provedor, ambiente, NOMES das variáveis de credencial e parâmetros. */
export function IntegrationForm({
  kind,
  providers,
  current,
  secretLabels,
  configLabels,
  envDefined,
  branchName,
  canEdit,
}: {
  kind: string;
  providers: Prov[];
  current: { provider: string | null; environment: string | null; config: Record<string, any>; secretRefs: Record<string, string>; enabled: boolean; scope: "branch" | "company" | null } | null;
  secretLabels: Record<string, string>;
  configLabels: Record<string, string>;
  envDefined: Record<string, boolean>;
  branchName: string | null;
  canEdit: boolean;
}) {
  const [provider, setProvider] = useState(current?.provider ?? providers[0].id);
  const prov = providers.find((p) => p.id === provider) ?? providers[0];
  const [refs, setRefs] = useState<Record<string, string>>(() => {
    const r: Record<string, string> = {};
    for (const p of providers) for (const s of p.secrets) r[s] = current?.secretRefs?.[s] ?? p.defaultRefs?.[s] ?? "";
    return r;
  });
  return (
    <ActionForm action={saveIntegrationAction} className="space-y-4">
      {({ pending, error }) => (
        <>
          <input type="hidden" name="kind" value={kind} />
          <Checkbox name="enabled" label={branchName ? `Habilitar integração nesta filial (${branchName})` : "Habilitar integração na empresa"} defaultChecked={current ? current.enabled : true} disabled={!canEdit} />
          <FormGrid cols={2}>
            <Field label="Nome da conexão" required><Input name="connectionName" defaultValue={current?.config?.connectionName ?? ""} required disabled={!canEdit} placeholder="Ex.: Pix — conta principal" /></Field>
            <Field label="Abrangência" hint="Configuração da filial prevalece sobre a da empresa.">
              <Select name="scope" defaultValue={current?.scope ?? (branchName ? "branch" : "company")} options={[...(branchName ? [{ value: "branch", label: `Somente esta filial (${branchName})` }] : []), { value: "company", label: "Empresa (todas as filiais sem configuração própria)" }]} disabled={!canEdit} />
            </Field>
            <Field label="Provedor" required>
              <Select name="provider" value={provider} onChange={(e) => setProvider(e.target.value)} options={providers.map((p) => ({ value: p.id, label: p.label }))} disabled={!canEdit} />
            </Field>
            <Field label="Ambiente" hint={prov.simulated ? "Simulação: sem ambiente real." : "Homologação e produção são contextos distintos no provedor."}>
              <Select name="environment" defaultValue={current?.environment ?? "homologacao"} options={[{ value: "homologacao", label: "Homologação / testes" }, { value: "producao", label: "Produção" }]} disabled={!canEdit || prov.simulated} />
            </Field>
          </FormGrid>
          {prov.secrets.length > 0 && (
            <div className="rounded-md border border-line p-3">
              <p className="text-sm font-semibold">Credenciais da integração (referência)</p>
              <p className="mb-2 text-xs text-slate-500">Informe apenas o NOME da variável de ambiente do servidor. O valor nunca é gravado nem exibido.</p>
              <FormGrid cols={2}>
                {prov.secrets.map((s) => (
                  <Field key={s} label={secretLabels[s] ?? s} hint={<span>{envDefined[refs[s]] ? <Badge tone="good">definida no servidor</Badge> : <Badge tone="warn">não definida no servidor</Badge>}</span>}>
                    <Input name={`secret_${s}`} value={refs[s] ?? ""} onChange={(e) => setRefs({ ...refs, [s]: e.target.value.toUpperCase() })} placeholder={prov.defaultRefs?.[s]} disabled={!canEdit} />
                  </Field>
                ))}
              </FormGrid>
              <p className="mt-2 text-[11px] text-slate-500">A situação “definida” refere-se à configuração carregada no servidor; após alterar o nome, salve e recarregue para conferir.</p>
            </div>
          )}
          {prov.config.length > 0 && (
            <FormGrid cols={2}>
              {prov.config.map((k) => (
                <Field key={k} label={configLabels[k] ?? k}>
                  <Input name={`cfg_${k}`} defaultValue={current?.config?.[k] ?? ""} disabled={!canEdit} type={k.toLowerCase().includes("email") ? "email" : "text"} />
                </Field>
              ))}
            </FormGrid>
          )}
          <Notice tone="info">Teste disponível: {prov.test}</Notice>
          {error && <Notice tone="bad">{error}</Notice>}
          {canEdit && (
            <div className="flex justify-end gap-2">
              <button type="reset" className="text-sm text-slate-600 hover:underline">Descartar</button>
              <SubmitButton pending={pending}>Salvar configuração</SubmitButton>
            </div>
          )}
        </>
      )}
    </ActionForm>
  );
}
