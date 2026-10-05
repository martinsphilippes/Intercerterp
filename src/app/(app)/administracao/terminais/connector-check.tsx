"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plug, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { checkConnectorServerAction, recordBrowserConnectorAction } from "./actions";

/**
 * Teste do conector local. Topologia usual: o conector roda no computador do caixa (127.0.0.1), portanto só é
 * alcançável a partir do NAVEGADOR daquele computador — a verificação é feita aqui e o resultado medido é registrado.
 * A verificação pelo servidor serve para conectores expostos em endereço de rede alcançável pelo servidor.
 */
export function ConnectorCheck({ id, url }: { id: string; url: string | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; verified: boolean; message: string; origin: string } | null>(null);
  const toast = useToast();
  const router = useRouter();
  const fromBrowser = () =>
    start(async () => {
      if (!url) {
        const r = await checkConnectorServerAction(id);
        if (r.ok) setResult(r.data as any);
        router.refresh();
        return;
      }
      const t0 = performance.now();
      let payload: { ok: boolean; httpStatus?: number; latencyMs?: number; error?: string; body?: unknown };
      try {
        const res = await fetch(`${url.replace(/\/+$/, "")}/status`, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" }, cache: "no-store" });
        const latencyMs = Math.round(performance.now() - t0);
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        payload = { ok: res.ok, httpStatus: res.status, latencyMs, body };
      } catch (e: any) {
        const latencyMs = Math.round(performance.now() - t0);
        const msg = e?.name === "TimeoutError" ? "tempo limite de 5 s excedido" : `${e?.message ?? e} (conector parado, endereço incorreto, ou bloqueio de CORS/rede privada)`;
        payload = { ok: false, latencyMs, error: msg };
      }
      const r = await recordBrowserConnectorAction(id, payload);
      if (!r.ok) return toast("error", r.error);
      setResult(r.data as any);
      router.refresh();
    });
  const fromServer = () =>
    start(async () => {
      const r = await checkConnectorServerAction(id);
      if (!r.ok) return toast("error", r.error);
      setResult(r.data as any);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={fromBrowser} loading={pending}>
          <Plug className="size-4" /> {url ? "Testar conector (deste navegador)" : "Testar conector"}
        </Button>
        {url && (
          <Button type="button" variant="ghost" onClick={fromServer} disabled={pending} title="Somente para conectores expostos em endereço alcançável pelo servidor">
            <Server className="size-4" /> Testar a partir do servidor
          </Button>
        )}
      </div>
      {result && (
        <Notice tone={!result.verified ? "info" : result.ok ? "good" : "bad"} title={!result.verified ? "Não verificado" : result.ok ? "Conector respondeu" : "Falha no conector"}>
          {result.message} {result.verified && <span className="text-xs">(verificado {result.origin === "browser" ? "pelo navegador" : "pelo servidor"})</span>}
        </Notice>
      )}
    </div>
  );
}
