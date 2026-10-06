import Link from "@/components/ui/link";
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
import { Badge } from "@/components/ui/badge";
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
  const { tab = "identificacao" } = await searchParams;
  const t = await s.ctx.store.get("terminals", id);
  if (!t || t.companyId !== s.ctx.companyId) notFound();
  const [branch, wh, current, sessions, users, fiscalCfgs, methods] = await Promise.all([
    s.ctx.store.get("branches", t.branchId),
    t.defaultWarehouseId ? s.ctx.store.get("warehouses", t.defaultWarehouseId) : Promise.resolve(null),
    openSession(s.ctx.store, id),
    terminalSessions(s.ctx.store, id),
    listAll(s.ctx.store, "users"),
    listAll(s.ctx.store, "fiscal_configs", { filters: [["eq", "branchId", t.branchId]] }),
    listAll(s.ctx.store, "payment_methods", { filters: [["eq", "companyId", s.ctx.companyId], ["eq", "active", true]] }),
  ]);
  const fiscalCfg = fiscalCfgs[0] ?? null;
  const siblings = await listAll(s.ctx.store, "terminals", { filters: [["eq", "branchId", t.branchId], ["eq", "status", "active"]] });
  type Check = { label: string; tone: "good" | "warn" | "bad" | "info"; detail: string };
  const checks: Check[] = [
    { label: "Filial", tone: branch?.status === "inactive" ? "bad" : "good", detail: branch ? `${branch.name}${branch.status === "inactive" ? " (inativa)" : ""}` : "não encontrada" },
    { label: "Emissão de NFC-e na filial", tone: fiscalCfg?.nfceEnabled ? (fiscalCfg.provider === "simulated" ? "info" : "good") : "warn", detail: fiscalCfg ? (fiscalCfg.nfceEnabled ? `habilitada (${fiscalCfg.provider === "simulated" ? "simulação, sem validade fiscal" : fiscalCfg.provider}, ${fiscalCfg.environment ?? "—"})` : "desabilitada na configuração fiscal") : "filial sem configuração fiscal" },
    { label: "Série NFC-e do terminal", tone: t.nfceSeries == null ? "warn" : siblings.some((x) => x.id !== t.id && x.nfceSeries === t.nfceSeries) ? "bad" : "good", detail: t.nfceSeries == null ? "não definida (usa a série da filial)" : `série ${t.nfceSeries}, exclusiva entre os terminais ativos da filial` },
    { label: "Depósito de saída", tone: wh && wh.status === "inactive" ? "bad" : "good", detail: wh ? `${wh.name}${wh.status === "inactive" ? " (inativo)" : ""}` : "depósito padrão da filial" },
    {
      label: "Impressora",
      tone: t.printerMode === "none" ? "warn" : !t.lastPrinterTestAt ? "warn" : String(t.lastPrinterTestResult ?? "").startsWith("Conector com falha") ? "bad" : "good",
      detail: t.printerMode === "none" ? "sem impressora: cupom só em tela/e-mail" : t.lastPrinterTestAt ? `último teste ${formatDateTime(t.lastPrinterTestAt)} — ${t.lastPrinterTestResult ?? ""}` : "nunca testada — use “Prévia de impressão”",
    },
    { label: "Leitor de código de barras", tone: t.scannerMode === "hid" && !t.connectorUrl ? "bad" : "good", detail: label(SCANNER_MODES, t.scannerMode) },
    { label: "Cartão / TEF", tone: t.tefProvider === "tef_connector" && !t.connectorUrl ? "bad" : "good", detail: `${label(TEF_PROVIDERS, t.tefProvider)}${t.tefConfig?.acquirer ? ` — ${t.tefConfig.acquirer}` : ""}` },
    { label: "Caixa", tone: "info", detail: current ? `aberto (nº ${current.number}) por ${users.find((u) => u.id === current.operatorId)?.name ?? "—"}: filial, série e depósito só mudam com o caixa fechado` : "fechado" },
  ];
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
        description={`${branch?.name ?? "—"} · ${current ? `caixa aberto por ${users.find((u) => u.id === current.operatorId)?.name ?? "—"}` : "caixa fechado"} · série NFC-e ${t.nfceSeries ?? "—"}`}
        actions={
          <>
            {t.printerMode !== "none" && (
              <LinkButton href={`${base}/teste-impressao`} target="_blank">
                <Printer className="size-4" /> Prévia de impressão
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
          { key: "identificacao", label: "Identificação" },
          { key: "perifericos", label: "Periféricos" },
          { key: "pagamentos", label: "Pagamentos" },
          { key: "sessoes", label: "Sessões de caixa", count: sessions.length },
          { key: "historico", label: "Histórico" },
          ...(edit ? [{ key: "editar", label: "Editar configuração" }] : []),
        ]}
      />
      {tab === "identificacao" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Identificação, caixa e fiscal">
            <DefinitionList
              items={[
                { label: "Código", value: t.code },
                { label: "Nome / local", value: t.name },
                { label: "Filial", value: branch ? <Link className="text-brand-700 hover:underline" href={`/administracao/empresas/filiais/${branch.id}`}>{branch.name}</Link> : "—" },
                { label: "Situação", value: <StatusBadge kind="generic" status={t.status} /> },
                { label: "Série NFC-e", value: t.nfceSeries ?? "—" },
                { label: "Depósito de saída das vendas", value: wh?.name ?? "Depósito padrão da filial" },
                { label: "Venda sem saldo", value: t.allowNegativeStock ? "Permitida neste terminal" : "Conforme parâmetro da filial/empresa" },
                { label: "Cadastrado em", value: formatDateTime(t.createdAt) },
              ]}
            />
          </Card>
          <Card title="Conferir configuração" description="Verificação a partir dos cadastros e dos testes registrados (nada é presumido).">
            <ul className="space-y-2 text-sm">
              {checks.map((c) => (
                <li key={c.label} className="flex items-start gap-2">
                  <Badge tone={c.tone} className="mt-0.5 shrink-0">{c.tone === "good" ? "OK" : c.tone === "bad" ? "Corrigir" : c.tone === "warn" ? "Atenção" : "Info"}</Badge>
                  <span><span className="font-medium">{c.label}:</span> <span className="text-slate-600">{c.detail}</span></span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {tab === "pagamentos" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Cartão / TEF" actions={edit && <LinkButton size="sm" href={`${base}?tab=editar`}>Alterar</LinkButton>}>
            <DefinitionList
              cols={1}
              items={[
                { label: "Modo", value: label(TEF_PROVIDERS, t.tefProvider) },
                { label: "Adquirente / credenciadora", value: t.tefConfig?.acquirer },
                { label: "Código do estabelecimento", value: t.tefConfig?.merchantId },
                { label: "Conector local", value: t.tefProvider === "tef_connector" ? (t.connectorUrl ?? "não configurado") : "não utilizado" },
              ]}
            />
            <p className="mt-3 text-xs text-slate-500">Sem TEF integrado, o operador informa NSU e autorização da maquininha; a venda só é concluída com esses dados.</p>
          </Card>
          <Card title="Formas de pagamento disponíveis no PDV" bodyClass="p-0" actions={<LinkButton size="sm" href="/financeiro/cadastros">Meios de pagamento</LinkButton>}>
            <table className="table-base w-full text-sm">
              <thead>
                <tr><th>Forma</th><th className="text-right">Taxa</th><th className="text-right">Prazo</th><th>No PDV</th></tr>
              </thead>
              <tbody>
                {methods.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className="tabular text-right">{((m.feeBps ?? 0) / 100).toLocaleString("pt-BR")}%</td>
                    <td className="tabular text-right">{m.settlementDays ?? 0} d</td>
                    <td>{m.availablePdv ? "Sim" : "Não"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
      {tab === "editar" && edit && <TerminalForm terminal={t} {...await terminalFormOptions(s.ctx)} />}
      {tab === "perifericos" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Impressora de comprovantes, leitor e gaveta" className="lg:col-span-2" actions={edit && <LinkButton size="sm" href={`${base}?tab=editar`}>Alterar</LinkButton>}>
            <DefinitionList
              cols={3}
              items={[
                { label: "Conexão da impressora", value: label(PRINTER_MODES, t.printerMode) },
                { label: "Identificação da impressora", value: t.printerName },
                { label: "Largura do papel", value: `${t.paperWidth ?? 80} mm` },
                { label: "Leitor de código de barras", value: label(SCANNER_MODES, t.scannerMode) },
                { label: "Gaveta de dinheiro", value: t.printerMode === "none" ? "Sem impressora" : t.drawerOnCash ? "Abre no recebimento em dinheiro (pela impressora)" : "Não abre automaticamente" },
                { label: "Conector local", value: t.connectorUrl ?? "Não configurado" },
              ]}
            />
          </Card>
          <Card title="Prévia de impressão" description="Abre um cupom de teste na largura do papel e aciona o diálogo de impressão do navegador.">
            <div className="space-y-3">
              <LinkButton href={`${base}/teste-impressao`} target="_blank" variant="primary">
                <Printer className="size-4" /> Prévia de impressão (página de teste)
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
