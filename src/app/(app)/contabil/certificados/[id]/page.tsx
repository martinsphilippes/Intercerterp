import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ExternalLink, ListChecks, Paperclip, ShieldCheck } from "lucide-react";
import { requireFirmSession } from "../../guard";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Timeline } from "@/components/ui/timeline";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { CertificateDownloadButton } from "@/components/certificates/download-button";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { BusinessError } from "@/lib/core/errors";
import type { Doc } from "@/lib/db/types";
import { CERT_KIND_LABEL, CERT_STATUS, CHARGE_CHANNEL_LABEL, VALIDATION_MODE_LABEL, certificationSettings, chargeMessage, getCertificateRequest, requestDisplayStatus, requestNextAction, validityOf } from "@/domain/accounting";
import { portfolioRefs } from "../../queries";
import { ChargeForm } from "./charge-form";
import { CancelForm } from "./cancel-form";
import { AuthorizationForm } from "./authorization-form";
import { RequestAuthorizationButton, RequestEmissionButton } from "./actions-bar";

export const metadata = { title: "Solicitação de certificado" };

const OWNER_LABEL: Record<string, string> = { firm: "Contador responsável", team: "Equipe de certificação Intercert", company: "Titular (empresa no ERP)", none: "Nenhuma ação pendente" };
const n = (count: number, one: string, many: string) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;
const docLabel = (doc: string | null | undefined) => (doc && String(doc).replace(/\D/g, "").length === 11 ? "CPF" : "CNPJ");

type StepState = "done" | "active" | "todo";

