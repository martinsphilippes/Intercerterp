import crypto from "node:crypto";
import type { Doc, Store } from "@/lib/db/types";
import { BusinessError } from "@/lib/core/errors";
import type { Ctx } from "@/lib/core/ctx";
import { addDays, nowIso, today } from "@/lib/dates";
import { onlyDigits } from "@/lib/core/text";
import type { IntegrationKind, TestOutcome } from "../integrations";
import type { DeliveryMode, PayMethod, PaymentStatus } from "./common";

/**
 * Provedores do comércio digital — o ponto onde Gateway Intercert, Banco Intercert, plataformas de frete e a hospedagem
 * dos domínios se ligam (docs/regras-assumidas.md §49). Cada frente tem uma interface única; o resto do módulo (checkout,
 * pedidos, conciliação, monitor) só conversa com a interface. Até a ligação de cada serviço, a SIMULAÇÃO responde com
 * a mesma forma de dados — trocar o provedor na Central de integrações não muda nenhuma tela nem regra.
 *
 * Credenciais: somente o NOME da variável de ambiente fica gravado (Central de integrações); o valor é lido aqui, na hora
 * da chamada, e nunca vai para o banco, para o navegador ou para o monitor.
 */

// ───────────────────────────── Gateway de pagamento

export interface ChargeInput {
  orderId: string;
  orderCode: string;
  amount: number;
  method: PayMethod;
  installments: number;
  customer: { name: string; email: string; doc: string };
  /** simulação: resultado escolhido no checkout ("Cartão de teste") — o provedor real ignora */
  simulate?: "approve" | "decline" | null;
  /** cartão: token gerado pelo componente do gateway no navegador (o número do cartão nunca chega ao servidor) */
  cardToken?: string | null;
  pixExpiresMinutes: number;
  boletoDueDays: number;
}

export interface GatewayCharge {
  providerRef: string;
  status: PaymentStatus;
  method: PayMethod;
  message: string;
  pix?: { copyPaste: string; expiresAt: string } | null;
  boleto?: { line: string; dueDate: string } | null;
  card?: { brand: string; last4: string; installments: number; authorizationCode: string | null } | null;
  /** aprovação imediata (cartão): o pedido trata como evento de pagamento aprovado */
  approvedNow?: boolean;
}

/** Evento de pagamento normalizado (vindo do aviso do gateway ou do simulador). */
export interface PaymentEvent {
  /** identificador único do evento no provedor — base da idempotência (repetição não duplica efeito) */
  externalKey: string;
  type: "approved" | "pending" | "failed" | "expired" | "refunded" | "chargeback";
  providerRef: string;
  amount?: number | null;
  fee?: number | null;
  occurredAt?: string | null;
  message?: string | null;
}

export interface GatewayProvider {
  id: string;
  label: string;
  simulated: boolean;
  createCharge(input: ChargeInput): Promise<GatewayCharge>;
  refund(input: { providerRef: string; amount: number; reason: string }): Promise<{ status: "refunded" | "refund_pending"; message: string }>;
  /** confere a assinatura do aviso (webhook); false = descartado sem efeito */
  verifyWebhook(headers: Headers, rawBody: string): boolean;
  parseWebhook(body: unknown): PaymentEvent[];
}

const simulatedRef = (prefix: string, orderId: string, salt = "") => `sim_${prefix}_${crypto.createHash("sha256").update(`${orderId}:${salt}`).digest("hex").slice(0, 16)}`;

