import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { formatDateTime } from "@/lib/dates";
import { nameMap } from "@/lib/server/lookups";
import { ENTITY_LABEL, originHref, refLabel } from "../origin";
import { MODULE_LABEL, auditCode, formatStamp, isSensitive } from "../queries";

export const metadata = { title: "Evento de auditoria" };

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "string") return v;
  if (typeof v === "number") return v.toLocaleString("pt-BR");
  return JSON.stringify(v, null, 1);
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("admin");
  const { id } = await params;
  const e = await s.ctx.store.get("audit_logs", id);
  if (!e || e.companyId !== s.ctx.companyId) notFound();
  const before = (e.before ?? {}) as Record<string, any>;
  const after = (e.after ?? {}) as Record<string, any>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const href = await originHref(s.ctx.store, e.entityType, e.entityId, e.related ?? []);
  const branches = await nameMap(s.ctx, "branches");
  const related = (e.related ?? []).filter((r: string) => r !== `${e.entityType}:${e.entityId ?? ""}`);
  const relatedLinks = await Promise.all(related.map(async (r: string) => ({ ...refLabel(r), href: await originHref(s.ctx.store, r.split(":")[0], r.split(":")[1] ?? null, []) })));
  const sameRecord = e.entityId ? (await listAll(s.ctx.store, "audit_logs", { filters: [["eq", "entityType", e.entityType], ["eq", "entityId", e.entityId], ["eq", "companyId", s.ctx.companyId]] }, 1000)).length : 1;
  const origin = e.userId === "system" ? "Rotina automática / tarefa do sistema" : e.ip ? `ERP (navegador) · IP ${e.ip}` : "ERP (servidor)";
  const sameOperation = e.operationId ? await listAll(s.ctx.store, "audit_logs", { filters: [["eq", "operationId", e.operationId]] }, 50) : [];
  return (
    <>
      <PageHeader
        title={e.summary}
        crumbs={[{ label: "Administração" }, { label: "Histórico", href: "/administracao/historico" }, { label: "Evento" }]}
        badges={
          <>
            <StatusBadge kind="audit" status={e.result} />
            {isSensitive(e.action) && <Badge tone="accent">Ação sensível</Badge>}
          </>
        }
        description={`${auditCode(e.id)} · ${formatStamp(e.occurredAt)} (horário de Brasília) · ${e.userName ?? "—"} · ${MODULE_LABEL[e.module] ?? e.module}`}
        actions={
          href && (
            <LinkButton href={href} variant="primary">
              <ExternalLink className="size-4" /> Abrir origem
            </LinkButton>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Evento" className="lg:col-span-1">
          <DefinitionList
            cols={1}
            items={[
              { label: "Identificador", value: auditCode(e.id) },
              { label: "Data/hora", value: formatStamp(e.occurredAt) },
              { label: "Responsável", value: e.userId && e.userId !== "system" ? <Link className="text-brand-700 hover:underline" href={`/administracao/usuarios/${e.userId}`}>{e.userName}</Link> : (e.userName ?? "—") },
              { label: "Perfil no momento do evento", value: e.userRole ?? "Não registrado (evento anterior a este controle)" },
              { label: "Origem", value: origin },
              { label: "Módulo", value: MODULE_LABEL[e.module] ?? e.module },
              { label: "Ação", value: <code className="text-xs">{e.action}</code> },
              { label: "Objeto", value: `${ENTITY_LABEL[e.entityType] ?? e.entityType}${e.entityId ? ` · ${e.entityId}` : ""}` },
              { label: "Filial", value: e.branchId ? (branches.get(e.branchId) ?? e.branchId) : "Empresa (sem filial)" },
              { label: "Situação", value: <StatusBadge kind="audit" status={e.result} /> },
            ]}
          />
          <details className="mt-4 rounded-md border border-line p-3 text-xs">
            <summary className="cursor-pointer font-medium text-slate-600">Dados técnicos</summary>
            <dl className="mt-2 space-y-1 break-all text-slate-600">
              <div><dt className="inline font-semibold">Evento: </dt><dd className="inline font-mono">{e.id}</dd></div>
              <div><dt className="inline font-semibold">Ação: </dt><dd className="inline font-mono">{e.action}</dd></div>
              <div><dt className="inline font-semibold">Registro: </dt><dd className="inline font-mono">{e.entityType}:{e.entityId ?? "—"}</dd></div>
              <div><dt className="inline font-semibold">Operação: </dt><dd className="inline font-mono">{e.operationId ?? "—"}</dd></div>
              <div><dt className="inline font-semibold">IP: </dt><dd className="inline font-mono">{e.ip ?? "—"}</dd></div>
              <div><dt className="inline font-semibold">Gravado em (UTC): </dt><dd className="inline font-mono">{e.occurredAt}</dd></div>
              <div><dt className="inline font-semibold">Relacionados: </dt><dd className="inline font-mono">{(e.related ?? []).join(", ") || "—"}</dd></div>
            </dl>
          </details>
        </Card>
        <div className="space-y-4 lg:col-span-2">
          <Card title="Motivo / contexto">
            {e.reason ? <blockquote className="border-l-2 border-accent-500 pl-3 text-sm text-slate-700">{e.reason}</blockquote> : <p className="text-sm text-slate-500">Sem motivo registrado para este evento.</p>}
          </Card>
          <Card title="O que mudou" description="Campo a campo, antes → depois. Valores sensíveis (senhas, tokens, chaves) aparecem mascarados.">
            {keys.length === 0 ? (
              <EmptyState title="Sem valores registrados" description="Este evento não altera campos (ex.: login, exportação, teste)." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr><th>Campo</th><th>Antes</th><th>Depois</th></tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => {
                      const changed = JSON.stringify(before[k]) !== JSON.stringify(after[k]);
                      return (
                        <tr key={k}>
                          <td className="font-mono text-xs">{k}</td>
                          <td className={changed && k in before ? "bg-red-50/60" : ""}>
                            <pre className="whitespace-pre-wrap break-words font-sans text-xs text-slate-700">{k in before ? fmt(before[k]) : "—"}</pre>
                          </td>
                          <td className={changed && k in after ? "bg-emerald-50/60" : ""}>
                            <pre className="whitespace-pre-wrap break-words font-sans text-xs text-slate-900">{k in after ? fmt(after[k]) : "—"}</pre>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {(relatedLinks.length > 0 || sameOperation.length > 1) && (
            <Card title="Registros relacionados">
              {relatedLinks.length > 0 && (
                <ul className="flex flex-wrap gap-2 text-sm">
                  {relatedLinks.map((r) => (
                    <li key={`${r.type}:${r.id}`}>
                      {r.href ? (
                        <Link className="rounded-full bg-brand-50 px-2.5 py-1 text-brand-800 ring-1 ring-brand-200 hover:underline" href={r.href}>
                          {r.label}
                        </Link>
                      ) : (
                        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-slate-600 ring-1 ring-slate-200">{r.label} {r.id}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {sameOperation.length > 1 && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-semibold text-slate-600">Eventos da mesma operação</p>
                  <ul className="space-y-1 text-sm">
                    {sameOperation
                      .filter((x) => x.id !== e.id)
                      .map((x) => (
                        <li key={x.id}>
                          <Link className="text-brand-700 hover:underline" href={`/administracao/historico/${x.id}`}>{formatDateTime(x.occurredAt)} — {x.summary}</Link>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </Card>
          )}
          {e.entityId && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-4 py-3 text-sm">
              <span className="text-slate-600">{sameRecord} evento{sameRecord === 1 ? "" : "s"} neste registro ({(ENTITY_LABEL[e.entityType] ?? e.entityType).toLowerCase()})</span>
              <LinkButton size="sm" href={`/administracao/historico?entity=${e.entityType}&entityId=${e.entityId}&from=2000-01-01`}>Ver relacionados</LinkButton>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
