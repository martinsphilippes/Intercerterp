import crypto from "node:crypto";

/**
 * Contrato fiscal independente de fornecedor. A referência (`ref`) é única por documento e
 * permite consultar/reenviar sem duplicar emissão. Estados normalizados:
 *  processing | authorized | rejected | denied | cancelled | error
 */

export type ProviderDocStatus = "processing" | "authorized" | "rejected" | "denied" | "cancelled" | "error" | "unused";

export interface ProviderResult {
  status: ProviderDocStatus;
  statusCode?: string;
  message?: string;
  accessKey?: string;
  number?: number;
  series?: string;
  protocol?: string;
  xmlPath?: string;
  danfePath?: string;
  qrCodeUrl?: string;
  verificationCode?: string;
  raw?: unknown;
}

export type FiscalModel = "nfe" | "nfce" | "nfse";

export interface FiscalProvider {
  readonly id: string;
  readonly simulated: boolean;
  send(model: FiscalModel, ref: string, payload: Record<string, any>, opts?: { nfseStandard?: string }): Promise<ProviderResult>;
  query(model: FiscalModel, ref: string, opts?: { nfseStandard?: string }): Promise<ProviderResult>;
  cancel(model: FiscalModel, ref: string, justification: string, opts?: { nfseStandard?: string }): Promise<ProviderResult>;
  correction(ref: string, text: string): Promise<ProviderResult & { sequence?: number }>;
  disable(input: { cnpj: string; series: string; from: number; to: number; justification: string; model: "nfe" | "nfce" }): Promise<ProviderResult>;
  download(path: string): Promise<Buffer>;
  fileUrl(path: string): string;
  test(cnpj?: string): Promise<{ ok: boolean; message: string }>;
}

function mapFocus(status: string | undefined): ProviderDocStatus {
  switch (status) {
    case "autorizado":
      return "authorized";
    case "cancelado":
      return "cancelled";
    case "erro_autorizacao":
      return "rejected";
    case "denegado":
      return "denied";
    case "processando_autorizacao":
      return "processing";
    case "inutilizado":
      return "unused";
    default:
      return "error";
  }
}

/** Focus NFe (API v2): NF-e, NFC-e, NFS-e municipal (/v2/nfse) e nacional (/v2/nfsen). */
export class FocusNfeProvider implements FiscalProvider {
  readonly id = "focusnfe";
  readonly simulated = false;
  readonly baseUrl: string;
  constructor(private readonly token: string, environment: "homologacao" | "producao") {
    this.baseUrl = environment === "producao" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br";
  }

  private auth() {
    return "Basic " + Buffer.from(`${this.token}:`).toString("base64");
  }

  private async call(method: string, path: string, body?: unknown) {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { Authorization: this.auth(), "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { mensagem: text };
    }
    return { httpStatus: res.status, json };
  }

  private path(model: FiscalModel, nfseStandard?: string) {
    if (model === "nfse") return nfseStandard === "nacional" ? "/v2/nfsen" : "/v2/nfse";
    return `/v2/${model}`;
  }

  private toResult(json: any, httpStatus: number): ProviderResult {
    if (httpStatus >= 500) return { status: "error", message: `Provedor indisponível (HTTP ${httpStatus})`, raw: json };
    if (json?.codigo && !json?.status) {
      // erros de validação da API (ex.: requisicao_invalida, nao_encontrado)
      return { status: httpStatus === 404 ? "error" : "rejected", statusCode: json.codigo, message: json.mensagem ?? JSON.stringify(json.erros ?? json), raw: json };
    }
    return {
      status: mapFocus(json?.status),
      statusCode: String(json?.status_sefaz ?? json?.codigo_status ?? ""),
      message: json?.mensagem_sefaz ?? json?.mensagem ?? json?.erros?.map((e: any) => e.mensagem).join("; "),
      accessKey: json?.chave_nfe ?? json?.chave_nfce ?? undefined,
      number: json?.numero ? Number(json.numero) : undefined,
      series: json?.serie ? String(json.serie) : undefined,
      protocol: json?.protocolo ?? json?.numero_protocolo ?? undefined,
      xmlPath: json?.caminho_xml_nota_fiscal ?? undefined,
      danfePath: json?.caminho_danfe ?? json?.url_danfse ?? json?.url ?? undefined,
      qrCodeUrl: json?.qrcode_url ?? json?.url_consulta_nf ?? undefined,
      verificationCode: json?.codigo_verificacao ?? undefined,
      raw: json,
    };
  }

