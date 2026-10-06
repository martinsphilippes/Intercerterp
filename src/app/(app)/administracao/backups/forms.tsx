"use client";

import { useState } from "react";
import { DatabaseBackup } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import { createBackupAction, restoreAction } from "./actions";
import { saveBackupScheduleAction } from "../parametros/actions";

export function NewBackupButton({ includeFilesDefault }: { includeFilesDefault: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="accent" onClick={() => setOpen(true)}>
        <DatabaseBackup className="size-4" /> Nova cópia agora
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Criar cópia de segurança" size="md">
        <ActionForm action={createBackupAction} className="space-y-4">
          {({ pending, error }) => (
            <>
              <p className="text-sm text-slate-600">Exporta todos os dados da empresa (todas as unidades) para um artefato compactado com manifesto e SHA-256, gravado no armazenamento de backups.</p>
              <div className="space-y-2">
                <div><Checkbox name="includeFiles" label="Incluir arquivos (XML de documentos e anexos)" defaultChecked={includeFilesDefault} /></div>
                <div><Checkbox name="verify" label="Verificar em seguida (restaurar em base de teste isolada e comparar)" defaultChecked /></div>
              </div>
              {pending && <Notice tone="info">Gerando a cópia… isto pode levar alguns segundos conforme o volume de dados.</Notice>}
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending} variant="accent">Criar cópia</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

export function ScheduleForm({ schedule, readOnly, weekdays, frequencies }: { schedule: Record<string, any>; readOnly: boolean; weekdays: string[]; frequencies: Array<{ value: string; label: string }> }) {
  const [freq, setFreq] = useState<string>(schedule.frequency ?? "daily");
  return (
    <ActionForm action={saveBackupScheduleAction} className="space-y-4">
      {({ pending, error }) => (
        <fieldset disabled={readOnly} className="space-y-4">
          <Checkbox name="enabled" label="Cópia automática ligada" defaultChecked={Boolean(schedule.enabled)} />
          <FormGrid cols={4}>
            <Field label="Periodicidade">
              <Select name="frequency" value={freq} onChange={(e) => setFreq(e.target.value)} options={frequencies} />
            </Field>
            {freq === "weekly" && (
              <Field label="Dia da semana">
                <Select name="weekday" defaultValue={String(schedule.weekday ?? 0)} options={weekdays.map((w, i) => ({ value: String(i), label: w }))} />
              </Field>
            )}
            <Field label="Horário" hint="No fuso único da instalação (variável APP_TIMEZONE do servidor).">
              <Input name="time" type="time" defaultValue={schedule.time ?? "02:00"} required />
            </Field>
            <Field label="Retenção (dias)" hint="Artefatos vencidos são removidos; a cópia válida mais recente é sempre mantida.">
              <Input name="retentionDays" type="number" min={1} max={3650} defaultValue={schedule.retentionDays ?? 30} required />
            </Field>
          </FormGrid>
          <div className="flex flex-col gap-2">
            <Checkbox name="includeFiles" label="Incluir arquivos (XML e anexos) nas cópias automáticas" defaultChecked={Boolean(schedule.includeFiles)} />
            <Checkbox name="verify" label="Verificar cada cópia automática em base de teste" defaultChecked={schedule.verify !== false} />
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          {!readOnly && (
            <div className="flex justify-end">
              <SubmitButton pending={pending}>Salvar programação</SubmitButton>
            </div>
          )}
        </fieldset>
      )}
    </ActionForm>
  );
}

type Preview = { rows: number; collections: number; files: number; sizeBytes: number; targetLabel: string; top: Array<[string, number]> };

export function RestoreForm({ backupId, previews, appwriteAvailable, suggestedDb, labels }: { backupId: string; previews: { test: Preview; appwrite: Preview }; appwriteAvailable: boolean; suggestedDb: string; labels: Record<string, string> }) {
  const [target, setTarget] = useState<"test" | "appwrite_new">("test");
  const [db, setDb] = useState(suggestedDb);
  const p = target === "test" ? previews.test : previews.appwrite;
  return (
    <ActionForm action={restoreAction.bind(null, backupId)} className="space-y-4">
      {({ pending, error }) => (
        <>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-600">1. Destino</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" name="target" value="test" checked={target === "test"} onChange={() => setTarget("test")} className="mt-1 accent-brand-700" />
              <span>
                <b>Base de teste isolada</b> — restaura em memória, compara contagens e checksums e descarta. Comprova que a cópia é recuperável sem tocar nos dados em uso.
              </span>
            </label>
            <label className={`flex items-start gap-2 text-sm ${appwriteAvailable ? "" : "opacity-60"}`}>
              <input type="radio" name="target" value="appwrite_new" checked={target === "appwrite_new"} disabled={!appwriteAvailable} onChange={() => setTarget("appwrite_new")} className="mt-1 accent-brand-700" />
              <span>
                <b>Nova base Appwrite</b> — provisiona outro banco (identificador abaixo) no mesmo projeto e grava a cópia nele. A base em uso nunca é sobrescrita; para adotá-la, o responsável técnico altera APPWRITE_DATABASE_ID.
                {!appwriteAvailable && <span className="block text-xs text-slate-500">Indisponível: a aplicação não está conectada ao Appwrite.</span>}
              </span>
            </label>
            {target === "appwrite_new" && (
              <Field label="Identificador da nova base" hint="Até 36 caracteres; diferente da base em uso.">
                <Input name="databaseId" value={db} onChange={(e) => setDb(e.target.value)} required maxLength={36} />
              </Field>
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-600">2. Prévia do escopo</p>
            <div className="rounded-md border border-line bg-slate-50 p-3 text-sm">
              <p>
                <b>{p.rows.toLocaleString("pt-BR")}</b> registros em <b>{p.collections}</b> tabelas · <b>{p.files}</b> arquivo(s) · artefato de {(p.sizeBytes / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} KB
              </p>
              <p className="mt-1 text-xs text-slate-600">Destino: {target === "appwrite_new" ? `Nova base Appwrite "${db}" no mesmo projeto (a base em uso não é alterada)` : p.targetLabel}</p>
              <p className="mt-2 text-xs text-slate-500">Maiores tabelas: {p.top.map(([k, n]) => `${labels[k] ?? k} (${n})`).join(", ")}</p>
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-600">3. Confirmação</p>
            <Checkbox name="confirm" label="Revisei o escopo e o destino; entendo que a restauração não altera a base em uso." required />
          </div>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex justify-end">
            <SubmitButton pending={pending}>{target === "test" ? "Restaurar em base de teste" : "Iniciar restauração na nova base"}</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}
