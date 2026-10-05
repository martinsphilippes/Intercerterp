import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import QRCode from "qrcode";
import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList, Stat } from "@/components/ui/card";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { LinkTabs } from "@/components/ui/tabs";
import { Timeline } from "@/components/ui/timeline";
import { EmptyState, Notice } from "@/components/ui/empty";
import { formatBps, formatMoney, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import type { SessionInfo } from "@/lib/server/session";
import { cancelWindow, DOC_STATUS_LABEL, FREIGHT_MODE_LABEL, getFiscalConfig, PRESENCE_LABEL, PURPOSE_LABEL, type DocItem } from "@/domain/fiscal/service";
import { currentIssues } from "@/domain/fiscal/nfe";
import { TPAG_LABEL } from "@/domain/fiscal/providers";
import { DocActions } from "./doc-actions";
import { MODEL_LABEL, ORIGIN_LABEL, OP_LABEL, docNumberLabel, formatKey, originHref, partyHref } from "../labels";

export const EVENT_LABEL: Record<string, string> = {
  created: "Criação",
  request: "Envio ao provedor",
  send: "Retorno do envio",
  query: "Consulta",
  retry: "Retransmissão solicitada",
  submit: "Envio para transmissão",
  validation: "Validação prévia",
  edit: "Edição/correção",
  refresh: "Atualização do cadastro",
  cce: "Carta de correção",
  cancel: "Cancelamento",
  cancel_request: "Cancelamento solicitado pela origem",
  discard: "Descarte",
  disable: "Inutilização",
  email: "E-mail",
  effects: "Efeitos (estoque/financeiro)",
  effects_reversal: "Reversão de efeitos",
  download: "Download de arquivo",
  contingency_release: "Liberação da contingência",
};

const ENV_LABEL: Record<string, string> = { simulacao: "Simulação", homologacao: "Homologação", producao: "Produção" };

function formatDateTimeSec(v?: string | null) {
  if (!v) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }).format(new Date(v));
}

function statusTone(status: string): "bad" | "warn" | "info" | "good" | "sim" {
  if (["rejected", "denied", "error"].includes(status)) return "bad";
  if (["pending", "draft"].includes(status)) return "warn";
  if (status === "authorized") return "good";
  return "info";
}