  async send(model: FiscalModel, ref: string, payload: Record<string, any>, opts?: { nfseStandard?: string }) {
    const { httpStatus, json } = await this.call("POST", `${this.path(model, opts?.nfseStandard)}?ref=${encodeURIComponent(ref)}`, payload);
    if (httpStatus === 422 && json?.codigo === "already_processed") return this.query(model, ref, opts);
    return this.toResult(json, httpStatus);
  }

  async query(model: FiscalModel, ref: string, opts?: { nfseStandard?: string }) {
    const { httpStatus, json } = await this.call("GET", `${this.path(model, opts?.nfseStandard)}/${encodeURIComponent(ref)}?completa=0`);
    return this.toResult(json, httpStatus);
  }

  async cancel(model: FiscalModel, ref: string, justification: string, opts?: { nfseStandard?: string }) {
    const { httpStatus, json } = await this.call("DELETE", `${this.path(model, opts?.nfseStandard)}/${encodeURIComponent(ref)}`, { justificativa: justification });
    const r = this.toResult(json, httpStatus);
    if (json?.status === "erro_cancelamento") return { ...r, status: "error" as const, message: json?.mensagem_sefaz ?? "Cancelamento não homologado" };
    return r;
  }

  async correction(ref: string, text: string) {
    const { httpStatus, json } = await this.call("POST", `/v2/nfe/${encodeURIComponent(ref)}/carta_correcao`, { correcao: text });
    const ok = json?.status === "autorizado";
    return { ...this.toResult(json, httpStatus), status: ok ? ("authorized" as const) : ("rejected" as const), sequence: json?.numero_carta_correcao, xmlPath: json?.caminho_xml_carta_correcao, danfePath: json?.caminho_pdf_carta_correcao };
  }

  async disable(input: { cnpj: string; series: string; from: number; to: number; justification: string; model: "nfe" | "nfce" }) {
    const { httpStatus, json } = await this.call("POST", `/v2/${input.model}/inutilizacao`, { cnpj: input.cnpj, serie: input.series, numero_inicial: input.from, numero_final: input.to, justificativa: input.justification });
    return { ...this.toResult(json, httpStatus), status: json?.status === "autorizado" ? ("unused" as const) : ("rejected" as const) };
  }

  fileUrl(path: string) {
    return path.startsWith("http") ? path : this.baseUrl + path;
  }

