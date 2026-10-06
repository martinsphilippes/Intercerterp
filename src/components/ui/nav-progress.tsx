"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const START_EVENT = "intercert:nav-start";
const PENDING_ATTR = "data-nav-pending";

/** Mostra a barra de carregamento no topo (use antes de router.push em ações). */
export function startNavigationProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(START_EVENT));
}

function clearPendingMarks() {
  document.querySelectorAll(`[${PENDING_ATTR}]`).forEach((el) => el.removeAttribute(PENDING_ATTR));
}

/** Link interno que troca de página (ignora nova aba, download, âncora na mesma página e outros sites). */
function navigatingAnchor(e: MouseEvent): HTMLAnchorElement | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || a.target === "_blank" || a.hasAttribute("download")) return null;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return a;
}

function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [width, setWidth] = useState(0);
  const timers = useRef<number[]>([]);
  const route = `${pathname}?${search}`;
  const lastRoute = useRef(route);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const start = () => {
    clearTimers();
    setState("loading");
    setWidth(8);
    // avança rápido no começo e desacelera; só completa quando a página nova chegar
    [[100, 30], [400, 55], [1200, 72], [3000, 85], [7000, 92]].forEach(([ms, w]) => timers.current.push(window.setTimeout(() => setWidth(w), ms)));
    timers.current.push(window.setTimeout(() => finish(), 12000)); // segurança: nunca fica preso
  };

  const finish = () => {
    clearTimers();
    clearPendingMarks();
    setWidth(100);
    setState("done");
    timers.current.push(window.setTimeout(() => { setState("idle"); setWidth(0); }, 300));
  };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = navigatingAnchor(e);
      if (!a) return;
      a.setAttribute(PENDING_ATTR, "");
      start();
    };
    const onSubmit = (e: SubmitEvent) => {
      // formulários GET (filtros e buscas) navegam; os de ações tratam o próprio carregamento
      const f = e.target as HTMLFormElement;
      if (e.defaultPrevented || (f.method || "get").toLowerCase() !== "get") return;
      (e.submitter as HTMLElement | null)?.setAttribute(PENDING_ATTR, "");
      start();
    };
    const onStart = () => start();
    // captura: o Link do Next cancela o clique (preventDefault) antes de chegar ao document
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit);
    window.addEventListener(START_EVENT, onStart);
    window.addEventListener("pageshow", finish);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener(START_EVENT, onStart);
      window.removeEventListener("pageshow", finish);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (route === lastRoute.current) return;
    lastRoute.current = route;
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  if (state === "idle") return null;
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 top-0 z-[200] h-[3px]" role="progressbar" aria-label="Carregando página" aria-busy={state === "loading"}>
      <div
        className="h-full bg-gradient-to-r from-accent-500 to-brand-500 shadow-[0_0_8px_rgb(242_113_28/0.6)] transition-[width,opacity] duration-300 ease-out"
        style={{ width: `${width}%`, opacity: state === "done" ? 0 : 1 }}
      />
    </div>
  );
}

/** Barra de progresso global: aparece ao clicar em links, enviar filtros e após ações que mudam de página. */
export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
