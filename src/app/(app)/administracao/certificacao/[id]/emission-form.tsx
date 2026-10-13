"use client";

import { useState } from "react";
import { FileKey2, Play, RefreshCw } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { registerEmissionAction, teamRequestEmissionAction } from "@/app/(app)/contabil/certificados/actions";

const docLabel = (doc: string | null) => (doc && doc.replace(/\D/g, "").length === 11 ? "CPF" : "CNPJ");

/**
 * Registro da emissão pela equipe (multipart): `registerEmissionAction` (id, file .pfx/.p12 obrigatório, password
 * opcional — usada só para ler titular, validade e série, nunca gravada —, serial, issuer, validFrom, validTo). Sem a
 * senha, a validade final é obrigatória. O arquivo fica guardado no protocolo e o escritório/titular é avisado.
 */
export function EmissionForm({ id, attempt, holderDoc, holderName, downloadAuthorized }: { id: string; attempt: number; holderDoc: string | null; holderName: string; downloadAuthorized: boolean }) {
  const [password, setPassword] = useState("");
  const [fileName, setFileName] = useState("");
  const hasPassword = password.length > 0;
  const fileOk = !fileName || /\.(pfx|p12)$/i.test(fileName);
  return (
    <ActionForm action={registerEmissionAction} className="space-y-4" confirm={`Registrar a emissão do certificado de ${holderName} com o arquivo ${fileName || "selecionado"}?`}>
      {({ pending, error }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <p className="text-sm text-slate-600">
            Tentativa {attempt.toLocaleString("pt-BR")}. Ao registrar, o protocolo segue para {downloadAuthorized ? "“Pronto para baixar” (o titular já autorizou o download pelo escritório)" : "“Aguardando autorização” do titular para o download pelo escritório"}.
          </p>
          <FormGrid cols={2}>
            <Field label="Arquivo emitido (.pfx ou .p12)" required hint="Arquivo entregue pela certificadora. Fica guardado no protocolo; só é baixado com confirmação de senha." error={fileOk ? null : "O arquivo precisa ser .pfx ou .p12."}>
              <Input type="file" name="file" accept=".pfx,.p12,application/x-pkcs12" required onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")} disabled={pending} className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium" />
            </Field>
            <Field label="Senha do arquivo (opcional, só para ler validade e série — não é gravada)" hint={`Com a senha, o titular (${docLabel(holderDoc)}) é conferido contra a solicitação e validade e série são lidas do arquivo.`}>
              <Input type="password" name="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} disabled={pending} />
            </Field>
          </FormGrid>
          <FormGrid cols={4}>
            <Field label="Série" hint={hasPassword ? "Vazio = lida do arquivo." : "Número de série do certificado."}>
              <Input name="serial" placeholder="Ex.: 3A9F…" disabled={pending} />
            </Field>
            <Field label="Emissor (AC)" hint={hasPassword ? "Vazio = lido do arquivo." : "Autoridade certificadora."}>
              <Input name="issuer" placeholder="Ex.: AC Certisign RFB G5" disabled={pending} />
            </Field>
            <Field label="Validade — início" hint={hasPassword ? "Vazio = lida do arquivo." : "Vazio = hoje."}>
              <Input type="date" name="validFrom" disabled={pending} />
            </Field>
            <Field label="Validade — fim" required={!hasPassword} hint={hasPassword ? "Vazio = lida do arquivo." : "Obrigatória sem a senha do arquivo."}>
              <Input type="date" name="validTo" required={!hasPassword} disabled={pending} />
            </Field>
          </FormGrid>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SubmitButton pending={pending} variant="primary">
              <FileKey2 className="size-4" aria-hidden /> Registrar emissão
            </SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/**
 * A equipe adianta a emissão (pronto para emitir) ou pede nova tentativa após falha, sem nova cobrança:
 * `teamRequestEmissionAction` (id). Mesmo protocolo, autor e momento no histórico.
 */
export function StartEmissionButton({ id, holderName, retry }: { id: string; holderName: string; retry: boolean }) {
  return (
    <ActionForm
      action={teamRequestEmissionAction}
      confirm={retry ? `Pedir nova tentativa de emissão para ${holderName}? O mesmo protocolo é usado, sem nova cobrança.` : `Iniciar a emissão do certificado de ${holderName} em nome do escritório? A certificadora é acionada neste protocolo.`}
    >
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <SubmitButton pending={pending} variant="primary">
            {retry ? <RefreshCw className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
            {retry ? "Nova tentativa" : "Iniciar emissão"}
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
