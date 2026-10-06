import crypto from "node:crypto";

/**
 * Contrato independente de fornecedor para cobranças Pix (e base para cartões integrados).
 * A referência (`reference`) é única e enviada como chave de idempotência ao provedor:
 * repetir a criação com a mesma referência nunca cria cobrança duplicada.
 */

export type IntentStatus = "pending" | "confirmed" | "failed" | "expired" | "cancelled" | "refunded" | "unknown";

export interface ProviderCharge {
  providerId: string;
  status: IntentStatus;
  qrCode?: string;
  qrCodeImage?: string;
  expiresAt?: string;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly id: string;
  readonly label: string;
  readonly simulated: boolean;
  createPix(input: { reference: string; amount: number; description: string; payerEmail?: string; expiresMinutes?: number }): Promise<ProviderCharge>;
  findByReference(reference: string): Promise<ProviderCharge | null>;
  /**
   * Estorno de cobrança paga. `status` é o retorno real do provedor ("approved"/"refunded" = estornado;
   * "simulated_refund" = simulação; outro valor = ainda não confirmado).
   */
  refund(providerId: string, amount?: number): Promise<{ status: string; raw?: unknown }>;
  /** Cancela uma cobrança ainda não paga. Devolve o estado informado pelo provedor após o pedido. */
  cancel(providerId: string): Promise<ProviderCharge>;
  test(): Promise<{ ok: boolean; message: string }>;
}

/** Estados de estorno que o provedor devolve quando o dinheiro já voltou ao pagador. */
export const REFUND_DONE_STATUSES = ["approved", "refunded", "simulated_refund"];

function mapMpStatus(s: string): IntentStatus {
  switch (s) {
    case "approved":
    case "authorized":
      return "confirmed";
    case "pending":
    case "in_process":
      return "pending";
    case "rejected":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "refunded":
    case "charged_back":
      return "refunded";
    default:
      return "unknown";
  }
}

/** Mercado Pago — API de Pagamentos (Pix). Credencial via variável de ambiente referenciada. */
export class MercadoPagoProvider implements PaymentProvider {
  readonly id = "mercadopago";
  readonly label = "Mercado Pago (Pix)";
  readonly simulated = false;
  constructor(private readonly accessToken: string, private readonly baseUrl = "https://api.mercadopago.com") {}

  private async call(path: string, init: RequestInit & { idem?: string } = {}) {
    const res = await fetch(this.baseUrl + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...(init.idem ? { "X-Idempotency-Key": init.idem } : {}),
      },
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${body?.message ?? text}`);
    return body;
  }

  private toCharge(p: any): ProviderCharge {
    return {
      providerId: String(p.id),
      status: mapMpStatus(p.status),
      qrCode: p.point_of_interaction?.transaction_data?.qr_code,
      qrCodeImage: p.point_of_interaction?.transaction_data?.qr_code_base64,
      expiresAt: p.date_of_expiration,
      raw: { id: p.id, status: p.status, status_detail: p.status_detail, external_reference: p.external_reference },
    };
  }

  async createPix(input: { reference: string; amount: number; description: string; payerEmail?: string; expiresMinutes?: number }) {
    const exp = new Date(Date.now() + (input.expiresMinutes ?? 30) * 60000).toISOString().replace("Z", "-00:00");
    const p = await this.call("/v1/payments", {
      method: "POST",
      idem: input.reference,
      body: JSON.stringify({
        transaction_amount: input.amount / 100,
        description: input.description.slice(0, 200),
        payment_method_id: "pix",
        external_reference: input.reference,
        date_of_expiration: exp,
        payer: { email: input.payerEmail || "comprador@example.com" },
      }),
    });
    return this.toCharge(p);
  }

  async findByReference(reference: string) {
    const r = await this.call(`/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc`);
    const p = r?.results?.[0];
    return p ? this.toCharge(p) : null;
  }

  async refund(providerId: string, amount?: number) {
    const r = await this.call(`/v1/payments/${providerId}/refunds`, { method: "POST", idem: `refund-${providerId}-${amount ?? "total"}`, body: JSON.stringify(amount ? { amount: amount / 100 } : {}) });
    return { status: r?.status ?? "unknown", raw: r };
  }

  async cancel(providerId: string) {
    const p = await this.call(`/v1/payments/${encodeURIComponent(providerId)}`, { method: "PUT", idem: `cancel-${providerId}`, body: JSON.stringify({ status: "cancelled" }) });
    return this.toCharge(p);
  }

  async test() {
    try {
      await this.call("/v1/payment_methods");
      return { ok: true, message: "Credencial aceita pelo Mercado Pago (consulta de meios de pagamento)." };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  }
}

/**
 * Provedor de SIMULAÇÃO — identificado em todas as telas. Não movimenta dinheiro.
 * Serve para demonstração e testes do contrato; confirmações são manuais e rotuladas.
 */
const simulated = new Map<string, ProviderCharge & { reference: string }>();

export class SimulatedPixProvider implements PaymentProvider {
  readonly id = "simulated";
  readonly label = "Simulação (sem valor financeiro)";
  readonly simulated = true;

  async createPix(input: { reference: string; amount: number; description: string; expiresMinutes?: number }) {
    const existing = simulated.get(input.reference);
    if (existing) return existing;
    const charge = {
      reference: input.reference,
      providerId: "SIM-" + crypto.createHash("sha1").update(input.reference).digest("hex").slice(0, 12).toUpperCase(),
      status: "pending" as IntentStatus,
      qrCode: `SIMULACAO-PIX|${input.reference}|${(input.amount / 100).toFixed(2)}|SEM-VALIDADE`,
      expiresAt: new Date(Date.now() + (input.expiresMinutes ?? 30) * 60000).toISOString(),
      raw: { simulated: true },
    };
    simulated.set(input.reference, charge);
    return charge;
  }

  async findByReference(reference: string) {
    return simulated.get(reference) ?? null;
  }

  /** usado apenas pela ação explícita "Simular confirmação" */
  setStatus(reference: string, status: IntentStatus) {
    const c = simulated.get(reference);
    if (c) c.status = status;
  }

  async refund(providerId: string) {
    for (const c of simulated.values()) if (c.providerId === providerId && c.status === "confirmed") c.status = "refunded";
    return { status: "simulated_refund" };
  }

  async cancel(providerId: string) {
    const c = [...simulated.values()].find((x) => x.providerId === providerId);
    if (!c) throw new Error(`Cobrança de simulação ${providerId} não encontrada no provedor.`);
    // pago não pode ser cancelado: o provedor devolve o estado atual (confirmado)
    if (c.status === "pending" || c.status === "unknown") c.status = "cancelled";
    return c;
  }

  async test() {
    return { ok: true, message: "Provedor de simulação ativo — não há conexão real com instituição de pagamento." };
  }
}

const g = globalThis as unknown as { __simPix?: SimulatedPixProvider };
export function simulatedPix() {
  g.__simPix ??= new SimulatedPixProvider();
  return g.__simPix;
}

/** Resolve o provedor configurado a partir do registro de integração. */
export function pixProviderFrom(integration: Record<string, any> | null): PaymentProvider | null {
  if (!integration?.provider) return null;
  if (integration.provider === "mercadopago") {
    const ref = integration.secretRefs?.accessToken ?? "MERCADOPAGO_ACCESS_TOKEN";
    const token = process.env[ref];
    if (!token) return null;
    return new MercadoPagoProvider(token, integration.config?.baseUrl);
  }
  if (integration.provider === "simulated") return simulatedPix();
  return null;
}
