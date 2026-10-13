"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";

/**
 * Download protegido do certificado digital emitido (Tela 67): abre um diálogo pedindo a SENHA DO USUÁRIO
 * (confirmação de identidade), envia POST /api/certificados/<id> e salva o arquivo. Cada download é registrado no
 * histórico do protocolo; a senha do certificado nunca aparece aqui.
 */
export function CertificateDownloadButton({ requestId, fileName, label = "Baixar certificado", variant = "primary", size = "md", className }: { requestId: string; fileName: string; label?: string; variant?: "primary" | "accent" | "secondary" | "outline" | "ghost"; size?: "sm" | "md" | "lg"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) {
      setError("Informe sua senha para confirmar a identidade.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("password", password);
      const res = await fetch(`/api/certificados/${requestId}`, { method: "POST", body: fd });
      if (!res.ok) {
        setError((await res.text()) || "Não foi possível baixar o certificado.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast("success", `Download de ${fileName} registrado no histórico.`);
      setOpen(false);
      setPassword("");
      router.refresh();
    } catch {
      setError("Falha de rede ao baixar o certificado. Tente novamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)} title="Exige a confirmação da sua senha; o download fica registrado">
        <Download className="size-4" aria-hidden /> {label}
      </Button>
      <Dialog open={open} onClose={() => !pending && setOpen(false)} title="Download protegido" size="sm">
        <form onSubmit={submit} className="space-y-4">
          <p className="break-all text-sm text-slate-600">
            Arquivo: <span className="font-medium text-ink">{fileName}</span>
          </p>
          <p className="flex items-start gap-2 rounded-md border border-line bg-slate-50 p-3 text-xs text-slate-600">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
            Confirme a sua senha de acesso ao sistema. O download é registrado com data, hora e usuário no histórico da solicitação. A senha do certificado não é exibida nem enviada por aqui.
          </p>
          <Field label="Sua senha" required error={error} htmlFor={`cert-pw-${requestId}`}>
            <Input id={`cert-pw-${requestId}`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={pending} autoFocus aria-invalid={error ? true : undefined} />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              Confirmar e baixar
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
