"use client";

import { useRef, useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./toast";
import type { ActionResult } from "@/lib/server/action";
import { buttonClass } from "./button";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Gera uma chave de idempotência estável enquanto o formulário estiver montado. */
export function useIdemKey() {
  return useMemo(newKey, []);
}

/** Chave estável até o sucesso; após sucesso gera nova (a próxima operação é outra). */
function useRotatingKey(): [string, () => void] {
  const [key, setKey] = useState(newKey);
  return [key, () => setKey(newKey())];
}

/**
 * Formulário ligado a uma server action:
 *  - desabilita durante o envio (evita duplo clique) e envia `_idem` estável (repetição não duplica);
 *  - mostra erros de regra de negócio; em sucesso, mostra mensagem, redireciona ou atualiza a página.
 */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  redirectTo,
  onSuccess,
  resetOnSuccess,
  confirm,
  id,
}: {
  action: (fd: FormData) => Promise<ActionResult<any>>;
  children: React.ReactNode | ((state: { pending: boolean; error: string | null }) => React.ReactNode);
  className?: string;
  successMessage?: string;
  redirectTo?: string | ((data: any) => string);
  onSuccess?: (data: any) => void;
  resetOnSuccess?: boolean;
  confirm?: string;
  id?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [idem, rotateIdem] = useRotatingKey();
  return (
    <form
      id={id}
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        if (confirm && !window.confirm(confirm)) return;
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const fd = new FormData(e.currentTarget, submitter && submitter.name ? submitter : undefined);
        if (!fd.has("_idem")) fd.set("_idem", idem);
        setError(null);
        start(async () => {
          const res = await action(fd);
          if (!res.ok) {
            setError(res.error);
            toast("error", res.error);
            return;
          }
          rotateIdem();
          if (successMessage || res.message) toast("success", res.message ?? successMessage!);
          if (resetOnSuccess) ref.current?.reset();
          onSuccess?.(res.data);
          const target = res.redirect ?? (typeof redirectTo === "function" ? redirectTo(res.data) : redirectTo);
          if (target) router.push(target);
          else router.refresh();
        });
      }}
    >
      {typeof children === "function" ? children({ pending, error }) : children}
      {error && typeof children !== "function" && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </form>
  );
}

/** Botão que executa uma action sem formulário visível (com confirmação opcional e motivo). */
export function ActionButton({
  action,
  label,
  confirm,
  askReason,
  variant = "secondary",
  size = "md",
  successMessage,
  redirectTo,
  icon,
  className,
  disabled,
  title,
}: {
  action: (fd: FormData) => Promise<ActionResult<any>>;
  label: React.ReactNode;
  confirm?: string;
  askReason?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent" | "outline";
  size?: "sm" | "md" | "lg";
  successMessage?: string;
  redirectTo?: string;
  icon?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const idem = useIdemKey();
  return (
    <button
      type="button"
      title={title}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClass(variant, size, className)}
      onClick={() => {
        let reason: string | null = null;
        if (askReason) {
          reason = window.prompt(askReason);
          if (reason == null) return;
          if (!reason.trim()) {
            toast("error", "Informe o motivo.");
            return;
          }
        } else if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData();
        fd.set("_idem", idem);
        if (reason) fd.set("reason", reason);
        start(async () => {
          const res = await action(fd);
          if (!res.ok) return toast("error", res.error);
          toast("success", res.message ?? successMessage ?? "Concluído.");
          if (res.redirect ?? redirectTo) router.push((res.redirect ?? redirectTo)!);
          else router.refresh();
        });
      }}
    >
      {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : icon}
      {label}
    </button>
  );
}

export function SubmitButton({ pending, children, variant = "primary", className, name, value, size = "md" }: { pending: boolean; children: React.ReactNode; variant?: "primary" | "accent" | "danger" | "secondary" | "ghost" | "outline"; className?: string; name?: string; value?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={pending || undefined} className={buttonClass(variant, size, className)}>
      {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}