export async function DocDetail({ s, doc, tab }: { s: SessionInfo; doc: Doc; tab: string }) {
  const model = doc.model as "nfe" | "nfce" | "nfse";
  const base = `/fiscal/${model}/${doc.id}`;
  const cfg = await getFiscalConfig(s.ctx.store, s.ctx.companyId, doc.branchId);
  const events = await listAll(s.ctx.store, "fiscal_events", { filters: [["eq", "documentId", doc.id]], orderBy: [{ field: "occurredAt", dir: "desc" }] });
  const issues = ["draft", "pending", "rejected"].includes(doc.status) && doc.originType !== "disable" ? await currentIssues(s.ctx, doc) : [];
  const branch = doc.branchId ? await s.ctx.store.get("branches", doc.branchId) : null;
  const win = cancelWindow(doc, cfg);
  const items = (doc.items ?? []) as DocItem[];
  const t = doc.totals ?? {};
  const svc = doc.service ?? {};
  const oHref = originHref(doc.originType, doc.originId);
  const pHref = partyHref(doc.partyType, doc.partyId);
  const sale = doc.originType === "sale" && doc.originId ? await s.ctx.store.get("sales", doc.originId) : null;
  const salePayments = sale ? await listAll(s.ctx.store, "sale_payments", { filters: [["eq", "saleId", sale.id]], orderBy: [{ field: "seq" }] }) : [];
  const terminal = doc.terminalId ? await s.ctx.store.get("terminals", doc.terminalId) : null;
  const operator = doc.operatorId ? await s.ctx.store.get("users", doc.operatorId) : null;
  const title = doc.effects?.titleId ?? doc.titleId ? await s.ctx.store.get("titles", doc.effects?.titleId ?? doc.titleId) : null;
  const qrSvg = doc.qrCodeUrl ? await QRCode.toString(doc.qrCodeUrl, { type: "svg", margin: 1, width: 150 }) : null;
  const cce = events.filter((e) => e.type === "cce" && e.status === "authorized");
  const label = `${MODEL_LABEL[model]} ${docNumberLabel(doc)}`;
  const editHref = model === "nfe" ? `/fiscal/nfe/nova?rascunho=${doc.id}` : model === "nfse" ? `/fiscal/nfse/nova?id=${doc.id}` : null;
  const crumbsHref = `/fiscal/${model}`;
  const units = items.reduce((a, i) => a + i.qty, 0);
  const payLabel = [...new Set(((doc.payments ?? []) as Array<{ kind: string }>).map((p) => TPAG_LABEL[p.kind] ?? p.kind))].join(" + ") || "—";
  return (
    <>
      <PageHeader
        title={label}
        crumbs={[{ label: "Fiscal" }, { label: MODEL_LABEL[model], href: crumbsHref }, { label: docNumberLabel(doc) }]}
        badges={
          <>
            <StatusBadge kind="fiscal" status={doc.status} />
            <SimBadge show={Boolean(doc.isSimulated)} />
            {doc.contingency && <Badge tone="warn">Contingência</Badge>}
            {doc.environment && !doc.isSimulated && <Badge tone={doc.environment === "producao" ? "brand" : "info"}>{ENV_LABEL[doc.environment] ?? doc.environment}</Badge>}
            {doc.correctionCount ? <Badge tone="info">CC-e: {doc.correctionCount}</Badge> : null}
          </>
        }
        description={[doc.nature, branch?.name, doc.ref ? `ref. ${doc.ref}` : null].filter(Boolean).join(" · ")}
        actions={
          <DocActions
            id={doc.id}
            model={model}
            status={doc.status}
            attempts={doc.attempts ?? 0}
            hasProtocol={Boolean(doc.protocol)}
            xmlFileId={doc.xmlFileId}
            danfeUrl={doc.danfeUrl}
            isSimulated={Boolean(doc.isSimulated)}
            canIssue={can(s.user, "fiscal", "create") && canDo(s.user, "fiscal.issue") && Boolean(s.branch)}
            canCancel={can(s.user, "fiscal", "edit") && canDo(s.user, "fiscal.cancel")}
            cancelAllowed={win.allowed}
            cancelReason={win.reason}
            defaultEmail={doc.lastEmailTo ?? doc.recipient?.email ?? null}
            editHref={doc.originType === "disable" ? null : editHref}
          />
        }
      />
      {doc.isSimulated && (
        <div className="mb-4">
          <Notice tone="sim" title="SIMULAÇÃO — SEM VALOR FISCAL">
            Documento gerado pelo provedor de simulação: chave, protocolo e XML não existem na SEFAZ/prefeitura. Use apenas para demonstração e treinamento.
          </Notice>
        </div>
      )}
      {doc.statusMessage && doc.status !== "authorized" && (
        <div className="mb-4">
          <Notice tone={statusTone(doc.status)} title={`${DOC_STATUS_LABEL[doc.status] ?? doc.status}${doc.statusCode ? ` (código ${doc.statusCode})` : ""}`}>
            {doc.statusMessage}
          </Notice>
        </div>
      )}
      {issues.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn" title="Pendências que impedem a transmissão">
            <ul className="list-disc pl-5">
              {issues.map((i, k) => (
                <li key={k}>{i}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              Corrija o cadastro (produto, cliente, emitente em <Link className="underline" href="/fiscal/configuracoes">Configurações fiscais</Link>), use “Atualizar do cadastro” e depois “Retransmitir” — a referência {doc.ref} é mantida.
            </p>
          </Notice>
        </div>
      )}
      {doc.cancelRequestedAt && doc.status !== "cancelled" && doc.status !== "discarded" && (
        <div className="mb-4">
          <Notice tone="warn" title="Cancelamento solicitado pela operação de origem">
            Solicitado em {formatDateTime(doc.cancelRequestedAt)}: {doc.cancelReason}. {win.allowed ? "A tarefa de cancelamento está na fila." : win.reason}
          </Notice>
        </div>
      )}
      {doc.status === "authorized" && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <ShieldCheck className="size-5 shrink-0" />
          <div>
            <p className="font-semibold">{doc.isSimulated ? `${MODEL_LABEL[model]} autorizada pelo provedor de SIMULAÇÃO (sem validade fiscal)` : `${MODEL_LABEL[model]} autorizada ${model === "nfse" ? "pela prefeitura/ambiente nacional" : "pela SEFAZ"}`}</p>
            <p className="text-xs">Protocolo {doc.protocol ?? "—"} • {formatDateTimeSec(doc.authorizedAt)} • {doc.contingency ? "Emissão em contingência" : "Autorização normal"}{doc.verificationCode ? ` • Código de verificação ${doc.verificationCode}` : ""}</p>
          </div>
        </div>
      )}
      {doc.status === "cancelled" && (
        <div className="mb-4 rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-semibold">Documento cancelado em {formatDateTimeSec(doc.cancelledAt)}</p>
          <p className="text-xs">Justificativa: {doc.cancelReason ?? "—"} • protocolo de autorização original {doc.protocol ?? "—"}</p>
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {model === "nfce" ? (
          <>
            <Stat label="Consumidor" value={<span className="text-base">{doc.recipientName ?? "Não identificado"}</span>} hint={doc.recipientDoc ? formatDoc(doc.recipientDoc) : undefined} />
            <Stat label="Operador • caixa" value={<span className="text-base">{operator?.name ?? "—"}</span>} hint={terminal ? `${terminal.code} — ${terminal.name}` : undefined} />
            <Stat label="Produtos" value={<span className="text-base">{items.length} itens • {formatQty(units)} un.</span>} />
            <Stat label="Valor total" value={formatMoney(doc.total)} />
            <Stat label="Tributos estimados" value={formatMoney(t.approxTax ?? 0)} hint="Lei 12.741/2012 (percentual parametrizado)" />
            <Stat label="Forma de pagamento" value={<span className="text-base">{payLabel}</span>} />
          </>
        ) : model === "nfse" ? (
          <>
            <Stat label="Tomador" value={<span className="text-base">{doc.recipientName ?? "—"}</span>} hint={doc.recipientDoc ? formatDoc(doc.recipientDoc) : undefined} />
            <Stat label="Valor dos serviços" value={formatMoney(doc.total)} />
            <Stat label="Base de cálculo" value={formatMoney(svc.base)} />
            <Stat label="ISS calculado" value={formatMoney(svc.iss)} hint={`${formatBps(svc.issRateBps)} · ${svc.issWithheld ? "retido pelo tomador" : "não retido"}`} />
            <Stat label="Retenções" value={formatMoney(svc.withheld)} />
            <Stat label="Valor líquido" value={formatMoney(svc.net)} tone="good" />
          </>
        ) : (
          <>
            <Stat label="Destinatário" value={<span className="text-base">{doc.recipientName ?? "—"}</span>} hint={doc.recipientDoc ? formatDoc(doc.recipientDoc) : undefined} />
            <Stat label="Natureza da operação" value={<span className="text-base">{doc.nature}</span>} hint={`${OP_LABEL[doc.operationType] ?? doc.operationType} · ${PURPOSE_LABEL[doc.purpose] ?? doc.purpose}`} />
            <Stat label="Valor total" value={formatMoney(doc.total)} hint={`ICMS ${formatMoney(t.icms ?? 0)}`} />
            <Stat label="Produtos" value={<span className="text-base">{items.length} itens • {formatQty(units)} un.</span>} />
            <Stat label="Transportadora" value={<span className="text-base">{doc.transport?.carrierName ?? (String(doc.transport?.mode ?? "9") === "9" ? "Sem frete" : "Não informada")}</span>} hint={FREIGHT_MODE_LABEL[String(doc.transport?.mode ?? "9")]} />
            <Stat label="Tributos estimados" value={formatMoney(t.approxTax ?? 0)} hint="Lei 12.741/2012 (percentual parametrizado)" />
          </>
        )}
      </div>
      {model !== "nfse" && (
        <div className="mb-4 rounded-lg border border-line bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Chave de acesso</p>
          <p className="mt-1 break-all font-mono text-sm tracking-wide text-ink">{doc.accessKey ? formatKey(doc.accessKey) : "Gerada na autorização"}</p>
          <p className="mt-1 text-xs text-slate-500">Emissão {formatDateTime(doc.issuedAt)} · tentativas de envio: {doc.attempts ?? 0} · prazo de cancelamento: {doc.status === "authorized" ? (win.until ? `${formatDateTime(win.until)}${win.allowed ? "" : " (encerrado)"}` : "conforme município") : "—"}</p>
        </div>
      )}
      <LinkTabs
        basePath={base}
        active={tab}
        tabs={[
          { key: "resumo", label: "Resumo" },
          ...(model !== "nfse" ? [{ key: "itens", label: "Itens", count: items.length }] : []),
          { key: "eventos", label: "Eventos fiscais", count: events.length },
          { key: "historico", label: "Histórico" },
        ]}
      />
      {tab === "resumo" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Identificação">
            <DefinitionList
              items={[
                { label: "Modelo", value: MODEL_LABEL[model] },
                model === "nfse" ? { label: "RPS (número/série)", value: doc.rpsNumber ? `${doc.rpsNumber} / ${doc.rpsSeries ?? "—"}` : "Atribuído na transmissão" } : { label: "Série / número", value: doc.number ? `${doc.series} / ${doc.number}` : `Série ${doc.series ?? "—"} — número atribuído na transmissão` },
                model === "nfse" ? { label: "Número da NFS-e", value: doc.number ?? "Após autorização" } : { label: "Chave de acesso", value: <span className="font-mono text-xs">{formatKey(doc.accessKey)}</span> },
                { label: "Protocolo", value: doc.protocol ?? "—" },
                model === "nfse" && { label: "Código de verificação", value: doc.verificationCode ?? "—" },
                model === "nfse" && { label: "Padrão", value: svc.standard === "nacional" ? "NFS-e nacional (DPS)" : "Municipal (via provedor)" },
                { label: "Natureza da operação", value: doc.nature },
                model !== "nfse" && { label: "Operação / finalidade", value: `${OP_LABEL[doc.operationType] ?? doc.operationType} · ${PURPOSE_LABEL[doc.purpose] ?? doc.purpose}` },
                model !== "nfse" && { label: "Presença do comprador", value: PRESENCE_LABEL[doc.presence ?? "1"] ?? doc.presence },
                { label: "Ambiente / provedor", value: `${ENV_LABEL[doc.environment] ?? doc.environment ?? "—"} · ${doc.provider === "focusnfe" ? "Focus NFe" : doc.provider === "simulated" ? "Simulação" : (doc.provider ?? "—")}` },
                { label: "Referência no provedor", value: <span className="font-mono text-xs">{doc.ref}</span> },
                { label: "Filial emitente", value: branch ? `${branch.name} — ${formatDoc(branch.cnpj)}` : "—" },
              ]}
            />
          </Card>
          <Card title="Origem e destinatário">
            <DefinitionList
              items={[
                { label: "Origem", value: oHref ? <Link className="text-brand-700 hover:underline" href={oHref}>{ORIGIN_LABEL[doc.originType] ?? doc.originType}{sale ? ` nº ${sale.number}` : ""}</Link> : (ORIGIN_LABEL[doc.originType] ?? doc.originType ?? "—") },
                { label: model === "nfse" ? "Tomador" : "Destinatário", value: pHref ? <Link className="text-brand-700 hover:underline" href={pHref}>{doc.recipientName}</Link> : (doc.recipientName ?? (model === "nfce" ? "Consumidor não identificado" : "—")) },
                { label: "CPF/CNPJ", value: doc.recipientDoc ? formatDoc(doc.recipientDoc) : "—" },
                doc.recipient?.ie && { label: "Inscrição estadual", value: doc.recipient.ie },
                doc.recipient?.im && { label: "Inscrição municipal", value: doc.recipient.im },
                { label: "E-mail", value: doc.recipient?.email ?? "—" },
                doc.recipient?.address?.street && { label: "Endereço", value: `${doc.recipient.address.street}, ${doc.recipient.address.number ?? "s/n"} — ${doc.recipient.address.district ?? ""}, ${doc.recipient.address.cityName ?? ""}/${doc.recipient.address.uf ?? ""} (IBGE ${doc.recipient.address.cityCode ?? "—"})` },
                model === "nfce" && { label: "Terminal / operador", value: `${terminal ? `${terminal.code} — ${terminal.name}` : "—"} · ${operator?.name ?? "—"}` },
                (doc.service?.referencedKeys ?? []).length > 0 && { label: "Documentos referenciados", value: <span className="font-mono text-xs">{(doc.service.referencedKeys as string[]).map(formatKey).join("; ")}</span> },
              ]}
            />
          </Card>
          {model === "nfse" ? (
            <>
              <Card title="Serviço">
                <DefinitionList
                  items={[
                    { label: "Competência", value: formatDate(svc.competence) },
                    { label: "Item da lista (LC 116)", value: svc.serviceListItem },
                    { label: "Código de tributação municipal", value: svc.municipalCode ?? "—" },
                    svc.nationalCode && { label: "Código de tributação nacional", value: svc.nationalCode },
                    { label: "Município da prestação (IBGE)", value: svc.serviceCityCode ?? branch?.cityCode ?? "—" },
                    { label: "Exigibilidade do ISS", value: ({ "1": "1 — Exigível", "2": "2 — Não incidência", "3": "3 — Isenção", "4": "4 — Exportação", "5": "5 — Imunidade", "6": "6 — Suspensa (judicial)", "7": "7 — Suspensa (administrativo)" } as Record<string, string>)[svc.issExigibility] ?? svc.issExigibility },
                    { label: "Discriminação", value: <span className="whitespace-pre-wrap">{svc.description}</span> },
                    svc.productId && { label: "Serviço cadastrado", value: <Link className="text-brand-700 hover:underline" href={`/produtos/${svc.productId}`}>abrir cadastro</Link> },
                  ]}
                />
              </Card>
              <Card title="Valores e retenções (calcNfse)">
                <table className="w-full text-sm">
                  <tbody className="[&_td]:py-1">
                    <tr><td>Valor dos serviços</td><td className="tabular text-right">{formatMoney(svc.amount)}</td></tr>
                    <tr><td>(−) Desconto incondicionado</td><td className="tabular text-right">{formatMoney(svc.unconditionalDiscount)}</td></tr>
                    <tr><td>(−) Deduções</td><td className="tabular text-right">{formatMoney(svc.deductions)}</td></tr>
                    <tr className="font-medium"><td>Base de cálculo do ISS</td><td className="tabular text-right">{formatMoney(svc.base)}</td></tr>
                    <tr><td>ISS calculado ({formatBps(svc.issRateBps)})</td><td className="tabular text-right">{formatMoney(svc.iss)}</td></tr>
                    <tr><td>ISS retido pelo tomador</td><td className="tabular text-right">{svc.issWithheld ? formatMoney(svc.issWithheldValue) : "Não retido"}</td></tr>
                    {(["pis", "cofins", "inss", "ir", "csll"] as const).map((k) => (
                      <tr key={k}>
                        <td>{k.toUpperCase()} {svc.rates?.[`${k}Bps`] ? `(${formatBps(svc.rates[`${k}Bps`])})` : ""}</td>
                        <td className="tabular text-right">{svc[k] ? `${formatMoney(svc[k])} ${svc.withhold?.[k] ? "retido" : "não retido"}` : "—"}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line font-semibold"><td>Valor líquido</td><td className="tabular text-right">{formatMoney(svc.net)}</td></tr>
                  </tbody>
                </table>
              </Card>
            </>
          ) : (
            <Card title="Valores">
              <table className="w-full text-sm">
                <tbody className="[&_td]:py-1">
                  <tr><td>Produtos</td><td className="tabular text-right">{formatMoney(t.products)}</td></tr>
                  <tr><td>(−) Descontos</td><td className="tabular text-right">{formatMoney(t.discount)}</td></tr>
                  <tr><td>(+) Frete</td><td className="tabular text-right">{formatMoney(t.freight)}</td></tr>
                  <tr><td>(+) Seguro</td><td className="tabular text-right">{formatMoney(t.insurance ?? 0)}</td></tr>
                  <tr><td>(+) Outras despesas</td><td className="tabular text-right">{formatMoney(t.other)}</td></tr>
                  <tr className="border-t border-line font-semibold"><td>Total da nota</td><td className="tabular text-right">{formatMoney(t.total)}</td></tr>
                  <tr className="text-slate-500"><td>Base ICMS / ICMS</td><td className="tabular text-right">{formatMoney(t.icmsBase)} / {formatMoney(t.icms)}</td></tr>
                  <tr className="text-slate-500"><td>PIS / COFINS</td><td className="tabular text-right">{formatMoney(t.pis)} / {formatMoney(t.cofins)}</td></tr>
                  <tr className="text-slate-500"><td>Tributos aproximados (Lei 12.741/2012)</td><td className="tabular text-right">{formatMoney(t.approxTax ?? 0)}</td></tr>
                </tbody>
              </table>
            </Card>
          )}
          {model !== "nfse" && (
            <Card title={model === "nfce" ? "Pagamentos da venda" : "Pagamento e transporte"}>
              {sale && salePayments.length > 0 ? (
                <table className="table-base w-full text-sm">
                  <thead><tr><th>Forma</th><th>Situação</th><th className="text-right">Valor</th><th>Título</th></tr></thead>
                  <tbody>
                    {salePayments.map((p) => (
                      <tr key={p.id}>
                        <td>{p.methodName ?? TPAG_LABEL[p.methodKind] ?? p.methodKind}<span className="block text-xs text-slate-500">{[p.nsu ? `NSU ${p.nsu}` : "", p.authCode ? `Aut. ${p.authCode}` : "", p.providerRef ? `Transação ${p.providerRef}` : "", p.cardBrand ?? ""].filter(Boolean).join(" · ") || "—"}</span></td>
                        <td><StatusBadge kind="payment" status={p.status} /></td>
                        <td className="tabular text-right">{formatMoney(p.amount)}</td>
                        <td>{p.titleId ? <Link className="text-brand-700 hover:underline" href={`/financeiro/receber/${p.titleId}`}>abrir</Link> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <DefinitionList
                  items={[
                    { label: "Formas de pagamento", value: (doc.payments ?? []).map((p: any) => `${TPAG_LABEL[p.kind] ?? p.kind}${p.kind === "none" ? "" : ` ${formatMoney(p.amount)}`}`).join(" · ") || "—" },
                    model === "nfe" && { label: "Modalidade do frete", value: FREIGHT_MODE_LABEL[String(doc.transport?.mode ?? "9")] },
                    doc.transport?.carrierName && { label: "Transportador", value: `${doc.transport.carrierName}${doc.transport.carrierDoc ? ` — ${formatDoc(doc.transport.carrierDoc)}` : ""}` },
                    doc.transport?.volumes && { label: "Volumes", value: `${doc.transport.volumes} ${doc.transport.species ?? ""} · bruto ${doc.transport.grossWeightKg ?? "—"} kg · líquido ${doc.transport.netWeightKg ?? "—"} kg` },
                    doc.service?.additionalInfo && { label: "Informações complementares", value: doc.service.additionalInfo },
                  ]}
                />
              )}
            </Card>
          )}
          {model === "nfce" && (
            <Card title="Consulta e QR Code">
              {qrSvg ? (
                <div className="flex flex-wrap items-start gap-4">
                  <div className="relative size-[150px]" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="text-xs text-slate-500">URL do QR Code</p>
                    <p className="break-all font-mono text-xs">{doc.qrCodeUrl}</p>
                    {doc.isSimulated && <p className="mt-2 text-xs text-fuchsia-800">Endereço fictício (.invalid) — simulação, não consultável na SEFAZ.</p>}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">QR Code disponível após a autorização.</p>
              )}
            </Card>
          )}
          <Card title="Efeitos e cobrança">
            <DefinitionList
              items={[
                { label: "Estoque", value: doc.effects?.stock ? (doc.effects.appliedAt ? `${doc.effects.movements ?? 0} movimento(s) aplicados em ${formatDateTime(doc.effects.appliedAt)}${doc.effects.reversedAt ? ` · revertidos em ${formatDateTime(doc.effects.reversedAt)}` : ""}` : "Será movimentado na autorização") : doc.originType === "sale" ? "Movimentado pela venda" : doc.originType === "transfer" ? "Movimentado pela transferência" : doc.originType === "return" ? "Movimentado pela devolução" : "Sem efeito (somente documento)" },
                { label: "Financeiro", value: title ? <Link className="text-brand-700 hover:underline" href={`/financeiro/${title.kind === "payable" ? "pagar" : "receber"}/${title.id}`}>Título nº {title.number} — {formatMoney(title.total)} ({title.status})</Link> : doc.effects?.financial ? "Título gerado na autorização" : sale ? "Recebimentos registrados na venda" : "Sem título vinculado" },
                doc.effects?.note && { label: "Observação", value: doc.effects.note },
              ]}
            />
          </Card>
          {cce.length > 0 && (
            <Card title="Cartas de correção registradas" className="lg:col-span-2">
              <ul className="space-y-2 text-sm">
                {cce.map((e) => (
                  <li key={e.id} className="rounded border border-line p-2">
                    <p className="text-xs text-slate-500">
                      {formatDateTime(e.occurredAt)} · protocolo {e.protocol ?? "—"} · sequência {e.request?.sequencia ?? "—"}
                    </p>
                    <p>{e.request?.correcao}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
      {tab === "itens" && model !== "nfse" && (
        <Card bodyClass="p-0">
          {items.length === 0 ? (
            <EmptyState title="Sem itens" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>#</th><th>Código</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th>CST/CSOSN</th><th className="text-right">Qtd</th><th className="text-right">Unitário</th><th className="text-right">Desconto</th><th className="text-right">Total</th><th className="text-right">ICMS</th><th>Grupo tributário</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.seq}>
                      <td>{i.seq}</td>
                      <td className="font-mono text-xs">{i.productId ? <Link className="text-brand-700 hover:underline" href={`/produtos/${i.productId}`}>{i.code}</Link> : i.code}</td>
                      <td>{i.description}</td>
                      <td className={/^\d{8}$/.test(i.ncm) ? "font-mono text-xs" : "font-mono text-xs text-red-700"}>{i.ncm || "ausente"}</td>
                      <td className="font-mono text-xs">{i.cfop || "—"}{i.overrides?.cfop ? " *" : ""}</td>
                      <td className="font-mono text-xs">{i.cstCsosn || "—"}</td>
                      <td className="tabular text-right">{formatQty(i.qty, i.unit)}</td>
                      <td className="tabular text-right">{formatMoney(i.unitPrice)}</td>
                      <td className="tabular text-right">{i.discount ? formatMoney(i.discount) : "—"}</td>
                      <td className="tabular text-right">{formatMoney(i.total)}</td>
                      <td className="tabular text-right">{i.icms ? formatMoney(i.icms) : "—"}</td>
                      <td className="text-xs">{i.taxGroupName ?? "—"}{i.taxGroupIssue ? <span className="block text-red-700">{i.taxGroupIssue}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-2 text-xs text-slate-500">* CFOP definido manualmente. Valores rateados de frete/seguro/outras despesas estão incluídos no total do item.</p>
            </div>
          )}
        </Card>
      )}
      {tab === "eventos" && (
        <Card bodyClass="p-0">
          {events.length === 0 ? (
            <EmptyState title="Sem eventos" />
          ) : (
            <ul className="divide-y divide-line">
              {events.map((e) => (
                <li key={e.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
                    <StatusBadge kind="fiscal" status={e.status} />
                    <span className="text-xs text-slate-500">{formatDateTime(e.occurredAt)}</span>
                    {e.protocol && <span className="text-xs text-slate-500">· protocolo {e.protocol}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">{e.message}</p>
                  {(e.request || e.response) && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-brand-700">Dados técnicos (saneados)</summary>
                      <pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify({ envio: e.request ?? undefined, retorno: e.response ?? undefined }, null, 2)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {tab === "historico" && (
        <Card title="Linha do tempo">
          <Timeline store={s.ctx.store} refs={[`fiscal_document:${doc.id}`, ...(doc.originId ? [`${doc.originType}:${doc.originId}`] : [])]} />
        </Card>
      )}
    </>
  );
}
