import Link from "@/components/ui/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Check, ExternalLink, Paperclip } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Timeline } from "@/components/ui/timeline";
import { Notice } from "@/components/ui/empty";
import { cn } from "@/components/ui/cn";
import { formatDate, formatDateTime, formatTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { can, canDo } from "@/lib/permissions";
import { BusinessError } from "@/lib/core/errors";
import type { Doc } from "@/lib/db/types";
import { scopeStore, unscoped } from "@/lib/db/scoped-store";
import { CERT_KIND_LABEL, CERT_STATUS, CHARGE_CHANNEL_LABEL, VALIDATION_MODE_LABEL, requestDisplayStatus, requestNextAction, teamCertificateRequest } from "@/domain/accounting";
import { PaymentForm } from "./payment-form";
import { CancelForm } from "./cancel-form";
import { ApproveValidationForm, RejectValidationForm, ScheduleValidationForm } from "./validation-form";
import { EmissionForm, StartEmissionButton } from "./emission-form";
import { FailureForm } from "./failure-form";

export const metadata = { title: "Atendimento do protocolo" };

const OWNER_LABEL: Record<string, string> = { firm: "Escritório contábil", team: "Equipe de certificação Intercert", company: "Titular (empresa no ERP)", none: "Nenhuma ação pendente" };
const OWNER_TONE: Record<string, "accent" | "info" | "warn" | "good"> = { firm: "accent", team: "info", company: "warn", none: "good" };
const n = (count: number, one: string, many: string) => `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`;
const docLabel = (doc: string | null | undefined) => (doc && String(doc).replace(/\D/g, "").length === 11 ? "CPF" : "CNPJ");

/** ISO → valor de `datetime-local` no horário de Brasília (o servidor interpreta o campo nesse fuso). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).replace(" ", "T");
}

type StepState = "done" | "active" | "todo";

/** Régua das 4 etapas do protocolo (CERT_STATUS[].step) — a mesma do escritório: concluídas, atual e futuras. */
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
        : "Cobrança ainda não enviada pelo escritório";
  const validation =
    r.validationStatus === "approved" ? `Titular validado${r.validatedAt ? ` em ${formatDate(r.validatedAt)}` : ""}` : r.validationStatus === "scheduled" ? `Agendada para ${formatDateTime(r.validationAt)}` : r.validationStatus === "rejected" ? "Pendência: reagendamento" : r.status === "validation" ? "Aguardando agendamento" : "Pendente";
  const emission = r.issuedAt ? `Certificado emitido em ${formatDate(r.issuedAt)}` : r.status === "issue_failed" ? `Falha na emissão (tentativa ${r.emissionAttempts ?? 1})` : r.status === "issuing" ? `Registrar o retorno (tentativa ${r.emissionAttempts ?? 1})` : r.status === "ready_to_issue" ? "Aguardando o pedido de emissão" : "Pendente";
  const download = downloads > 0 ? `${n(downloads, "download", "downloads")} · último em ${formatDateTime(r.lastDownloadAt)}` : r.status === "ready_to_download" ? "Entrega liberada ao escritório" : r.status === "awaiting_authorization" ? "Autorização do titular pendente" : r.downloadAuthorized ? "Autorização do titular registrada" : "Pendente";
  return [
    { label: "1. Cobrança", hint: charge, state: state(1), tone: display === "overdue" ? "bad" : undefined },
    { label: "2. Validação", hint: validation, state: state(2), tone: r.validationStatus === "rejected" ? "warn" : undefined },
    { label: "3. Emissão", hint: emission, state: state(3), tone: r.status === "issue_failed" ? "bad" : undefined },
    { label: "4. Download", hint: download, state: state(4), tone: r.status === "awaiting_authorization" ? "warn" : undefined },
  ];
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("admin", "view");
  if (!canDo(s.user, "certification.operate")) redirect("/sem-permissao");
  const { id } = await params;
  let r: Doc & { firmName: string };
  try {
    r = await teamCertificateRequest(s.ctx, id);
  } catch (e) {
    if (e instanceof BusinessError && e.code === "not_found") notFound();
    throw e;
  }

  // o protocolo vive na empresa do escritório: leitura explícita nessa empresa (a equipe atravessa escritórios)
  const base = unscoped(s.ctx.store);
  const firmStore = scopeStore(base, r.companyId);
  const userIds = [...new Set([r.createdBy, r.responsibleUserId, r.paymentBy, r.validatedBy, r.issuedBy, r.cancelledBy, r.lastDownloadBy].filter(Boolean) as string[])];
  const [client, users] = await Promise.all([firmStore.get("accounting_clients", r.clientId), Promise.all(userIds.map((uid) => base.get("users", uid).catch(() => null)))]);
  const names = new Map(users.filter(Boolean).map((u) => [u!.id, String(u!.name)]));
  const userName = (uid: string | null | undefined) => (uid ? (names.get(uid) ?? "—") : "—");

  const display = requestDisplayStatus(r);
  const next = requestNextAction(r);
  const sends = Number(r.chargeSends ?? 0);
  const downloads = Number(r.downloads ?? 0);
  const attempt = Number(r.emissionAttempts ?? 0);
  const isPaymentStage = display === "awaiting_payment" || display === "overdue";
  const issued = r.status === "awaiting_authorization" || r.status === "ready_to_download" || r.status === "downloaded";
  const crumbs = [{ label: "Administração" }, { label: "Certificação digital", href: "/administracao/certificacao" }, { label: r.protocol }];
  const inFirm = s.ctx.companyId === r.companyId && canDo(s.user, "accounting.certificates");
  // a evidência da autorização é um anexo da empresa do escritório: /api/files só a entrega a quem está nessa empresa com consulta da carteira
  const canSeeEvidence = s.ctx.companyId === r.companyId && can(s.user, "accounting", "view");

  return (
    <>
      <PageHeader
        title={`${r.protocol} · ${r.holderName}`}
        crumbs={crumbs}
        badges={
          <>
            <StatusBadge kind="certificate_request" status={display} />
            <Badge tone="brand">{r.firmName}</Badge>
            <Badge>{r.productLabel}</Badge>
          </>
        }
        description={
          <>
            Atendimento pela equipe de certificação Intercert do protocolo aberto por <span className="font-medium text-ink">{r.firmName}</span> para {r.holderName}
            {r.holderDoc ? ` (${docLabel(r.holderDoc)} ${formatDoc(r.holderDoc)})` : ""}. Cada etapa é uma ação real, com autor, momento e referência no histórico.
          </>
        }
        actions={
          <>
            {inFirm && (
              <LinkButton href={`/contabil/certificados/${r.id}`} variant="outline" title="Abrir o protocolo na visão do escritório">
                <ExternalLink className="size-4" aria-hidden /> Ver como escritório
              </LinkButton>
            )}
            <LinkButton href="/administracao/certificacao" variant="ghost">
              <ArrowLeft className="size-4" aria-hidden /> Voltar à fila
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

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Próxima ação" description={`Responsável: ${OWNER_LABEL[next.owner] ?? next.owner}`} actions={<Badge tone={OWNER_TONE[next.owner] ?? "good"}>{OWNER_LABEL[next.owner] ?? next.owner}</Badge>}>
            <p className="text-base font-semibold text-ink">{next.label}</p>

            {isPaymentStage && (
              <div className="mt-4 space-y-4">
                <DefinitionList
                  cols={2}
                  items={[
                    { label: "Valor da cobrança", value: <span className="tabular font-semibold">{formatMoney(r.amount)}</span> },
                    { label: "Vencimento", value: <span className={display === "overdue" ? "font-medium text-red-700" : undefined}>{formatDate(r.dueDate)}{display === "overdue" ? " — vencida" : ""}</span> },
                    {
                      label: "Envio da cobrança pelo escritório",
                      value: sends > 0 ? (
                        <span>
                          {n(sends, "envio", "envios")} · último por {CHARGE_CHANNEL_LABEL[r.chargeChannel] ?? r.chargeChannel} em {formatDateTime(r.chargeSentAt)}
                          <span className="block text-xs text-slate-500">Para: {r.chargeTo}</span>
                        </span>
                      ) : (
                        <span className="text-amber-700">Cobrança ainda não enviada</span>
                      ),
                    },
                    { label: "Link de pagamento", value: r.chargeLink ? <a href={r.chargeLink} target="_blank" rel="noreferrer" className="break-all text-brand-700 hover:underline">{r.chargeLink}</a> : <span className="text-slate-500">Sem link automático — instruções de pagamento na mensagem</span> },
                  ]}
                />
                {sends === 0 && <Notice tone="warn">O escritório ainda não enviou a cobrança — confirme só com comprovante.</Notice>}
                {display === "overdue" && <Notice tone="warn">A cobrança venceu em {formatDate(r.dueDate)}. O escritório atualiza o vencimento e reenvia; se o pagamento chegou mesmo assim, confirme com a referência.</Notice>}
                <div className="border-t border-line pt-4">
                  <h3 className="mb-3 text-sm font-semibold text-ink">Confirmar pagamento</h3>
                  <PaymentForm id={r.id} amount={Number(r.amount ?? 0)} holderName={r.holderName} chargeSends={sends} />
                </div>
                <div className="flex justify-end border-t border-line pt-3">
                  <CancelForm id={r.id} protocol={r.protocol} holderName={r.holderName} firmName={r.firmName} />
                </div>
              </div>
            )}

            {r.status === "validation" && (
              <div className="mt-4 space-y-4">
                <DefinitionList
                  cols={2}
                  items={[
                    { label: "Pagamento confirmado", value: <span><span className="tabular">{formatMoney(r.amount)}</span>{r.paymentRef ? ` · referência ${r.paymentRef}` : ""}<span className="block text-xs text-slate-500">em {formatDateTime(r.paymentConfirmedAt)} por {userName(r.paymentBy)}</span></span> },
                    {
                      label: "Agendamento",
                      value: r.validationStatus === "scheduled" ? (
                        <span>
                          <span className="font-medium">{formatDate(r.validationAt)} · {formatTime(r.validationAt)} (Brasília) · {VALIDATION_MODE_LABEL[r.validationMode] ?? r.validationMode}</span>
                          {r.validationNotes && <span className="block text-xs text-slate-500">{r.validationNotes}</span>}
                        </span>
                      ) : r.validationStatus === "rejected" ? (
                        <span className="text-amber-700">Reagendamento pendente</span>
                      ) : (
                        <span className="text-amber-700">Ainda não agendada</span>
                      ),
                    },
                  ]}
                />
                {r.validationStatus === "rejected" && (
                  <Notice tone="warn" title="Validação não concluída">
                    {r.validationNotes ? `${r.validationNotes}. ` : ""}Reagende quando o titular estiver pronto; o escritório foi avisado para orientá-lo.
                  </Notice>
                )}
                <p className="text-sm text-slate-600">A identidade do titular e os documentos passam pela validação conduzida pela AR, conforme o processo da ICP-Brasil (ITI).</p>
                {r.validationStatus === "scheduled" && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
                    <ApproveValidationForm id={r.id} holderName={r.holderName} />
                    <RejectValidationForm id={r.id} holderName={r.holderName} />
                    <p className="text-sm text-slate-600">Registre o resultado da validação agendada.</p>
                  </div>
                )}
                <div className="border-t border-line pt-4">
                  <h3 className="mb-3 text-sm font-semibold text-ink">{r.validationAt ? "Reagendar a validação" : "Agendar a validação"}</h3>
                  <ScheduleValidationForm id={r.id} reschedule={Boolean(r.validationAt)} primary={r.validationStatus !== "scheduled"} defaultAt={toLocalInput(r.validationAt)} defaultMode={r.validationMode ?? "video"} defaultNotes={r.validationStatus === "scheduled" ? (r.validationNotes ?? "") : ""} holderName={r.holderName} />
                </div>
              </div>
            )}

            {r.status === "ready_to_issue" && (
              <div className="mt-4 space-y-4">
                <DefinitionList
                  cols={2}
                  items={[
                    { label: "Titular validado", value: <span className="text-emerald-700">{r.validatedAt ? `Em ${formatDateTime(r.validatedAt)}` : "Sim"} por {userName(r.validatedBy)}{r.validationNotes ? <span className="block text-xs text-slate-600">{r.validationNotes}</span> : null}</span> },
                    { label: "Pagamento", value: <span><span className="tabular">{formatMoney(r.amount)}</span>{r.paymentRef ? ` · referência ${r.paymentRef}` : ""}</span> },
                  ]}
                />
                <Notice tone="info">Aguardando o escritório pedir a emissão. Se a certificadora já foi acionada ou o escritório pediu por outro canal, a equipe pode adiantar a etapa.</Notice>
                <div className="flex flex-wrap items-center gap-3">
                  <StartEmissionButton id={r.id} holderName={r.holderName} retry={false} />
                  <p className="text-sm text-slate-600">O pedido fica no histórico em nome da equipe.</p>
                </div>
              </div>
            )}

            {r.status === "issuing" && (
              <div className="mt-4 space-y-4">
                <p className="text-sm text-slate-600">
                  Emissão em andamento — tentativa {attempt.toLocaleString("pt-BR")}, pedida em {formatDateTime(r.emissionRequestedAt)}. Registre o arquivo entregue pela certificadora ou a falha.
                </p>
                <div className="border-t border-line pt-4">
                  <h3 className="mb-3 text-sm font-semibold text-ink">Registrar emissão</h3>
                  <EmissionForm id={r.id} attempt={attempt} holderDoc={r.holderDoc ?? null} holderName={r.holderName} downloadAuthorized={Boolean(r.downloadAuthorized)} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <p className="text-sm text-slate-600">A certificadora não emitiu? Registre o retorno; o pagamento continua confirmado.</p>
                  <FailureForm id={r.id} protocol={r.protocol} attempt={attempt} />
                </div>
              </div>
            )}

            {r.status === "issue_failed" && (
              <div className="mt-4 space-y-4">
                <Notice tone="bad" title={`Falha na emissão (tentativa ${attempt.toLocaleString("pt-BR")})`}>
                  {r.emissionFailure ? `${r.emissionFailure}. ` : ""}Registrada em {formatDateTime(r.emissionFailedAt)}. O pagamento continua confirmado; o escritório foi avisado.
                </Notice>
                <div className="flex flex-wrap items-center gap-3">
                  <StartEmissionButton id={r.id} holderName={r.holderName} retry />
                  <p className="text-sm text-slate-600">A nova tentativa usa o mesmo protocolo, sem nova cobrança.</p>
                </div>
              </div>
            )}

            {issued && (
              <div className="mt-4 space-y-4">
                <DefinitionList
                  cols={2}
                  items={[
                    { label: "Certificado emitido", value: <span>{r.productLabel}<span className="block text-xs text-slate-500">em {formatDateTime(r.issuedAt)} por {userName(r.issuedBy)}</span></span> },
                    { label: "Validade", value: <span>{formatDate(r.validFrom)} a {formatDate(r.validTo)}</span> },
                    { label: "Série", value: r.serial ? <span className="font-mono">{r.serial}</span> : <span className="text-slate-500">Não informada</span> },
                    { label: "Emissor", value: r.issuer ?? <span className="text-slate-500">Não informado</span> },
                    { label: "Arquivo", value: <span className="break-all font-mono text-xs">{r.fileName ?? "—"}</span> },
                    {
                      label: "Autorização de download",
                      value: r.downloadAuthorized ? (
                        r.downloadAuthorizedBy === "company" ? (
                          <span className="text-emerald-700">Registrada pelo administrador da empresa no ERP em {formatDateTime(r.downloadAuthorizedAt)}</span>
                        ) : (
                          <span>
                            <span className="text-emerald-700">Registrada pelo escritório em {formatDateTime(r.downloadAuthorizedAt)}</span>
                            {r.downloadAuthNotes && <span className="block text-xs text-slate-600">{r.downloadAuthNotes}</span>}
                            {r.downloadAuthEvidenceFileId &&
                              (canSeeEvidence ? (
                                <a href={`/api/files/${r.downloadAuthEvidenceFileId}`} className="mt-0.5 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                                  <Paperclip className="size-3.5" aria-hidden /> Ver evidência anexada
                                </a>
                              ) : (
                                <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500" title="O anexo fica na empresa do escritório; abra o protocolo com essa empresa ativa para vê-lo">
                                  <Paperclip className="size-3.5" aria-hidden /> Evidência anexada ao protocolo
                                </span>
                              ))}
                          </span>
                        )
                      ) : (
                        <span className="text-amber-700">{r.linkedCompanyId ? "Pendente do titular (administrador da empresa no ERP)" : "Pendente — o escritório registra a autorização do titular"}</span>
                      ),
                    },
                    { label: "Downloads", value: downloads > 0 ? <span>{n(downloads, "download", "downloads")}<span className="block text-xs text-slate-500">último em {formatDateTime(r.lastDownloadAt)} por {userName(r.lastDownloadBy)}</span></span> : <span className="text-slate-500">Nenhum download registrado</span> },
                  ]}
                />
                <p className="text-sm text-slate-600">O arquivo é baixado somente pelo escritório autorizado ou pelo próprio titular, com confirmação de senha; a equipe de certificação não baixa o certificado.</p>
              </div>
            )}

            {r.status === "cancelled" && (
              <div className="mt-4">
                <DefinitionList
                  cols={2}
                  items={[
                    { label: "Motivo", value: r.cancelReason },
                    { label: "Cancelada por", value: <span>{userName(r.cancelledBy)}<span className="block text-xs text-slate-500">{formatDateTime(r.cancelledAt)}</span></span> },
                  ]}
                />
              </div>
            )}
          </Card>

          <Card title="Histórico" description="Cobrança, pagamento, validação, emissão, autorização, downloads e cancelamento — com quem fez e quando.">
            <Timeline store={firmStore} refs={[`certificate_request:${r.id}`]} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Dados">
            <DefinitionList
              cols={1}
              items={[
                { label: "Escritório", value: r.firmName },
                { label: "Cliente do escritório", value: client ? (client.code ? `${client.code} — ${client.name}` : client.name) : r.holderName },
                { label: "Titular", value: <span>{r.holderName}{r.holderDoc && <span className="tabular block text-xs text-slate-500">{docLabel(r.holderDoc)} {formatDoc(r.holderDoc)}</span>}</span> },
                { label: "Titular no ERP", value: r.linkedCompanyId ? <span className="text-emerald-700">Empresa vinculada — autoriza o download no ERP</span> : <span className="text-slate-500">Sem vínculo — o escritório registra a autorização</span> },
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
                        {r.contactPhone ? <span className={r.contactEmail ? "block text-xs text-slate-500" : "block"}>{formatPhone(r.contactPhone) || r.contactPhone}</span> : null}
                      </span>
                    ) : (
                      <span className="text-amber-700">Sem contato informado</span>
                    ),
                },
                { label: "Responsável no escritório", value: userName(r.responsibleUserId) },
                { label: "Aberta em", value: <span>{formatDateTime(r.createdAt)}<span className="block text-xs text-slate-500">por {userName(r.createdBy)}</span></span> },
                { label: "Observações do escritório", value: r.notes ? <span className="whitespace-pre-wrap">{r.notes}</span> : <span className="text-slate-500">Sem observações</span> },
              ]}
            />
            <p className="mt-4 text-xs text-slate-500">
              A fila completa fica em{" "}
              <Link href="/administracao/certificacao" className="text-brand-700 hover:underline">
                Certificação digital
              </Link>
              .
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
