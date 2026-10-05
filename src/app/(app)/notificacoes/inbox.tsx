"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, CheckCheck, Mail, MailOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { markAction, archiveAction, unarchiveAction } from "./actions";

export type InboxItem = {
  id: string;
  title: string;
  area: string;
  branch: string;
  at: string;
  read: boolean;
  occ: string;
  level: { label: string; tone: "bad" | "accent" | "neutral" };
  href: string;
  selected: boolean;
};

type Result = { ok: true; message?: string } | { ok: false; error: string };

export function Inbox({ items, archivedView }: { items: InboxItem[]; archivedView: boolean }) {
  const [sel, setSel] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast("error", r.error);
      else toast("success", r.message ?? "Concluído.");
      setSel([]);
      router.refresh();
    });
  const ids = items.map((i) => i.id);
  const target = sel.length ? sel : ids;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <label className="mr-1 inline-flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" className="size-4 accent-brand-700" checked={sel.length > 0 && sel.length === ids.length} onChange={(e) => setSel(e.target.checked ? ids : [])} aria-label="Selecionar exibidas" />
          {sel.length ? `${sel.length} selecionada(s)` : "Selecionar"}
        </label>
        {!archivedView && (
          <Button size="sm" variant="ghost" disabled={pending || !items.length} onClick={() => run(() => markAction(target, true))} title={sel.length ? "Marcar selecionadas como lidas" : "Marcar todas as exibidas como lidas"}>
            <CheckCheck className="size-4" /> {sel.length ? "Marcar como lidas" : "Marcar exibidas como lidas"}
          </Button>
        )}
        {!archivedView && sel.length > 0 && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => markAction(sel, false))}>
            <Mail className="size-4" /> Não lidas
          </Button>
        )}
        {!archivedView && sel.length > 0 && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => archiveAction(sel))} title="Somente informativas ou já resolvidas na origem">
            <Archive className="size-4" /> Arquivar
          </Button>
        )}
        {archivedView && sel.length > 0 && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => unarchiveAction(sel))}>
            <MailOpen className="size-4" /> Devolver à caixa de entrada
          </Button>
        )}
      </div>
      <ul className="divide-y divide-line">
        {items.map((n) => (
          <li key={n.id} className={cn("flex gap-2 px-3 py-3", n.selected ? "border-l-4 border-l-brand-600 bg-brand-50/60" : "border-l-4 border-l-transparent hover:bg-slate-50")}>
            <input type="checkbox" className="mt-1 size-4 shrink-0 accent-brand-700" checked={sel.includes(n.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, n.id] : s.filter((x) => x !== n.id)))} aria-label={`Selecionar ${n.title}`} />
            <Link href={n.href} className="min-w-0 flex-1" scroll={false}>
              <p className={cn("flex items-start gap-1.5 text-sm", n.read ? "text-slate-700" : "font-semibold text-ink")}>
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Não lida" />}
                <span className="min-w-0">{n.title}</span>
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                <Badge tone={n.level.tone}>{n.level.label}</Badge>
                <span>{n.area}</span>
                <span>· {n.branch}</span>
                {n.occ === "resolved" && <Badge tone="good">Resolvida</Badge>}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">{n.at}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