/** Gateway de simulação: mesma forma de dados do provedor real, sem valor financeiro. */
export const simulatedGateway: GatewayProvider = {
  id: "simulated",
  label: "Simulação (sem cobrança real)",
  simulated: true,
  async createCharge(input) {
    if (input.method === "pix") {
      const ref = simulatedRef("pix", input.orderId, String(input.amount));
      return {
        providerRef: ref,
        status: "pending",
        method: "pix",
        message: "Cobrança Pix de simulação criada: aguardando a confirmação (use “Simular pagamento”).",
        pix: { copyPaste: `SIMULACAO-SEM-VALOR|PIX|${input.orderCode}|${ref}`, expiresAt: new Date(Date.now() + input.pixExpiresMinutes * 60000).toISOString() },
      };
    }
    if (input.method === "boleto") {
      const ref = simulatedRef("bol", input.orderId, String(input.amount));
      const digits = onlyDigits(crypto.createHash("sha256").update(ref).digest("hex").replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10))).padEnd(47, "0").slice(0, 47);
      return {
        providerRef: ref,
        status: "pending",
        method: "boleto",
        message: "Boleto de simulação emitido (sem validade bancária).",
        boleto: { line: `00000.${digits.slice(5, 10)} ${digits.slice(10, 15)}.${digits.slice(15, 21)} ${digits.slice(21, 26)}.${digits.slice(26, 32)} 0 ${digits.slice(33, 47)}`, dueDate: addDays(today(), input.boletoDueDays) },
      };
    }
    const ref = simulatedRef("card", input.orderId, `${input.amount}:${input.installments}:${input.simulate ?? "approve"}`);
    const declined = input.simulate === "decline";
    return {
      providerRef: ref,
      status: declined ? "failed" : "paid",
      method: "card",
      message: declined ? "Cartão de teste recusado na simulação." : `Cartão de teste aprovado na simulação (${input.installments}x).`,
      card: { brand: "Teste", last4: declined ? "0002" : "4242", installments: input.installments, authorizationCode: declined ? null : ref.slice(-6).toUpperCase() },
      approvedNow: !declined,
    };
  },
  async refund() {
    return { status: "refunded", message: "Estorno registrado na simulação (sem devolução real de valores)." };
  },
  verifyWebhook() {
    // a simulação não recebe avisos externos: os retornos vêm do simulador da Tela 56, dentro do ERP
    return false;
  },
  parseWebhook() {
    return [];
  },
};

/** Tolerância do carimbo de tempo da assinatura (anti-repetição de aviso antigo). */
const WEBHOOK_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Gateway Intercert — conector reservado. O contrato dos avisos segue o formato abaixo até a documentação oficial:
 *   cabeçalhos `x-intercert-timestamp` (segundos) e `x-intercert-signature` = HMAC-SHA256(segredo, `${timestamp}.${corpo}`) em hex;
 *   corpo `{ id, type: "payment.approved"|"payment.pending"|"payment.failed"|"payment.expired"|"payment.refunded"|"payment.chargeback",
 *           data: { chargeId, amount, fee, occurredAt, message } }`.
 * A criação de cobranças e o estorno pela API entram na integração (a chamada fica num único lugar: este objeto).
 */
