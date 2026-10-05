"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Notice } from "@/components/ui/empty";
import type { ActionResult } from "@/lib/server/action";

/** Botão que abre um diálogo com um campo (justificativa, correção, e-mail) e executa a ação no servidor. */
export function FormDialogButton({
  action,
  label,
  title,
  name,
  fieldLabel,
  description,
  min = 0,
  max = 1000,
  type = "textarea",
  defaultValue = "",
  submitLabel,
  variant = "secondary",
  size = "md",
  icon,
  extra,
}: {
  action: (fd: FormData) => Promise<ActionResult<any>>;
  label: React.ReactNode;
  title: string;
  name: string;
  fieldLabel: string;
  description?: React.ReactNode;
  min?: number;
  max?: number;
  type?: "textarea" | "email" | "text";
  defaultValue?: string;
  submitLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent" | "outline";
  size?: "sm" | "md";
  icon?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const len = value.trim().length;
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>
        {icon}
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <ActionForm action={action} onSuccess={() => setOpen(false)} className="space-y-4">
          {({ pending, error }) => (
            <>
              {description && <div className="text-sm text-slate-600">{description}</div>}
              <Field label={fieldLabel} hint={type === "textarea" ? `${len} caractere(s) — mínimo ${min}, máximo ${max}.` : undefined}>
                {type === "textarea" ? (
                  <Textarea name={name} value={value} onChange={(e) => setValue(e.target.value)} rows={4} maxLength={max} required minLength={min} autoFocus />
                ) : (
                  <Input name={name} type={type} value={value} onChange={(e) => setValue(e.target.value)} required autoFocus />
                )}
              </Field>
              {extra}
              {error && <Notice tone="bad">{error}</Notice>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Voltar
                </Button>
                <SubmitButton pending={pending} variant={variant === "danger" ? "danger" : "primary"}>
                  {submitLabel ?? "Confirmar"}
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