  async download(path: string) {
    const res = await fetch(this.fileUrl(path), { headers: { Authorization: this.auth() }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Falha ao baixar arquivo fiscal (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async test(cnpj?: string) {
    // Consulta de empresa/emitente exige token de revenda; usamos uma consulta de referência inexistente:
    // 404 com JSON válido comprova autenticação; 401/403 indica credencial inválida.
    const { httpStatus, json } = await this.call("GET", `/v2/nfe/teste-conexao-${cnpj ?? "intercert"}-${Date.now()}`);
    if (httpStatus === 401 || httpStatus === 403) return { ok: false, message: `Credencial recusada pelo provedor (HTTP ${httpStatus}).` };
    if (httpStatus === 404 || httpStatus === 200) return { ok: true, message: `Autenticação aceita pela Focus NFe (${this.baseUrl}).` };
    return { ok: false, message: `Resposta inesperada (HTTP ${httpStatus}): ${json?.mensagem ?? ""}` };
  }
}

/**
 * SIMULAÇÃO fiscal — documentos sem validade jurídica, marcados como simulados em todo o sistema.
 * Aplica validações básicas (NCM, CFOP, destinatário) para demonstrar rejeição e correção.
 */
const simStore = new Map<string, ProviderResult & { model: FiscalModel }>();

export class SimulatedFiscalProvider implements FiscalProvider {
  readonly id = "simulated";
  readonly simulated = true;

  private validate(model: FiscalModel, p: Record<string, any>): string | null {
    if (model === "nfse") {
      if (!p.servico?.item_lista_servico) return "Item da lista de serviços não informado.";
      if (!p.servico?.valor_servicos || p.servico.valor_servicos <= 0) return "Valor dos serviços inválido.";
      return null;
    }
    for (const it of p.items ?? []) {
      if (!/^\d{8}$/.test(String(it.codigo_ncm ?? ""))) return `Rejeição 778 (simulada): NCM inválido no item ${it.numero_item}.`;
      if (!/^\d{4}$/.test(String(it.cfop ?? ""))) return `Rejeição (simulada): CFOP inválido no item ${it.numero_item}.`;
    }
    if (model === "nfe" && !p.cpf_destinatario && !p.cnpj_destinatario) return "Rejeição (simulada): destinatário sem CPF/CNPJ.";
    return null;
  }

  async send(model: FiscalModel, ref: string, payload: Record<string, any>) {
    const prev = simStore.get(ref);
    if (prev && prev.status === "authorized") return prev;
    const err = this.validate(model, payload);
    if (err) {
      const r = { model, status: "rejected" as const, statusCode: "999", message: err };
      simStore.set(ref, r);
      return r;
    }
    const n = Number(payload.numero ?? Math.floor(Math.random() * 90000) + 1000);
    const key = model === "nfse" ? undefined : ("35" + crypto.createHash("sha1").update(ref).digest("hex").replace(/\D/g, "").padEnd(42, "0")).slice(0, 44);
    const r: ProviderResult & { model: FiscalModel } = {
      model,
      status: model === "nfe" ? "processing" : "authorized",
      statusCode: model === "nfe" ? "105" : "100",
      message: model === "nfe" ? "SIMULAÇÃO: lote em processamento" : "SIMULAÇÃO: autorizado — documento sem validade fiscal",
      accessKey: key,
      number: n,
      series: String(payload.serie ?? "1"),
      protocol: model === "nfe" ? undefined : "SIM" + Date.now(),
      verificationCode: model === "nfse" ? crypto.randomBytes(4).toString("hex").toUpperCase() : undefined,
    };
    simStore.set(ref, r);
    return r;
  }

  async query(model: FiscalModel, ref: string) {
    const r = simStore.get(ref);
    if (!r) return { status: "error" as const, message: "SIMULAÇÃO: referência não encontrada (servidor reiniciado?)" };
    if (r.status === "processing") {
      r.status = "authorized";
      r.statusCode = "100";
      r.protocol = "SIM" + Date.now();
      r.message = "SIMULAÇÃO: autorizado — documento sem validade fiscal";
    }
    return r;
  }

  async cancel(_model: FiscalModel, ref: string, justification: string) {
    const r = simStore.get(ref);
    if (!r || r.status !== "authorized") return { status: "error" as const, message: "SIMULAÇÃO: documento não autorizado." };
    if (justification.trim().length < 15) return { status: "error" as const, message: "Justificativa deve ter ao menos 15 caracteres." };
    r.status = "cancelled";
    r.message = "SIMULAÇÃO: cancelamento homologado (sem validade fiscal)";
    return r;
  }

  async correction(ref: string, text: string) {
    const r = simStore.get(ref);
    if (!r || r.status !== "authorized") return { status: "rejected" as const, message: "SIMULAÇÃO: NF-e não autorizada." };
    if (text.trim().length < 15) return { status: "rejected" as const, message: "Correção deve ter ao menos 15 caracteres." };
    return { status: "authorized" as const, message: "SIMULAÇÃO: CC-e registrada", protocol: "SIMCCE" + Date.now() };
  }

  async disable() {
    return { status: "unused" as const, message: "SIMULAÇÃO: inutilização registrada (sem validade fiscal)", protocol: "SIMINU" + Date.now() };
  }

  fileUrl() {
    return "";
  }

  async download(): Promise<Buffer> {
    throw new Error("SIMULAÇÃO: arquivos são gerados localmente.");
  }

  async test() {
    return { ok: true, message: "Provedor de simulação ativo — sem conexão com SEFAZ/prefeitura; documentos sem validade fiscal." };
  }
}

const g = globalThis as unknown as { __simFiscal?: SimulatedFiscalProvider };

export function fiscalProviderFrom(config: Record<string, any> | null): FiscalProvider | null {
  if (!config?.provider) return null;
  if (config.provider === "simulated") {
    g.__simFiscal ??= new SimulatedFiscalProvider();
    return g.__simFiscal;
  }
  if (config.provider === "focusnfe") {
    const token = process.env[config.tokenRef || "FOCUSNFE_TOKEN"];
    if (!token) return null;
    return new FocusNfeProvider(token, config.environment === "producao" ? "producao" : "homologacao");
  }
  return null;
}

/** Códigos tPag (NT 2020.006) */
export const TPAG: Record<string, string> = {
  cash: "01",
  credit: "03",
  debit: "04",
  store_credit: "05",
  voucher: "10",
  boleto: "15",
  pix: "17",
  crediario: "05",
  other: "99",
};