export function intercertGateway(secretRefs: Record<string, string>): GatewayProvider {
  const secret = () => (secretRefs.webhookSecret ? process.env[secretRefs.webhookSecret] ?? "" : "");
  const notConnected = () =>
    new BusinessError(
      "O Gateway Intercert ainda não está ligado a esta versão: a loja segue com a simulação até a homologação (Administração › Integrações › Gateway de pagamento da loja virtual).",
      "gateway_not_connected",
    );
  return {
    id: "intercert",
    label: "Gateway Intercert",
    simulated: false,
    async createCharge() {
      throw notConnected();
    },
    async refund() {
      throw notConnected();
    },
    verifyWebhook(headers, rawBody) {
      const key = secret();
      const ts = headers.get("x-intercert-timestamp") ?? "";
      const sig = (headers.get("x-intercert-signature") ?? "").trim().toLowerCase();
      if (!key || !/^\d{9,12}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
      if (Math.abs(Date.now() - Number(ts) * 1000) > WEBHOOK_MAX_AGE_MS) return false;
      const expected = crypto.createHmac("sha256", key).update(`${ts}.${rawBody}`).digest("hex");
      return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
    },
    parseWebhook(body) {
      const b = (body ?? {}) as Record<string, any>;
      const map: Record<string, PaymentEvent["type"]> = {
        "payment.approved": "approved",
        "payment.pending": "pending",
        "payment.failed": "failed",
        "payment.expired": "expired",
        "payment.refunded": "refunded",
        "payment.chargeback": "chargeback",
      };
      const type = map[String(b.type ?? "")];
      const ref = String(b.data?.chargeId ?? "");
      if (!type || !b.id || !ref) return [];
      return [
        {
          externalKey: `intercert:${String(b.id).slice(0, 120)}`,
          type,
          providerRef: ref.slice(0, 120),
          amount: Number.isFinite(Number(b.data?.amount)) ? Math.round(Number(b.data.amount)) : null,
          fee: Number.isFinite(Number(b.data?.fee)) ? Math.round(Number(b.data.fee)) : null,
          occurredAt: typeof b.data?.occurredAt === "string" ? b.data.occurredAt : null,
          message: typeof b.data?.message === "string" ? b.data.message.slice(0, 300) : null,
        },
      ];
    },
  };
}

async function storeIntegration(store: Store, companyId: string, kind: IntegrationKind) {
  const { getIntegration } = await import("../integrations");
  return getIntegration(store, companyId, null, kind);
}

/** Gateway efetivo da empresa: o configurado na Central de integrações ou, sem configuração, a simulação. */
export async function gatewayFor(store: Store, companyId: string): Promise<GatewayProvider> {
  const integ = await storeIntegration(store, companyId, "store_gateway");
  if (integ?.provider === "intercert") return intercertGateway(integ.secretRefs ?? {});
  return simulatedGateway;
}

export function gatewayById(id: string, integ: Doc | null): GatewayProvider | null {
  if (id === "simulated") return simulatedGateway;
  if (id === "intercert" && integ?.provider === "intercert") return intercertGateway(integ.secretRefs ?? {});
  return null;
}

// ───────────────────────────── Banco

export interface BankProvider {
  id: string;
  label: string;
  simulated: boolean;
  /** solicita a transferência (repasse) — a simulação apenas registra */
  requestPayout(input: { amount: number; reference: string }): Promise<{ status: "draft" | "requested"; providerRef: string | null; message: string }>;
}

export const simulatedBank: BankProvider = {
  id: "simulated",
  label: "Simulação (créditos sem valor financeiro)",
  simulated: true,
  async requestPayout() {
    return { status: "draft", providerRef: null, message: "Solicitação registrada em rascunho: a conta do Banco Intercert não está ligada, nenhum valor é movimentado." };
  },
};

export async function bankFor(store: Store, companyId: string): Promise<BankProvider> {
  const integ = await storeIntegration(store, companyId, "store_bank");
  if (integ?.provider === "intercert")
    return {
      id: "intercert",
      label: "Banco Intercert",
      simulated: false,
      async requestPayout() {
        throw new BusinessError("O Banco Intercert ainda não está ligado a esta versão: o repasse fica em rascunho até a homologação.", "bank_not_connected");
      },
    };
  return simulatedBank;
}

// ───────────────────────────── Logística (transportadora e entrega por terceiros)

export interface PackageInfo {
  weightGrams: number;
  heightCm: number;
  widthCm: number;
  lengthCm: number;
  value: number;
}

export interface CarrierQuote {
  mode: Extract<DeliveryMode, "carrier" | "third_party">;
  service: "standard" | "express" | "app";
  label: string;
  price: number;
  daysMin: number;
  daysMax: number;
  provider: string;
  simulated: boolean;
}

export interface LogisticsProvider {
  id: string;
  simulated: boolean;
  quote(input: { originZip: string; destZip: string; pkg: PackageInfo; modes: Array<"carrier" | "third_party">; thirdPartyLabel: string }): Promise<CarrierQuote[]>;
  /** etiqueta / chamada do entregador: a simulação devolve um código demonstrativo, sem validade para postagem */
  createShipment(input: { orderCode: string; mode: "carrier" | "third_party"; service: string }): Promise<{ trackingCode: string; labelNote: string; simulated: boolean }>;
}

/** Peso tarifável (gramas): o maior entre o real e o cúbico (fator 6.000 cm³/kg). */
export function billableGrams(p: Pick<PackageInfo, "weightGrams" | "heightCm" | "widthCm" | "lengthCm">) {
  const cubic = Math.ceil(((p.heightCm * p.widthCm * p.lengthCm) / 6000) * 1000);
  return Math.max(p.weightGrams, cubic);
}

/**
 * Distância aproximada entre CEPs pela faixa (0 = mesma região metropolitana, 1 = mesmo estado/região postal,
 * 2 = região vizinha, 3 = distante). É só a tabela de referência da simulação — a cotação real vem da plataforma.
 */
export function zipZone(origin: string, dest: string): 0 | 1 | 2 | 3 {
  const o = onlyDigits(origin);
  const d = onlyDigits(dest);
  if (o.length !== 8 || d.length !== 8) return 3;
  if (o.slice(0, 2) === d.slice(0, 2)) return 0;
  if (o[0] === d[0]) return 1;
  return Math.abs(Number(o[0]) - Number(d[0])) <= 2 ? 2 : 3;
}

const to90 = (cents: number) => Math.max(90, Math.round(cents / 100) * 100 - 10);

/** Tabela de referência da simulação (Tela 58: "preços e prazos exibidos usam uma tabela fictícia"). */
export const simulatedLogistics: LogisticsProvider = {
  id: "simulated",
  simulated: true,
  async quote({ originZip, destZip, pkg, modes, thirdPartyLabel }) {
    const zone = zipZone(originZip, destZip);
    const extraKg = Math.max(0, Math.ceil((billableGrams(pkg) - 1000) / 1000));
    const out: CarrierQuote[] = [];
    if (modes.includes("carrier")) {
      out.push({ mode: "carrier", service: "standard", label: "Entrega padrão", price: to90(1490 + zone * 600 + extraKg * 200), daysMin: 4 + zone * 2, daysMax: 6 + zone * 2, provider: "simulated", simulated: true });
      out.push({ mode: "carrier", service: "express", label: "Entrega expressa", price: to90(2490 + zone * 900 + extraKg * 300), daysMin: 1 + zone, daysMax: 2 + zone, provider: "simulated", simulated: true });
    }
    // entrega por aplicativo: só dentro da mesma região metropolitana e até 15 kg
    if (modes.includes("third_party") && zone === 0 && billableGrams(pkg) <= 15000) {
      out.push({ mode: "third_party", service: "app", label: thirdPartyLabel || "Entrega expressa por aplicativo", price: to90(990 + extraKg * 100), daysMin: 0, daysMax: 1, provider: "simulated", simulated: true });
    }
    return out;
  },
  async createShipment({ orderCode, mode }) {
    const code = `SIM${mode === "carrier" ? "TR" : "AP"}${crypto.createHash("sha256").update(orderCode).digest("hex").slice(0, 9).toUpperCase()}BR`;
    return { trackingCode: code, labelNote: "Etiqueta demonstrativa: sem validade para postagem (logística em simulação).", simulated: true };
  },
};

export async function logisticsFor(store: Store, companyId: string): Promise<LogisticsProvider> {
  const integ = await storeIntegration(store, companyId, "store_logistics");
  if (integ && integ.provider !== "simulated")
    return {
      id: integ.provider,
      simulated: false,
      async quote() {
        throw new BusinessError("A plataforma de fretes ainda não está ligada a esta versão: a cotação de transportadora e de entrega por terceiros segue na simulação até a homologação.", "logistics_not_connected");
      },
      async createShipment() {
        throw new BusinessError("A plataforma de fretes ainda não está ligada a esta versão.", "logistics_not_connected");
      },
    };
  return simulatedLogistics;
}

// ───────────────────────────── Domínios

/** Destinos do apontamento DNS do domínio próprio (hospedagem atual: Vercel). Configuráveis por variável de ambiente. */
export function dnsTargets() {
  return {
    cname: (process.env.STORE_DNS_CNAME || "cname.vercel-dns.com").toLowerCase(),
    a: (process.env.STORE_DNS_A || "76.76.21.21").split(",").map((x) => x.trim()).filter(Boolean),
  };
}

export interface DomainCheck {
  status: "pending_dns" | "active" | "misconfigured" | "error";
  diagnostic: string;
  records: Array<{ type: "CNAME" | "A" | "TXT"; name: string; value: string; ok: boolean }>;
}

export interface DomainProvider {
  id: string;
  /** cadastra o domínio no projeto da hospedagem (a verificação manual não precisa) */
  register(domain: string): Promise<{ ok: boolean; message: string }>;
  check(domain: string, verifyToken: string): Promise<DomainCheck>;
}

/** Nome do registro TXT que comprova o controle do domínio pela empresa. */
export const verifyRecordName = (domain: string) => `_intercert.${domain}`;
export const verifyRecordValue = (token: string) => `intercert-verify=${token}`;

/** Domínio raiz (sem subdomínio): aponta por registro A; subdomínio (www, loja) aponta por CNAME. */
export function isApexDomain(domain: string) {
  const labels = domain.split(".");
  if (labels.length <= 2) return true;
  return labels.length === 3 && /\.(com|net|org|art|blog|app|eco|edu|gov|ind|inf|log|med|tur|adv|arq|eng|mus|ong|rec|srv|tmp|tv|emp|eti|nom)\.br$/.test(domain);
}

/**
 * Conferência pelo DNS público (sem credencial e sem acesso HTTP ao domínio): o apontamento leva o tráfego à
 * hospedagem e o TXT com o código da loja prova que quem cadastrou controla o domínio. Só os dois juntos ativam.
 */
export async function dnsCheck(domain: string, verifyToken: string): Promise<DomainCheck> {
  const t = dnsTargets();
  const apex = isApexDomain(domain);
  try {
    const dns = await import("node:dns/promises");
    const [cnames, addrs, txts] = await Promise.all([
      apex ? Promise.resolve([] as string[]) : dns.resolveCname(domain).catch(() => [] as string[]),
      dns.resolve4(domain).catch(() => [] as string[]),
      dns.resolveTxt(verifyRecordName(domain)).catch(() => [] as string[][]),
    ]);
    const okCname = cnames.some((c) => c.toLowerCase().replace(/\.$/, "") === t.cname);
    const okA = addrs.length > 0 && addrs.every((a) => t.a.includes(a));
    const pointing = okCname || okA;
    const owned = txts.map((parts) => parts.join("")).some((v) => v.trim() === verifyRecordValue(verifyToken));
    const records: DomainCheck["records"] = [
      ...(apex ? t.a.map((ip) => ({ type: "A" as const, name: "@", value: ip, ok: okA })) : [{ type: "CNAME" as const, name: domain.split(".")[0], value: t.cname, ok: pointing }]),
      { type: "TXT", name: verifyRecordName(domain), value: verifyRecordValue(verifyToken), ok: owned },
    ];
    if (pointing && owned) return { status: "active", diagnostic: "Domínio verificado: apontamento e código de verificação corretos. O certificado HTTPS é emitido pela hospedagem.", records };
    if (!pointing && (cnames.length || addrs.length)) return { status: "misconfigured", diagnostic: `O domínio aponta para outro destino (${[...cnames, ...addrs].slice(0, 3).join(", ")}). Ajuste o registro no provedor do domínio.`, records };
    const missing = [!pointing && (apex ? "registro A" : "registro CNAME"), !owned && "registro TXT de verificação"].filter(Boolean).join(" e ");
    return { status: "pending_dns", diagnostic: `Falta ${missing} no provedor do domínio. A propagação do DNS pode levar algumas horas.`, records };
  } catch (e: any) {
    return { status: "error", diagnostic: `Falha ao consultar o DNS: ${String(e?.message ?? e).slice(0, 200)}`, records: [] };
  }
}

export const manualDnsDomains: DomainProvider = {
  id: "manual_dns",
  async register() {
    return { ok: true, message: "Apontamento manual: cadastre o domínio também no projeto da hospedagem (painel) para a emissão do certificado HTTPS." };
  },
  check: dnsCheck,
};

/** API da hospedagem (Vercel): cadastra o domínio no projeto e consulta a verificação. Token pela variável DOMINIOS_*. */
export function hostingApiDomains(integ: Doc): DomainProvider {
  const token = () => (integ.secretRefs?.token ? process.env[integ.secretRefs.token] ?? "" : "");
  const projectId = String(integ.config?.projectId ?? "").trim();
  const teamId = String(integ.config?.teamId ?? "").trim();
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const call = async (method: string, path: string, body?: unknown) => {
    const t = token();
    if (!t || !projectId) throw new BusinessError("Integração de domínios sem token ou sem projeto configurado.", "domains_not_configured");
    const res = await fetch(`https://api.vercel.com${path}${qs}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, any>;
    return { ok: res.ok, status: res.status, json };
  };
  return {
    id: "hosting_api",
    async register(domain) {
      const r = await call("POST", `/v10/projects/${encodeURIComponent(projectId)}/domains`, { name: domain });
      if (r.ok || r.status === 409) return { ok: true, message: "Domínio cadastrado no projeto da hospedagem." };
      return { ok: false, message: `A hospedagem recusou o cadastro (HTTP ${r.status}): ${String(r.json?.error?.message ?? "sem detalhes").slice(0, 200)}` };
    },
    async check(domain, verifyToken) {
      const base = await dnsCheck(domain, verifyToken);
      try {
        const r = await call("GET", `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`);
        if (!r.ok) return { ...base, status: base.status === "active" ? "misconfigured" : base.status, diagnostic: `Domínio não cadastrado no projeto da hospedagem (HTTP ${r.status}). ${base.diagnostic}` };
        if (r.json?.verified === false && base.status === "active") return { ...base, status: "pending_dns", diagnostic: "A hospedagem ainda aguarda a verificação do domínio (registro indicado no painel da hospedagem)." };
        return base;
      } catch (e: any) {
        return { ...base, diagnostic: `${base.diagnostic} (consulta à hospedagem indisponível: ${String(e?.message ?? e).slice(0, 120)})` };
      }
    },
  };
}

export async function domainsFor(store: Store, companyId: string): Promise<DomainProvider> {
  const integ = await storeIntegration(store, companyId, "store_domains");
  if (integ?.provider === "hosting_api") return hostingApiDomains(integ);
  return manualDnsDomains;
}

// ───────────────────────────── Teste na Central de integrações

export async function testStoreIntegration(ctx: Ctx, kind: IntegrationKind, integ: Doc): Promise<TestOutcome> {
  const simulated = integ.provider === "simulated";
  if (kind === "store_gateway") {
    if (simulated) {
      const ch = await simulatedGateway.createCharge({ orderId: `test-${nowIso()}`, orderCode: "TESTE", amount: 100, method: "pix", installments: 1, customer: { name: "Teste", email: "", doc: "" }, pixExpiresMinutes: 5, boletoDueDays: 1 });
      return { status: "simulated", ok: true, message: `Simulação respondendo (cobrança de teste ${ch.providerRef}, sem valor financeiro).` };
    }
    return { status: "unavailable", ok: false, message: "Gateway Intercert: conector reservado nesta versão. Credenciais vinculadas; a chamada à API e a homologação entram na integração. Os avisos já são conferidos por assinatura." };
  }
  if (kind === "store_bank") {
    if (simulated) return { status: "simulated", ok: true, message: "Simulação respondendo: créditos pelo prazo de cada meio e repasses em rascunho." };
    return { status: "unavailable", ok: false, message: "Banco Intercert: conector reservado nesta versão (extrato, crédito e transferência entram na integração)." };
  }
  if (kind === "store_logistics") {
    if (simulated) {
      const q = await simulatedLogistics.quote({ originZip: "01001000", destZip: "01310100", pkg: { weightGrams: 800, heightCm: 18, widthCm: 24, lengthCm: 30, value: 10000 }, modes: ["carrier", "third_party"], thirdPartyLabel: "" });
      return { status: "simulated", ok: true, message: `Simulação respondendo: ${q.length} cotação(ões) de referência (sem transportadora real).` };
    }
    return { status: "unavailable", ok: false, message: "Plataforma de fretes: conector reservado nesta versão (cotação, etiqueta e rastreio entram na integração)." };
  }
  if (kind === "store_domains") {
    if (integ.provider === "hosting_api") {
      const t = integ.secretRefs?.token ? process.env[integ.secretRefs.token] : "";
      if (!t || !integ.config?.projectId) return { status: "error", ok: false, message: "Informe o projeto (ID) e vincule a variável do token da hospedagem." };
      try {
        const qs = integ.config?.teamId ? `?teamId=${encodeURIComponent(integ.config.teamId)}` : "";
        const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(integ.config.projectId)}${qs}`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(10000) });
        return res.ok ? { status: "operational", ok: true, message: "Projeto encontrado na hospedagem: o cadastro automático de domínios está pronto." } : { status: "error", ok: false, message: `A hospedagem respondeu HTTP ${res.status} ao consultar o projeto.` };
      } catch (e: any) {
        return { status: "error", ok: false, message: `Hospedagem inacessível: ${String(e?.message ?? e).slice(0, 200)}` };
      }
    }
    return { status: "configured_untested", ok: true, message: "Apontamento manual: cada domínio é conferido pelo DNS na tela do editor da loja (sem credencial)." };
  }
  void ctx;
  return { status: "configured_untested", ok: true, message: "Sem teste disponível para este tipo." };
}
