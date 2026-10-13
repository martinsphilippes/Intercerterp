"use client";

import { useMemo, useState } from "react";
import { ArrowRight, BadgeCheck, KeyRound } from "lucide-react";
import Link from "@/components/ui/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, FormSection, Input, Select, Textarea } from "@/components/ui/form";
import { buttonClass, LinkButton, Spinner } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { CERT_KIND } from "@/domain/accounting/common";
import { createCertificateRequestAction, requestTrackingAccessAction } from "./actions";

type Opt = { value: string; label: string };

export interface ClientInfo {
  id: string;
  name: string;
  code: string | null;
  doc: string | null;
  personType: "PF" | "PJ";
  email: string | null;
  phone: string | null;
  responsibleUserId: string | null;
  /** cliente sem ERP: sempre liberado; vinculado: só com a autorização do titular */
  tracking: { allowed: boolean; linked: boolean };
  openRequest: { id: string; protocol: string; status: string } | null;
  lastCert: { id: string; validTo: string | null; productLabel: string; daysLeft: number | null; validity: "expired" | "due_soon" | "ok" | "unknown"; source: "issued" | "manual" | "erp" } | null;
}

export interface ProductInfo {
  key: string;
  label: string;
  months: number;
  /** centavos */
  price: number;
}

/** centavos → "199,00" (o campo de valor é texto em reais, como o usuário digita). */
const toReais = (cents: number) => (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const validityPhrase = (daysLeft: number | null) => {
  if (daysLeft == null) return "validade não informada";
  if (daysLeft < 0) return `vencido há ${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? "dia" : "dias"}`;
  if (daysLeft === 0) return "vence hoje";
  return `vence em ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"}`;
};

/**
 * Nova solicitação de certificado (Tela 67, p.3–4). Os nomes dos campos batem com o que `createCertificateRequestAction`
 * lê: clientId, kind, product, amount (reais), dueDate, contactEmail, contactPhone, notes, previousCertificateId,
 * responsibleUserId. Em sucesso a ação redireciona ao protocolo criado.
 * O cliente é escolhido fora do formulário principal (campo oculto) para que o pedido de acesso ao titular — outro
 * formulário — não fique aninhado.
 */
export function RequestForm({
  clients, products, users, initialClientId, initialKind, initialPrevious, defaultDueDate, defaultDueDays, minDueDate,
}: {
  clients: ClientInfo[];
  products: ProductInfo[];
  users: Opt[];
  initialClientId: string | null;
  initialKind: "new" | "renewal";
  initialPrevious: string | null;
  /** hoje + `defaultDueDays`, calculado no servidor */
  defaultDueDate: string;
  defaultDueDays: number;
  /** hoje, calculado no servidor */
  minDueDate: string;
}) {
  const byId = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  // produto sugerido pelo tipo de pessoa (e-CPF para PF, e-CNPJ para PJ) quando o catálogo distingue; senão o primeiro
  const suggestedProduct = (c: ClientInfo | null | undefined): ProductInfo | null => (c && products.find((p) => new RegExp(c.personType === "PF" ? "cpf" : "cnpj", "i").test(p.label))) || products[0] || null;
  const [clientId, setClientId] = useState(initialClientId && byId.has(initialClientId) ? initialClientId : "");
  const [kind, setKind] = useState<"new" | "renewal">(initialKind);
  const initial = clientId ? byId.get(clientId) : null;
  const firstProduct = suggestedProduct(initial);
  const [productKey, setProductKey] = useState(firstProduct?.key ?? "");
  const [amount, setAmount] = useState(firstProduct ? toReais(firstProduct.price) : "");
  const [contactEmail, setContactEmail] = useState(initial?.email ?? "");
  const [contactPhone, setContactPhone] = useState(initial?.phone ? formatPhone(initial.phone) : "");
  const [responsibleUserId, setResponsibleUserId] = useState(initial?.responsibleUserId && users.some((u) => u.value === initial.responsibleUserId) ? initial.responsibleUserId : "");

  const client = clientId ? (byId.get(clientId) ?? null) : null;
  const product = products.find((p) => p.key === productKey) ?? products[0] ?? null;
  const trackingBlocked = Boolean(client && client.tracking.linked && !client.tracking.allowed);
  const blocked = !client || Boolean(client.openRequest) || trackingBlocked;
  // renovação: o certificado anterior vem da aba Validades (?previous=) ou é o último conhecido do cliente (nunca o do ERP, que não é da carteira)
  const previousId = useMemo(() => {
    if (!client || kind !== "renewal") return "";
    if (initialPrevious && client.id === initialClientId && !initialPrevious.startsWith("erp:")) return initialPrevious;
    if (client.lastCert && client.lastCert.source !== "erp") return client.lastCert.id;
    return "";
  }, [client, kind, initialPrevious, initialClientId]);

  const pickProduct = (key: string) => {
    setProductKey(key);
    const p = products.find((x) => x.key === key);
    if (p) setAmount(toReais(p.price));
  };
  const pickClient = (id: string) => {
    setClientId(id);
    const c = byId.get(id);
    const sp = suggestedProduct(c);
    if (sp && sp.key !== productKey) pickProduct(sp.key);
    setContactEmail(c?.email ?? "");
    setContactPhone(c?.phone ? formatPhone(c.phone) : "");
    setResponsibleUserId(c?.responsibleUserId && users.some((u) => u.value === c.responsibleUserId) ? c.responsibleUserId : "");
  };

  const clientOptions = clients.map((c) => ({ value: c.id, label: `${c.code ? `${c.code} — ` : ""}${c.name}${c.doc ? ` (${formatDoc(c.doc)})` : ""}` }));

  return (
    <div className="space-y-5">
      <FormSection title="Cliente" description="Titular do certificado. Clientes encerrados não aparecem; um cliente com atendimento em andamento não pode abrir outro.">
        <div className="space-y-4">
          <Field label="Cliente" required htmlFor="cert-client">
            <Select id="cert-client" value={clientId} onChange={(e) => pickClient(e.target.value)} options={clientOptions} placeholder="Selecione o cliente" autoFocus={!clientId} />
          </Field>

          {client && (
            <div className="flex items-start gap-2 rounded-md border border-line bg-slate-50 p-3 text-sm">
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
              <p>
                <span className="font-medium text-ink">Titular: {client.name}</span>
                <span className="text-slate-600">
                  {" "}· {client.doc ? `${client.personType === "PF" ? "CPF" : "CNPJ"} ${formatDoc(client.doc)}` : "sem CPF/CNPJ informado"}
                  {product ? ` · ${product.label}` : ""}
                </span>
              </p>
            </div>
          )}

          {client?.openRequest && (
            <Notice tone="warn" title={`Já existe atendimento em andamento: ${client.openRequest.protocol}`}>
              <p className="flex flex-wrap items-center gap-2">
                <StatusBadge kind="certificate_request" status={client.openRequest.status} />
                <span>Acompanhe esse protocolo em vez de abrir outro; uma nova solicitação só é possível depois que ele for concluído ou cancelado.</span>
              </p>
              <LinkButton href={`/contabil/certificados/${client.openRequest.id}`} size="sm" className="mt-2">
                Acompanhar {client.openRequest.protocol} <ArrowRight className="size-3.5" aria-hidden />
              </LinkButton>
            </Notice>
          )}

          {trackingBlocked && client && (
            <Notice tone="warn" title="A empresa ainda não autorizou o escritório a acompanhar seus certificados">
              <p>
                {client.name} está vinculada ao ERP, e o acompanhamento de certificados depende de uma autorização própria do administrador da empresa (Administração → Integrações → Contabilidade → Certificados digitais), independente do vínculo fiscal. Prepare o pedido de acesso: os administradores da empresa recebem a notificação no ERP.
              </p>
              <ActionForm action={requestTrackingAccessAction} className="mt-2">
                {({ pending }) => (
                  <>
                    <input type="hidden" name="clientId" value={client.id} />
                    <SubmitButton pending={pending} variant="secondary" size="sm">
                      <KeyRound className="size-3.5" aria-hidden /> Preparar pedido de acesso
                    </SubmitButton>
                  </>
                )}
              </ActionForm>
            </Notice>
          )}

          {client && !client.openRequest && client.lastCert && (
            <Notice tone="info">
              <span className="font-medium">Certificado atual:</span> {client.lastCert.productLabel} · {client.lastCert.validTo ? `válido até ${formatDate(client.lastCert.validTo)}` : "validade não informada"} ({validityPhrase(client.lastCert.daysLeft)}) · a nova solicitação preserva o histórico anterior.
            </Notice>
          )}
        </div>
      </FormSection>

      <ActionForm action={createCertificateRequestAction} className="space-y-5">
        {({ pending, error }) => (
          <>
            <input type="hidden" name="clientId" value={clientId} />
            {previousId && <input type="hidden" name="previousCertificateId" value={previousId} />}

            <FormSection title="Solicitação" description="Tipo de pedido, produto do catálogo e valor da cobrança.">
              <FormGrid cols={3}>
                <Field label="Solicitação" required hint={kind === "renewal" ? (previousId ? "Renova o certificado atual do cliente; o anterior fica no histórico com a validade original." : "Renovação sem certificado anterior registrado na carteira.") : "Primeira emissão para este titular."}>
                  <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value === "renewal" ? "renewal" : "new")} options={CERT_KIND.map((k) => ({ value: k.value, label: k.label }))} disabled={pending} />
                </Field>
                <Field label="Produto" required hint={product ? `${product.months} ${product.months === 1 ? "mês" : "meses"} de validade · valor de catálogo ${formatMoney(product.price)}` : undefined}>
                  <Select name="product" value={productKey} onChange={(e) => pickProduct(e.target.value)} options={products.map((p) => ({ value: p.key, label: p.label }))} disabled={pending} />
                </Field>
                <Field label="Valor da cobrança (R$)" required hint="Pagamento único, separado da mensalidade do ERP.">
                  {/* só números em reais ("199,00", "1.234,56" ou "1234.56"): o navegador barra outro formato antes do envio;
                      "1.234" sem centavos é ambíguo (parseMoney leria R$ 1,23) e por isso não é aceito */}
                  <Input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="199,00" required pattern="[0-9]{1,3}(\.[0-9]{3})+,[0-9]{1,2}|[0-9]+([.,][0-9]{1,2})?" title="Informe o valor em reais, por exemplo 199,00 ou 1.234,56" disabled={pending} className="tabular" />
                </Field>
              </FormGrid>
            </FormSection>

            <FormSection title="Cobrança" description="Para onde a cobrança será enviada e até quando o cliente deve pagar. O envio acontece na próxima etapa, no protocolo.">
              <FormGrid cols={3}>
                <Field label="E-mail de contato" hint="Vem do cadastro do cliente; pode ser ajustado para esta cobrança.">
                  <Input type="email" name="contactEmail" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="financeiro@cliente.com.br" disabled={pending} />
                </Field>
                <Field label="Telefone / WhatsApp" hint="Usado quando a cobrança é enviada por WhatsApp ou telefone.">
                  <Input name="contactPhone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="(11) 99999-0000" disabled={pending} />
                </Field>
                <Field label="Vencimento da cobrança" required hint={`Não pode ser anterior a hoje. Padrão: ${defaultDueDays} ${defaultDueDays === 1 ? "dia" : "dias"}.`}>
                  <Input type="date" name="dueDate" defaultValue={defaultDueDate} min={minDueDate} required disabled={pending} />
                </Field>
              </FormGrid>
            </FormSection>

            <FormSection title="Acompanhamento" description="Quem recebe os avisos do protocolo no escritório e observações internas.">
              <FormGrid cols={2}>
                <Field label="Responsável pelo acompanhamento" hint="Vazio = responsável geral do cliente (ou você).">
                  <Select name="responsibleUserId" value={responsibleUserId} onChange={(e) => setResponsibleUserId(e.target.value)} options={users} placeholder="Responsável do cliente" disabled={pending} />
                </Field>
                <Field label="Observações" hint="Opcional; ficam no protocolo (não vão na cobrança).">
                  <Textarea name="notes" rows={2} maxLength={1000} disabled={pending} />
                </Field>
              </FormGrid>
            </FormSection>

            {error && <Notice tone="bad">{error}</Notice>}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600">
                Próxima etapa: conferir e enviar a cobrança.
                {!client && <span className="block text-xs text-slate-500">Selecione o cliente para continuar.</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/contabil/certificados" className={buttonClass("ghost")}>
                  Cancelar
                </Link>
                {/* bloqueado enquanto houver atendimento em andamento ou autorização pendente: o servidor recusaria com a mesma regra */}
                <button type="submit" disabled={blocked || pending} aria-busy={pending || undefined} className={buttonClass("primary")} title={!client ? "Selecione o cliente" : client.openRequest ? `Já existe atendimento em andamento (${client.openRequest.protocol})` : trackingBlocked ? "Aguardando a autorização de acompanhamento pela empresa" : undefined}>
                  {pending && <Spinner />}
                  Criar solicitação
                </button>
              </div>
            </div>
          </>
        )}
      </ActionForm>
    </div>
  );
}