/** Régua das 4 etapas do protocolo (CERT_STATUS[].step): concluídas, atual e futuras. */
function Stepper({ steps }: { steps: Array<{ label: string; hint: string; state: StepState; tone?: "warn" | "bad" }> }) {
  return (
    <ol aria-label="Etapas do atendimento" className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((s, i) => (
        <li key={i} aria-current={s.state === "active" ? "step" : undefined} className={cn("flex items-center gap-3 rounded-lg border bg-white p-3", s.state === "active" ? (s.tone === "bad" ? "border-red-500 ring-1 ring-red-500" : s.tone === "warn" ? "border-amber-500 ring-1 ring-amber-500" : "border-accent-500 ring-1 ring-accent-500") : "border-line")}>
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", s.state === "done" ? "bg-emerald-600 text-white" : s.state === "active" ? (s.tone === "bad" ? "bg-red-600 text-white" : s.tone === "warn" ? "bg-amber-500 text-white" : "bg-accent-500 text-white") : "bg-slate-100 text-slate-500")}>
            {s.state === "done" ? <Check className="size-4" aria-hidden /> : i + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">{s.label}</span>
            <span className="block text-xs text-slate-500">{s.hint}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function stepsOf(r: Doc, display: string): Array<{ label: string; hint: string; state: StepState; tone?: "warn" | "bad" }> {
  const step = CERT_STATUS.find((s) => s.value === r.status)?.step ?? 0;
  const sends = Number(r.chargeSends ?? 0);
  const downloads = Number(r.downloads ?? 0);
  const state = (i: number): StepState => (r.status === "downloaded" ? "done" : step === 0 ? "todo" : i < step ? "done" : i === step ? "active" : "todo");
  const charge = r.paymentConfirmedAt
    ? `Pagamento confirmado em ${formatDate(r.paymentConfirmedAt)}`
    : display === "overdue"
      ? `Cobrança vencida em ${formatDate(r.dueDate)}`
      : sends > 0
        ? `Pagamento pendente · ${n(sends, "envio", "envios")}`
        : "Cobrança ainda não enviada";
  const validation =
    r.validationStatus === "approved" ? `Titular validado${r.validatedAt ? ` em ${formatDate(r.validatedAt)}` : ""}` : r.validationStatus === "scheduled" ? `Agendada para ${formatDateTime(r.validationAt)}` : r.validationStatus === "rejected" ? "Pendência: reagendamento" : r.status === "validation" ? "Aguardando agendamento" : "Pendente";
  const emission = r.issuedAt ? `Certificado emitido em ${formatDate(r.issuedAt)}` : r.status === "issue_failed" ? `Falha na emissão (tentativa ${r.emissionAttempts ?? 1})` : r.status === "issuing" ? `Retorno da certificadora (tentativa ${r.emissionAttempts ?? 1})` : r.status === "ready_to_issue" ? "Pronta para pedir a emissão" : "Pendente";
  const download = downloads > 0 ? `${n(downloads, "download", "downloads")} · último em ${formatDateTime(r.lastDownloadAt)}` : r.status === "ready_to_download" ? "Entrega liberada ao escritório" : r.status === "awaiting_authorization" ? "Autorização do titular pendente" : r.downloadAuthorized ? "Autorização do titular registrada" : "Pendente";
  return [
    { label: "1. Cobrança", hint: charge, state: state(1), tone: display === "overdue" ? "bad" : undefined },
    { label: "2. Validação", hint: validation, state: state(2), tone: r.validationStatus === "rejected" ? "warn" : undefined },
    { label: "3. Emissão", hint: emission, state: state(3), tone: r.status === "issue_failed" ? "bad" : undefined },
    { label: "4. Download", hint: download, state: state(4), tone: r.status === "awaiting_authorization" ? "warn" : undefined },
  ];
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireFirmSession();
  const { id } = await params;
  const crumbs = [{ label: "Carteira", href: "/contabil" }, { label: "Certificados digitais", href: "/contabil/certificados" }];
  let r: Doc;
  try {
    r = await getCertificateRequest(s.ctx, id);
  } catch (e) {
    if (e instanceof BusinessError && e.code === "not_found") notFound();
    if (e instanceof BusinessError && e.code === "forbidden") {
      const team = canDo(s.user, "certification.operate");
      return (
        <>
          <PageHeader title="Solicitação fora da sua carteira" crumbs={[...crumbs, { label: "Protocolo" }]} />
          <Notice tone="warn" title="Esta solicitação não está na sua carteira">
            Você só acompanha os certificados dos clientes em que é responsável geral, titular ou substituto numa atribuição, ou cujo departamento você gerencia. Para ver toda a carteira é preciso a permissão “Ver toda a carteira de clientes”.{" "}
            <Link href="/contabil/certificados" className="underline">
              Voltar aos certificados digitais
            </Link>
            .
            {team && (
              <span className="mt-2 block">
                Como integrante da equipe de certificação, atenda este protocolo pela{" "}
                <Link href={`/administracao/certificacao/${id}`} className="underline">
                  fila da certificação
                </Link>
                .
              </span>
            )}
          </Notice>
        </>
      );
    }
    throw e;
  }

  const [settings, refs, client, previous] = await Promise.all([
    certificationSettings(s.ctx.store),
    portfolioRefs(s.ctx),
    s.ctx.store.get("accounting_clients", r.clientId),
    r.previousCertificateId ? s.ctx.store.get("accounting_certificates", r.previousCertificateId) : Promise.resolve(null),
  ]);
  const display = requestDisplayStatus(r);
  const next = requestNextAction(r);
  const charge = chargeMessage(r, settings);
  const canOperate = canDo(s.user, "accounting.certificates") && can(s.user, "accounting", "edit");
  const isTeam = canDo(s.user, "certification.operate");
  const sends = Number(r.chargeSends ?? 0);
  const downloads = Number(r.downloads ?? 0);
  const responsibleName = r.responsibleUserId ? (refs.userName.get(r.responsibleUserId) ?? null) : null;
  const userName = (uid: string | null | undefined) => (uid ? (refs.userName.get(uid) ?? "—") : "—");
  const clientHref = `/contabil/clientes/${r.clientId}`;
  const prevValidity = previous ? validityOf(previous.validTo) : null;
  const isPaymentStage = display === "awaiting_payment" || display === "overdue";
  const issued = Boolean(r.issuedAt);

  return (
    <>
      <PageHeader
        title={`${r.protocol} · ${r.holderName}`}
        crumbs={[...crumbs, { label: r.protocol }]}
        badges={
          <>
            <StatusBadge kind="certificate_request" status={display} />
            <Badge tone="brand">{CERT_KIND_LABEL[r.kind] ?? r.kind}</Badge>
            <Badge>{r.productLabel}</Badge>
          </>
        }
        description={
          <>
            Protocolo da solicitação de certificado digital de{" "}
            <Link href={clientHref} className="text-brand-700 hover:underline">
              {client?.name ?? r.holderName}
            </Link>
            {r.holderDoc ? ` (${docLabel(r.holderDoc)} ${formatDoc(r.holderDoc)})` : ""}. Cada etapa é uma ação real de quem responde por ela, com autor e momento no histórico.
          </>
        }
        actions={
          <>
            {isTeam && (
              <LinkButton href={`/administracao/certificacao/${r.id}`} variant="outline" title="Confirmar pagamento, validar o titular e registrar a emissão">
                <ListChecks className="size-4" aria-hidden /> Abrir na fila da certificação
              </LinkButton>
            )}
            <LinkButton href={clientHref} variant="secondary">
              <ExternalLink className="size-4" aria-hidden /> Cliente
            </LinkButton>
            <LinkButton href="/contabil/certificados" variant="ghost">
              <ArrowLeft className="size-4" aria-hidden /> Voltar
            </LinkButton>
          </>
        }
      />

      {r.status === "cancelled" ? (
        <div className="mb-5">
          <Notice tone="info" title={`Solicitação cancelada em ${formatDateTime(r.cancelledAt)} por ${userName(r.cancelledBy)}`}>
            {r.cancelReason ? `Motivo: ${r.cancelReason}. ` : ""}As etapas de pagamento, emissão e download ficaram bloqueadas neste protocolo.
          </Notice>
        </div>
      ) : (
        <Stepper steps={stepsOf(r, display)} />
      )}

      {!canOperate && r.status !== "cancelled" && (
        <div className="mb-5">
          <Notice tone="info" title="Somente consulta: as ações desta solicitação são do responsável">
            Enviar a cobrança, pedir a emissão, registrar a autorização e baixar o certificado exigem a permissão “Solicitar, cobrar e baixar certificados digitais dos clientes”.{responsibleName ? ` Responsável por este protocolo: ${responsibleName}.` : ""}
          </Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card
            title="Próxima ação"
            description={`Responsável: ${OWNER_LABEL[next.owner] ?? next.owner}${next.owner === "firm" && responsibleName ? ` (${responsibleName})` : ""}`}
            actions={<Badge tone={next.owner === "firm" ? "accent" : next.owner === "team" ? "info" : next.owner === "company" ? "warn" : "good"}>{OWNER_LABEL[next.owner] ?? next.owner}</Badge>}
          >
            <p className="text-base font-semibold text-ink">{next.label}</p>

            {isPaymentStage && (
              <div className="mt-4 space-y-4">
                <DefinitionList
                  cols={2}
                  items={[
                    { label: "Valor da cobrança", value: <span className="tabular font-semibold">{formatMoney(r.amount)}</span> },
                    { label: "Vencimento", value: <span className={display === "overdue" ? "font-medium text-red-700" : undefined}>{formatDate(r.dueDate)}{display === "overdue" ? " — vencida" : ""}</span> },
                    {
                      label: "Pagamento",
                      value: charge.link ? (
                        <a href={charge.link} target="_blank" rel="noreferrer" className="break-all text-brand-700 hover:underline">
                          Gateway Intercert: {charge.link}
                        </a>
                      ) : (
                        "Instruções de pagamento na mensagem (confirmação pela equipe de certificação com a referência da transação)"
                      ),
                    },
                    {
                      label: "Envio da cobrança",
                      value: sends > 0 ? (
                        <span>
                          Cobrança preparada para <span className="font-medium">{r.chargeTo}</span> · {n(sends, "envio", "envios")} no histórico
                          <span className="block text-xs text-slate-500">Último envio: {CHARGE_CHANNEL_LABEL[r.chargeChannel] ?? r.chargeChannel} em {formatDateTime(r.chargeSentAt)}</span>
                        </span>
                      ) : (
                        <span className="text-amber-700">Cobrança ainda não enviada</span>
                      ),
                    },
                  ]}
                />
                {display === "overdue" && <Notice tone="warn">A cobrança venceu. Atualize o vencimento antes de reenviar ao cliente.</Notice>}
                {sends > 0 && display !== "overdue" && <p className="text-sm text-slate-600">A equipe de certificação confirma o pagamento com a referência da transação; você é avisado neste protocolo. Se o cliente pediu, reenvie a mesma cobrança abaixo.</p>}
                {canOperate && (
                  <>
                    <div className="border-t border-line pt-4">
                      <h3 className="mb-3 text-sm font-semibold text-ink">{sends > 0 ? "Reenviar cobrança" : "Enviar cobrança"}</h3>
                      <ChargeForm id={r.id} overdue={display === "overdue"} dueDate={r.dueDate} contactEmail={r.contactEmail ?? null} contactPhone={r.contactPhone ?? null} chargeSends={sends} chargeChannel={r.chargeChannel ?? null} chargeTo={r.chargeTo ?? null} preview={charge} />
                    </div>
                    <div className="flex justify-end border-t border-line pt-3">
                      <CancelForm id={r.id} protocol={r.protocol} holderName={r.holderName} />
                    </div>
                  </>
                )}
              </div>
            )}

            {r.status === "validation" && (
              <div className="mt-4 space-y-4">
                <DefinitionList
                  cols={2}
                  items={[
                    { label: "Pagamento confirmado", value: <span><span className="tabular">{formatMoney(r.amount)}</span>{r.paymentRef ? ` · referência ${r.paymentRef}` : ""}<span className="block text-xs text-slate-500">em {formatDateTime(r.paymentConfirmedAt)}</span></span> },
                    {
                      label: "Agendamento da validação",
                      value: r.validationStatus === "scheduled" ? (
                        <span>
                          {formatDateTime(r.validationAt)} · {VALIDATION_MODE_LABEL[r.validationMode] ?? r.validationMode}
                          {r.validationNotes && <span className="block text-xs text-slate-500">{r.validationNotes}</span>}
                        </span>
                      ) : r.validationStatus === "rejected" ? (
                        <span className="text-amber-700">Reagendamento pendente</span>
                      ) : (
                        "Aguardando agendamento pela equipe de certificação"
                      ),
                    },
                  ]}
                />
                {r.validationStatus === "rejected" && (
                  <Notice tone="warn" title="Validação não concluída">
                    {r.validationNotes ? `${r.validationNotes}. ` : ""}A equipe de certificação reagendará a validação; oriente o titular.
                  </Notice>
                )}
                <p className="text-sm text-slate-600">A equipe de certificação confere o titular e os documentos antes de liberar a emissão (validação ICP-Brasil). {r.validationStatus === "scheduled" ? "Avise o titular da data e do formato combinados." : ""}</p>
              </div>
            )}

            {r.status === "ready_to_issue" && (
              <div className="mt-4 space-y-4">
                <DefinitionList
                  cols={2}
                  items={[
                    { label: "Titular", value: <span>{r.holderName}{r.holderDoc && <span className="tabular block text-xs text-slate-500">{docLabel(r.holderDoc)} {formatDoc(r.holderDoc)}</span>}</span> },
                    { label: "Produto", value: r.productLabel },
                    { label: "Situação", value: <span className="text-emerald-700">Pagamento confirmado e titular validado{r.validatedAt ? ` em ${formatDate(r.validatedAt)}` : ""}</span> },
                    { label: "Protocolo", value: <span className="font-mono">{r.protocol}</span> },
                  ]}
                />
                {canOperate ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <RequestEmissionButton id={r.id} holderName={r.holderName} retry={false} />
                    <p className="text-sm text-slate-600">Acompanhe a confirmação da certificadora neste mesmo protocolo.</p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">O responsável pede a emissão por este protocolo; a confirmação da certificadora chega aqui.</p>
                )}
              </div>
            )}

            {r.status === "issuing" && (
              <div className="mt-4 space-y-2 text-sm text-slate-600">
                <p>
                  Emissão em andamento (tentativa {r.emissionAttempts ?? 1}), pedida em {formatDateTime(r.emissionRequestedAt)}. Aguardando o retorno da certificadora: a equipe de certificação registra o arquivo emitido ou a falha neste protocolo e você é avisado.
                </p>
              </div>
            )}

            {r.status === "issue_failed" && (
              <div className="mt-4 space-y-4">
                <Notice tone="bad" title="Não foi possível concluir a emissão">
                  {r.emissionFailure ? `${r.emissionFailure}. ` : ""}Retorno registrado pela equipe de certificação em {formatDateTime(r.emissionFailedAt)} (tentativa {r.emissionAttempts ?? 1}). O pagamento continua confirmado.
                </Notice>
                {canOperate ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <RequestEmissionButton id={r.id} holderName={r.holderName} retry />
                    <p className="text-sm text-slate-600">A nova tentativa usa o mesmo protocolo, sem gerar outra cobrança.</p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-600">O responsável pode pedir uma nova tentativa neste mesmo protocolo, sem gerar outra cobrança.</p>
                )}
              </div>
            )}

            {r.status === "awaiting_authorization" && (
              <div className="mt-4 space-y-4">
                <DefinitionList
                  cols={3}
                  items={[
                    { label: "Certificado emitido", value: r.productLabel },
                    { label: "Validade", value: <span>{formatDate(r.validFrom)} a {formatDate(r.validTo)}</span> },
                    { label: "Série", value: r.serial ? <span className="font-mono">{r.serial}</span> : "—" },
                  ]}
                />
                <Notice tone="warn">O titular ainda não autorizou o download pelo escritório. A entrega permanece disponível ao próprio titular.</Notice>
                {canOperate ? (
                  r.linkedCompanyId ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <RequestAuthorizationButton id={r.id} holderName={r.holderName} />
                      <p className="text-sm text-slate-600">O administrador da empresa autoriza no ERP, em Administração → Integrações → Contabilidade → Certificados digitais.</p>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <AuthorizationForm id={r.id} holderName={r.holderName} />
                      <p className="text-sm text-slate-600">Cliente sem ERP: o escritório registra como o titular autorizou, com evidência opcional.</p>
                    </div>
                  )
                ) : (
                  <p className="text-sm text-slate-600">{r.linkedCompanyId ? "O administrador da empresa autoriza o download no ERP; o responsável pode preparar o pedido de autorização." : "O responsável registra a autorização dada pelo titular (cliente sem ERP)."}</p>
                )}
              </div>
            )}

            {(r.status === "ready_to_download" || r.status === "downloaded") && (
              <div className="mt-4 space-y-4">
                <DefinitionList
                  cols={2}
                  items={[
                    { label: "Arquivo", value: <span className="break-all font-mono text-xs">{r.fileName}</span> },
                    { label: "Validade do certificado", value: <span>{formatDate(r.validFrom)} a {formatDate(r.validTo)}{r.serial ? <span className="block font-mono text-xs text-slate-500">série {r.serial}</span> : null}</span> },
                    {
                      label: "Autorização do titular",
                      value:
                        r.downloadAuthorizedBy === "company" ? (
                          <span className="text-emerald-700">Registrada pelo administrador da empresa no ERP em {formatDateTime(r.downloadAuthorizedAt)}</span>
                        ) : (
                          <span>
                            <span className="text-emerald-700">Registrada pelo escritório em {formatDateTime(r.downloadAuthorizedAt)}</span>
                            {r.downloadAuthNotes && <span className="block text-xs text-slate-600">{r.downloadAuthNotes}</span>}
                            {r.downloadAuthEvidenceFileId && (
                              <a href={`/api/files/${r.downloadAuthEvidenceFileId}`} className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                                <Paperclip className="size-3.5" aria-hidden /> Ver evidência anexada
                              </a>
                            )}
                          </span>
                        ),
                    },
                    { label: "Identidade do usuário", value: <span className="inline-flex items-center gap-1"><ShieldCheck className="size-4 text-brand-700" aria-hidden /> Confirmação da senha exigida no acesso</span> },
                  ]}
                />
                <p className="text-sm text-slate-600">A senha do certificado não aparece no portal nem nas mensagens. Cada download fica no histórico com data, hora e usuário.</p>
                <div className="flex flex-wrap items-center gap-3">
                  {canOperate && <CertificateDownloadButton requestId={r.id} fileName={r.fileName} />}
                  {downloads > 0 ? (
                    <p className="text-sm text-slate-600">
                      {n(downloads, "download", "downloads")} · último em {formatDateTime(r.lastDownloadAt)} por {userName(r.lastDownloadBy)}
                    </p>
                  ) : (
                    <p className="text-sm text-slate-600">Nenhum download registrado ainda.</p>
                  )}
                </div>
              </div>
            )}

            {r.status === "cancelled" && (
              <div className="mt-4 space-y-3">
                <DefinitionList
                  cols={2}
                  items={[
                    { label: "Motivo", value: r.cancelReason },
                    { label: "Cancelada por", value: <span>{userName(r.cancelledBy)}<span className="block text-xs text-slate-500">{formatDateTime(r.cancelledAt)}</span></span> },
                  ]}
                />
                <p className="text-sm text-slate-600">
                  Para retomar o atendimento, crie uma nova solicitação{canOperate ? " para este cliente" : ""}:{" "}
                  {canOperate ? (
                    <Link href={`/contabil/certificados/nova?cliente=${encodeURIComponent(r.clientId)}`} className="text-brand-700 hover:underline">
                      Nova solicitação
                    </Link>
                  ) : (
                    <Link href={`/contabil/certificados?cliente=${encodeURIComponent(r.clientId)}`} className="text-brand-700 hover:underline">
                      Certificados digitais
                    </Link>
                  )}
                  .
                </p>
              </div>
            )}
          </Card>

          <Card title="Histórico do atendimento" description="Cobrança, pagamento, validação, emissão, autorização, downloads e cancelamento — com quem fez e quando.">
            <Timeline store={s.ctx.store} refs={[`certificate_request:${r.id}`]} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Dados da solicitação">
            <DefinitionList
              cols={1}
              items={[
                {
                  label: "Cliente",
                  value: (
                    <Link href={clientHref} className="text-brand-700 hover:underline">
                      {client ? (client.code ? `${client.code} — ${client.name}` : client.name) : r.holderName}
                    </Link>
                  ),
                },
                { label: "Titular", value: <span>{r.holderName}{r.holderDoc && <span className="tabular block text-xs text-slate-500">{docLabel(r.holderDoc)} {formatDoc(r.holderDoc)}</span>}</span> },
                { label: "Produto", value: <span>{r.productLabel}{r.months ? <span className="block text-xs text-slate-500">Validade de {n(Number(r.months), "mês", "meses")}</span> : null}</span> },
                { label: "Tipo", value: CERT_KIND_LABEL[r.kind] ?? r.kind },
                { label: "Valor", value: <span className="tabular">{formatMoney(r.amount)}</span> },
                { label: "Vencimento da cobrança", value: formatDate(r.dueDate) },
                {
                  label: "Contato",
                  value:
                    r.contactEmail || r.contactPhone ? (
                      <span>
                        {r.contactEmail && <a href={`mailto:${r.contactEmail}`} className="block text-brand-700 hover:underline">{r.contactEmail}</a>}
                        {r.contactPhone ? <span className={r.contactEmail ? "block text-xs text-slate-500" : "block"}>{formatPhone(r.contactPhone) || r.contactPhone}</span> : <span className="block text-xs text-slate-500">Sem telefone informado</span>}
                      </span>
                    ) : (
                      <span className="text-amber-700">Sem contato informado</span>
                    ),
                },
                { label: "Responsável", value: responsibleName ?? <span className="text-amber-700">Não definido</span> },
                { label: "Criada em", value: <span>{formatDateTime(r.createdAt)}<span className="block text-xs text-slate-500">por {userName(r.createdBy)}</span></span> },
                r.kind === "renewal" && {
                  label: "Certificado anterior",
                  value: previous ? (
                    <span>
                      {previous.productLabel ?? "Certificado digital"}
                      <span className="block text-xs text-slate-500">
                        {previous.validTo ? `Válido até ${formatDate(previous.validTo)}` : "Validade não informada"}
                        {previous.serial ? ` · série ${previous.serial}` : ""}
                      </span>
                      {prevValidity && !issued && <StatusBadge kind="certificate_validity" status={prevValidity.validity} className="mt-1" />}
                      {issued && <span className="block text-xs text-slate-500">Substituído pelo certificado emitido neste protocolo.</span>}
                    </span>
                  ) : (
                    <span className="text-slate-500">Não informado</span>
                  ),
                },
                { label: "Observações", value: r.notes ? <span className="whitespace-pre-wrap">{r.notes}</span> : <span className="text-slate-500">Sem observações</span> },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
