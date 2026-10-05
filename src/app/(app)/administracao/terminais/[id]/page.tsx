import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Printer } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { LinkTabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/action-form";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { PRINTER_MODES, SCANNER_MODES, TEF_PROVIDERS, openSession, terminalSessions } from "@/domain/terminals";
import { setTerminalStatusAction } from "../actions";
import { TerminalForm } from "../terminal-form";
import { terminalFormOptions } from "../form-options";
import { ConnectorCheck } from "../connector-check";

export const metadata = { title: "Terminal" };

const label = (list: Array<{ value: string; label: string }>, v: string | null) => list.find((x) => x.value === v)?.label ?? v ?? "—";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("admin");
  const { id } = await params;
  const { tab = "resumo" } = await searchParams;
  const t = await s.ctx.store.get("terminals", id);
  if (!t || t.companyId !== s.ctx.companyId) notFound();
  const [branch, wh, current, sessions, users] = await Promise.all([
    s.ctx.store.get("branches", t.branchId),
    t.defaultWarehouseId ? s.ctx.store.get("warehouses", t.defaultWarehouseId) : Promise.resolve(null),
    openSession(s.ctx.store, id),
    terminalSessions(s.ctx.store, id),
    listAll(s.ctx.store, "users"),
  ]);
  const uname = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const tests = tab === "perifericos" ? await listAll(s.ctx.store, "audit_logs", { filters: [["eq", "entityType", "terminal"], ["eq", "entityId", id], ["eq", "action", ["terminal.print_test_page", "terminal.connector_check"]]], orderBy: [{ field: "occurredAt", dir: "desc" }] }, 30) : [];
  const edit = can(s.user, "admin", "edit");
  const base = `/administracao/terminais/${id}`;
  const closed = sessions.filter((x) => x.status === "closed");
  const withDiff = closed.filter((x) => Object.values((x.differences ?? {}) as Record<string, number>).some((v) => Number(v) !== 0));
  return (
    <>
      <PageHeader
        title={`${t.code} — ${t.name}`}
        crumbs={[{ label: "Administração" }, { label: "Terminais", href: "/administracao/terminais" }, { label: t.name }]}
        badges={<StatusBadge kind="generic" status={t.status} />}
        description={`${branch?.name ?? "—"} · série NFC-e ${t.nfceSeries ?? "—"}`}
        actions={
          <>
            {t.printerMode !== "none" && (
              <LinkButton href={`${base}/teste-impressao`} target="_blank">
                <Printer className="size-4" /> Imprimir página de teste
              </LinkButton>
            )}
            {edit && (
              <LinkButton href={`${base}?tab=editar`} variant="primary">
                <Pencil className="size-4" /> Editar
              </LinkButton>
            )}
            {edit && t.status === "active" && <ActionButton action={setTerminalStatusAction.bind(null, id, "inactive")} label="Inativar" askReason="Motivo da inativação do terminal:" />}
            {edit && t.status === "inactive" && <ActionButton action={setTerminalStatusAction.bind(null, id, "active")} label="Reativar" />}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Caixa atual" value={current ? `Aberto (nº ${current.number})` : "Fechado"} tone={current ? "good" : "default"} hint={current ? `${uname(current.operatorId)} desde ${formatDateTime(current.openedAt)}` : sessions[0] ? `Último fechamento: ${formatDateTime(sessions.find((x) => x.closedAt)?.closedAt)}` : "Nenhuma sessão registrada"} href={current ? `/caixa/${current.id}` : undefined} />
        <Stat label="Sessões registradas" value={sessions.length} href={`${base}?tab=sessoes`} />
        <Stat label="Fechamentos com diferença" value={withDiff.length} tone={withDiff.length ? "warn" : "default"} hint={`de ${closed.length} fechamentos`} href={`${base}?tab=sessoes`} />
        <Stat label="Último teste de periféricos" value={t.lastPrinterTestAt ? formatDateTime(t.lastPrinterTestAt) : "Nunca"} tone={t.lastPrinterTestAt ? "default" : "warn"} href={`${base}?tab=perifericos`} />
      </div>
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "resumo", label: "Configuração" },
          ...(edit ? [{ key: "editar", label: "Editar" }] : []),
          { key: "perifericos", label: "Periféricos e testes" },
          { key: "sessoes", label: "Sessões de caixa", count: sessions.length },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {tab === "resumo" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Caixa e fiscal">
            <DefinitionList
              items={[
                { label: "Filial", value: branch ? <Link className="text-brand-700 hover:underline" href={`/administracao/empresas/filiais/${branch.id}`}>{branch.name}</Link> : "—" },
                { label: "Série NFC-e", value: t.nfceSeries ?? "—" },
                { label: "Depósito de saída das vendas", value: wh?.name ?? "Depósito padrão da filial" },
                { label: "Venda sem saldo", value: t.allowNegativeStock ? "Permitida neste terminal" : "Conforme parâmetro da filial/empresa" },
              ]}
            />
          </Card>
          <Card title="Periféricos">
            <DefinitionList
              items={[
                { label: "Impressão", value: label(PRINTER_MODES, t.printerMode) },
                { label: "Impressora", value: t.printerName },
                { label: "Papel", value: `${t.paperWidth ?? 80} mm` },
                { label: "Leitor", value: label(SCANNER_MODES, t.scannerMode) },
                { label: "Cartão / TEF", value: `${label(TEF_PROVIDERS, t.tefProvider)}${t.tefConfig?.acquirer ? ` — ${t.tefConfig.acquirer}` : ""}` },
                { label: "Conector local", value: t.connectorUrl ?? "Não configurado" },
              ]}
            />
          </Card>
        </div>
      )}
      {tab === "editar" && edit && <TerminalForm terminal={t} {...await terminalFormOptions(s.ctx)} />}
      {tab === "perifericos" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Impressão pelo navegador" description="Abre um cupom de teste na largura do papel e aciona o diálogo de impressão.">
            <div className="space-y-3">
              <LinkButton href={`${base}/teste-impressao`} target="_blank" variant="primary">
                <Printer className="size-4" /> Imprimir página de teste
              </LinkButton>
              <p className="text-xs text-slate-500">Registramos que a página foi aberta; o navegador não confirma a impressão física — confira o papel na impressora.</p>
            </div>
          </Card>
          <Card title="Conector local" description="GET /status no endereço configurado, com tempo limite de 5 s. Resultado real registrado.">
            {!t.connectorUrl && <div className="mb-3"><Notice tone="info">Sem conector configurado: o teste registra “não verificado”.</Notice></div>}
            <ConnectorCheck id={id} url={t.connectorUrl ?? null} />
            <p className="mt-3 text-xs text-slate-500">Contrato HTTP do conector: <code>docs/integracoes.md</code>, seção “Conector de periféricos”.</p>
          </Card>
          <Card title="Último resultado registrado" className="lg:col-span-2">
            <p className="text-sm">{t.lastPrinterTestResult ?? "Nenhum teste registrado."}</p>
            {t.lastPrinterTestAt && <p className="mt-1 text-xs text-slate-500">{formatDateTime(t.lastPrinterTestAt)}</p>}
          </Card>
          <Card title="Testes anteriores" bodyClass="p-0" className="lg:col-span-2">
            {tests.length === 0 ? (
              <EmptyState title="Nenhum teste registrado" />
            ) : (
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Data/hora</th><th>Usuário</th><th>Teste</th><th>Resultado</th></tr>
                </thead>
                <tbody>
                  {tests.map((x) => (
                    <tr key={x.id}>
                      <td className="whitespace-nowrap"><Link className="text-brand-700 hover:underline" href={`/administracao/historico/${x.id}`}>{formatDateTime(x.occurredAt)}</Link></td>
                      <td>{x.userName}</td>
                      <td>{x.action === "terminal.print_test_page" ? "Página de teste (navegador)" : `Conector (${x.after?.origin === "browser" ? "navegador" : "servidor"})`}</td>
                      <td>
                        <StatusBadge kind="audit" status={x.result} /> <span className="text-xs text-slate-600">{x.summary.replace(/^.*?: /, "")}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
      {tab === "sessoes" && (
        <Card bodyClass="p-0">
          {sessions.length === 0 ? (
            <EmptyState title="Nenhuma sessão de caixa neste terminal" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr><th>Sessão</th><th>Operador</th><th>Abertura</th><th className="text-right">Fundo</th><th>Fechamento</th><th>Fechado por</th><th className="text-right">Diferença</th><th>Situação</th></tr>
                </thead>
                <tbody>
                  {sessions.map((x) => {
                    const diff = Object.values((x.differences ?? {}) as Record<string, number>).reduce((a, v) => a + (Number(v) || 0), 0);
                    return (
                      <tr key={x.id}>
                        <td><Link className="text-brand-700 hover:underline" href={`/caixa/${x.id}`}>nº {x.number}</Link></td>
                        <td>{uname(x.operatorId)}</td>
                        <td>{formatDateTime(x.openedAt)}</td>
                        <td className="tabular text-right">{formatMoney(x.openingFund ?? 0)}</td>
                        <td>{formatDateTime(x.closedAt)}</td>
                        <td>{x.closedBy ? uname(x.closedBy) : "—"}</td>
                        <td className={`tabular text-right ${diff ? "text-amber-700" : ""}`}>{x.status === "closed" ? formatMoney(diff) : "—"}</td>
                        <td><StatusBadge kind="cash" status={x.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={s.ctx.store} refs={[`terminal:${id}`]} />
        </Card>
      )}
    </>
  );
}
