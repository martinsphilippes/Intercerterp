"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/server/action";

/**
 * Botão que abre um diálogo com formulário ligado a uma server action (idempotente, bloqueia duplo envio).
 * Os campos podem vir renderizados do servidor como children.
 */
export function FormDialog({
  label,
  title,
  description,
  action,
  children,
  variant = "secondary",
  size = "md",
  icon,
  disabled,
  disabledReason,
  submitLabel = "Salvar",
  submitVariant = "primary",
  dialogSize = "md",
  confirm,
}: {
  label: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action: (fd: FormData) => Promise<ActionResult<any>>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent" | "outline";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  submitLabel?: string;
  submitVariant?: "primary" | "accent" | "danger" | "secondary";
  dialogSize?: "sm" | "md" | "lg" | "xl";
  confirm?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} disabled={disabled} title={disabled ? disabledReason : undefined} onClick={() => setOpen(true)}>
        {icon}
        {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title} size={dialogSize}>
        {description && <div className="mb-4 text-sm text-slate-600">{description}</div>}
        <ActionForm action={action} onSuccess={() => setOpen(false)} confirm={confirm} className="space-y-4">
          {({ pending, error }) => (
            <>
              {children}
              {error && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2 border-t border-line pt-3">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <SubmitButton pending={pending} variant={submitVariant}>
                  {submitLabel}
                </SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
