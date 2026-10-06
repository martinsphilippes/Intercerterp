"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/**
 * "Instalar app": usa o convite nativo do navegador (Chrome/Edge/Android). No iPhone/iPad (Safari), mostra o passo a passo
 * (Compartilhar → Adicionar à Tela de Início). Some quando o app já está instalado (modo standalone).
 */
export function InstallAppButton({ className = "" }: { className?: string }) {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!evt && !ios)) return null;
  return (
    <div className="relative">
      <button
        type="button"
        className={`focus-ring inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm hover:bg-slate-50 ${className}`}
        onClick={async () => {
          if (evt) {
            await evt.prompt();
            const r = await evt.userChoice.catch(() => null);
            if (r?.outcome === "accepted") setInstalled(true);
            setEvt(null);
          } else setHelp((h) => !h);
        }}
        title="Instalar o Intercert ERP como aplicativo"
      >
        <Download className="size-4" aria-hidden /> <span className="hidden sm:inline">Instalar app</span>
      </button>
      {help && (
        <div role="dialog" className="absolute right-0 z-50 mt-2 w-72 rounded-md border border-line bg-white p-3 text-sm shadow-xl">
          <p className="font-medium">Instalar no iPhone/iPad</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-slate-600">
            <li>Toque em Compartilhar (quadrado com seta) no Safari.</li>
            <li>Escolha “Adicionar à Tela de Início”.</li>
            <li>Confirme em “Adicionar”.</li>
          </ol>
        </div>
      )}
    </div>
  );
}
