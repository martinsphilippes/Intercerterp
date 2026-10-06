import crypto from "node:crypto";
import { detId, isConflict } from "@/lib/db";
import type { Store } from "@/lib/db/types";

/**
 * Contrato fiscal independente de fornecedor. A referência (`ref`) é única por documento e
 * permite consultar/reenviar sem duplicar emissão. Estados normalizados:
 *  processing | authorized | rejected | denied | cancelled | error | unused
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
  /** NFC-e emitida em contingência offline pelo provedor, ainda não efetivada na SEFAZ */
  contingency?: boolean;
  httpStatus?: number;
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
  test(cnpj?: string): Promise<{ ok: boolean; message: string; httpStatus?: number }>;
}

export function mapFocusStatus(status: string | undefined): ProviderDocStatus {
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

/**
 * Focus NFe (API v2): NF-e, NFC-e, NFS-e municipal (/v2/nfse) e nacional (/v2/nfsen).
 * O endereço base pode ser sobrescrito por FOCUSNFE_BASE_URL (servidor) — usado nos testes
 * de contrato com servidor HTTP falso; nunca configurável pela tela (evita desviar o token).
 */
export class FocusNfeProvider implements FiscalProvider {
  readonly id = "focusnfe";
  readonly simulated = false;
  readonly baseUrl: string;
  constructor(
    private readonly token: string,
    environment: "homologacao" | "producao",
    baseUrlOverride?: string,
  ) {
    this.baseUrl = (baseUrlOverride || (environment === "producao" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br")).replace(/\/$/, "");
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
      json = { mensagem: text.slice(0, 500) };
    }
    return { httpStatus: res.status, json };
  }

  private path(model: FiscalModel, nfseStandard?: string) {
    if (model === "nfse") return nfseStandard === "nacional" ? "/v2/nfsen" : "/v2/nfse";
    return `/v2/${model}`;
  }

  /** Normaliza a resposta HTTP/JSON da Focus para o contrato interno (sem estados presumidos). */
  toResult(json: any, httpStatus: number): ProviderResult {
    if (httpStatus === 401 || httpStatus === 403)
      return { status: "error", statusCode: String(json?.codigo ?? httpStatus), message: `Credencial recusada pelo provedor (HTTP ${httpStatus}): ${json?.mensagem ?? "token inválido ou sem permissão"}`, httpStatus, raw: json };
    if (httpStatus === 429) return { status: "error", statusCode: "429", message: "Limite de requisições do provedor atingido (HTTP 429). Nova tentativa automática.", httpStatus, raw: json };
    if (httpStatus >= 500) return { status: "error", statusCode: String(httpStatus), message: `Provedor indisponível (HTTP ${httpStatus})`, httpStatus, raw: json };
    if (json?.codigo && !json?.status) {
      // erros de validação da API (ex.: requisicao_invalida) ou referência inexistente
      if (httpStatus === 404) return { status: "error", statusCode: json.codigo, message: json.mensagem ?? "Referência não encontrada no provedor.", httpStatus, raw: json };
      const detail = Array.isArray(json.erros) ? json.erros.map((e: any) => [e.campo, e.mensagem].filter(Boolean).join(": ")).join("; ") : "";
      return { status: "rejected", statusCode: json.codigo, message: [json.mensagem, detail].filter(Boolean).join(" — "), httpStatus, raw: json };
    }
    const contingency = Boolean(json?.contingencia_offline) && !json?.contingencia_offline_efetivada;
    let status = mapFocusStatus(json?.status);
    if (contingency && status === "authorized") status = "processing";
    const erros = Array.isArray(json?.erros) ? json.erros.map((e: any) => e.mensagem).join("; ") : undefined;
    return {
      status,
      statusCode: String(json?.status_sefaz ?? json?.codigo_status ?? json?.codigo ?? ""),
      message: json?.mensagem_sefaz ?? json?.mensagem ?? erros ?? (contingency ? "Emitida em contingência offline pelo provedor — aguardando efetivação na SEFAZ." : undefined),
      accessKey: (json?.chave_nfe ?? json?.chave_nfce ?? undefined)?.replace?.(/^NFe/, ""),
      number: json?.numero ? Number(json.numero) : undefined,
      series: json?.serie ? String(json.serie) : undefined,
      protocol: json?.protocolo ?? json?.numero_protocolo ?? undefined,
      xmlPath: json?.caminho_xml_nota_fiscal ?? undefined,
      danfePath: json?.caminho_danfe ?? json?.url_danfse ?? json?.url ?? undefined,
      qrCodeUrl: json?.qrcode_url ?? json?.url_consulta_nf ?? undefined,
      verificationCode: json?.codigo_verificacao ?? undefined,
      contingency: contingency || undefined,
      httpStatus,
      raw: json,
    };
  }

  async send(model: FiscalModel, ref: string, payload: Record<string, any>, opts?: { nfseStandard?: string }) {
    const { httpStatus, json } = await this.call("POST", `${this.path(model, opts?.nfseStandard)}?ref=${encodeURIComponent(ref)}`, payload);
    // referência já processada/autorizada: consulta em vez de duplicar
    if (httpStatus === 422 && ["already_processed", "nfe_autorizada", "nfce_autorizada"].includes(json?.codigo)) return this.query(model, ref, opts);
    return this.toResult(json, httpStatus);
  }

  async query(model: FiscalModel, ref: string, opts?: { nfseStandard?: string }) {
    const { httpStatus, json } = await this.call("GET", `${this.path(model, opts?.nfseStandard)}/${encodeURIComponent(ref)}?completa=0`);
    return this.toResult(json, httpStatus);
  }

  async cancel(model: FiscalModel, ref: string, justification: string, opts?: { nfseStandard?: string }) {
    const { httpStatus, json } = await this.call("DELETE", `${this.path(model, opts?.nfseStandard)}/${encodeURIComponent(ref)}`, { justificativa: justification });
    const r = this.toResult(json, httpStatus);
    if (json?.status === "erro_cancelamento") return { ...r, status: "error" as const, message: json?.mensagem_sefaz ?? json?.mensagem ?? "Cancelamento não homologado" };
    return r;
  }

  async correction(ref: string, text: string) {
    const { httpStatus, json } = await this.call("POST", `/v2/nfe/${encodeURIComponent(ref)}/carta_correcao`, { correcao: text });
    const base = this.toResult(json, httpStatus);
    if (base.status === "error") return base;
    const ok = json?.status === "autorizado";
    return { ...base, status: ok ? ("authorized" as const) : ("rejected" as const), sequence: json?.numero_carta_correcao, xmlPath: json?.caminho_xml_carta_correcao, danfePath: json?.caminho_pdf_carta_correcao };
  }

  async disable(input: { cnpj: string; series: string; from: number; to: number; justification: string; model: "nfe" | "nfce" }) {
    const { httpStatus, json } = await this.call("POST", `/v2/${input.model}/inutilizacao`, { cnpj: input.cnpj, serie: input.series, numero_inicial: input.from, numero_final: input.to, justificativa: input.justification });
    const base = this.toResult(json, httpStatus);
    if (base.status === "error") return base;
    return { ...base, status: json?.status === "autorizado" ? ("unused" as const) : ("rejected" as const) };
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
    // Consulta de empresa exige token de revenda; consultamos uma referência inexistente:
    // 404 com JSON válido comprova autenticação; 401/403 indica credencial inválida.
    const { httpStatus, json } = await this.call("GET", `/v2/nfe/teste-conexao-${cnpj || "intercert"}-${Date.now()}`);
    if (httpStatus === 401 || httpStatus === 403) return { ok: false, httpStatus, message: `Credencial recusada pelo provedor (HTTP ${httpStatus}). Verifique o token na variável de ambiente.` };
    if (httpStatus === 404 || httpStatus === 200) return { ok: true, httpStatus, message: `Autenticação aceita pela Focus NFe (${this.baseUrl}, HTTP ${httpStatus}).` };
    return { ok: false, httpStatus, message: `Resposta inesperada do provedor (HTTP ${httpStatus}): ${json?.mensagem ?? ""}` };
  }
}

// ───────────────────────────── Simulação

type SimState = ProviderResult & { model: FiscalModel; cceSeq?: number };

/** Valida capítulo do NCM (01–97 existem na TIPI) — base para demonstrar rejeição 778. */
export function ncmLooksValid(ncm: string) {
  if (!/^\d{8}$/.test(ncm)) return false;
  const ch = Number(ncm.slice(0, 2));
  return ch >= 1 && ch <= 97;
}

/**
 * SIMULAÇÃO fiscal — documentos sem validade jurídica, marcados como simulados em todo o sistema.
 * Aplica validações básicas (NCM, CFOP, destinatário, item de serviço) para demonstrar rejeição e correção.
 * O "estado remoto" do simulador fica em `fiscal_sim_state` (sobrevive a reinícios e processos distintos).
 * Fluxos: NF-e e NFS-e → processando (lote/RPS) → consulta → autorizado; NFC-e → autorizada na resposta.
 */
export class SimulatedFiscalProvider implements FiscalProvider {
  readonly id = "simulated";
  readonly simulated = true;
  private mem = new Map<string, SimState>();
  constructor(
    private readonly store?: Store,
    private readonly opts: { outage?: boolean } = {},
  ) {}

  private async load(ref: string): Promise<SimState | null> {
    if (!this.store) return this.mem.get(ref) ?? null;
    const d = await this.store.get("fiscal_sim_state", detId("fiscalsim", ref));
    return (d?.data as SimState) ?? null;
  }

  private async save(ref: string, state: SimState) {
    if (!this.store) {
      this.mem.set(ref, state);
      return;
    }
    const id = detId("fiscalsim", ref);
    const data = { ref, model: state.model, status: state.status, data: state };
    if (await this.store.get("fiscal_sim_state", id)) await this.store.update("fiscal_sim_state", id, data);
    else {
      try {
        await this.store.create("fiscal_sim_state", data, id);
      } catch (e) {
        if (!isConflict(e)) throw e;
        await this.store.update("fiscal_sim_state", id, data);
      }
    }
  }

  private outage(): ProviderResult | null {
    return this.opts.outage ? { status: "error", statusCode: "SIM-503", message: "SIMULAÇÃO: provedor/SEFAZ indisponível (indisponibilidade simulada na configuração fiscal)." } : null;
  }

  private validate(model: FiscalModel, p: Record<string, any>): string | null {
    if (model === "nfse") {
      if (!p.servico?.item_lista_servico) return "E31 (simulada): Item da lista de serviços não informado.";
      if (!p.servico?.valor_servicos || p.servico.valor_servicos <= 0) return "E40 (simulada): Valor dos serviços inválido.";
      const t = p.tomador ?? {};
      if (t.cnpj && String(t.cnpj).length !== 14) return "E46 (simulada): CNPJ do tomador inválido.";
      if (t.cpf && String(t.cpf).length !== 11) return "E46 (simulada): CPF do tomador inválido.";
      return null;
    }
    for (const it of p.items ?? []) {
      if (!ncmLooksValid(String(it.codigo_ncm ?? ""))) return `Rejeição 778 (simulada): Informado NCM inexistente no item ${it.numero_item} (${it.codigo_ncm || "vazio"}).`;
      if (!/^[123567]\d{3}$/.test(String(it.cfop ?? ""))) return `Rejeição 321 (simulada): CFOP inválido no item ${it.numero_item}.`;
      // PISAliq/COFINSAliq (CST 01/02) exigem vBC, pPIS/pCOFINS e valor — como na SEFAZ
      for (const pre of ["pis", "cofins"] as const) {
        const cst = String(it[`${pre}_situacao_tributaria`] ?? "");
        if (["01", "02"].includes(cst) && (it[`${pre}_base_calculo`] == null || it[`${pre}_aliquota_porcentual`] == null || it[`${pre}_valor`] == null))
          return `Rejeição 225 (simulada): ${pre.toUpperCase()} CST ${cst} sem base de cálculo/alíquota/valor no item ${it.numero_item}.`;
      }
    }
    if (model === "nfe" && !p.cpf_destinatario && !p.cnpj_destinatario) return "Rejeição 237 (simulada): destinatário sem CPF/CNPJ.";
    return null;
  }

  async send(model: FiscalModel, ref: string, payload: Record<string, any>): Promise<ProviderResult> {
    const prev = await this.load(ref);
    if (prev && ["authorized", "processing", "cancelled"].includes(prev.status)) return prev;
    const down = this.outage();
    if (down) return down;
    const err = this.validate(model, payload);
    if (err) {
      const code = err.match(/^(?:Rejeição|E)\s?(\d+)/)?.[1] ?? "999";
      const r: SimState = { model, status: "rejected", statusCode: code, message: err };
      await this.save(ref, r);
      return r;
    }
    const n = Number(payload.numero ?? 0) || undefined;
    const cnpj = String(payload.cnpj_emitente ?? payload.prestador?.cnpj ?? "00000000000000").padStart(14, "0");
    const serie = String(payload.serie ?? "1");
    const key = model === "nfse" ? undefined : simulatedAccessKey(model, cnpj, serie, n ?? 0, ref);
    const sync = model === "nfce";
    const r: SimState = {
      model,
      status: sync ? "authorized" : "processing",
      statusCode: sync ? "100" : "105",
      message: sync ? "SIMULAÇÃO: autorizado o uso — documento sem validade fiscal" : model === "nfse" ? "SIMULAÇÃO: RPS recebido em lote — em processamento" : "SIMULAÇÃO: lote em processamento",
      accessKey: key,
      number: model === "nfse" ? undefined : n,
      series: serie,
      protocol: sync ? simProtocol() : undefined,
      qrCodeUrl: model === "nfce" ? `https://nfce.simulacao.invalid/qrcode?p=${key}|2|2|1|${crypto.createHash("sha1").update(ref).digest("hex").slice(0, 40).toUpperCase()}` : undefined,
    };
    await this.save(ref, r);
    return r;
  }

  async query(model: FiscalModel, ref: string): Promise<ProviderResult> {
    const r = await this.load(ref);
    if (!r) return { status: "error", statusCode: "404", message: "SIMULAÇÃO: referência não encontrada no provedor simulado." };
    const down = this.outage();
    if (down) return down;
    if (r.status === "processing") {
      r.status = "authorized";
      r.statusCode = "100";
      r.protocol = simProtocol();
      r.message = "SIMULAÇÃO: autorizado — documento sem validade fiscal";
      if (model === "nfse") {
        r.number = await simNfseNumber(this.store);
        r.verificationCode = crypto.createHash("sha1").update(ref).digest("hex").slice(0, 8).toUpperCase();
      }
      await this.save(ref, r);
    }
    return r;
  }

  async cancel(_model: FiscalModel, ref: string, justification: string): Promise<ProviderResult> {
    const r = await this.load(ref);
    if (!r || r.status !== "authorized") return { status: "error", message: "SIMULAÇÃO: documento não está autorizado no provedor." };
    const down = this.outage();
    if (down) return down;
    if (justification.trim().length < 15) return { status: "error", message: "Justificativa deve ter ao menos 15 caracteres." };
    r.status = "cancelled";
    r.statusCode = "135";
    r.message = "SIMULAÇÃO: cancelamento homologado (sem validade fiscal)";
    await this.save(ref, r);
    return { ...r, protocol: simProtocol() };
  }

  async correction(ref: string, text: string) {
    const r = await this.load(ref);
    if (!r || r.status !== "authorized") return { status: "rejected" as const, message: "SIMULAÇÃO: NF-e não autorizada no provedor." };
    if (text.trim().length < 15) return { status: "rejected" as const, message: "Correção deve ter ao menos 15 caracteres." };
    r.cceSeq = (r.cceSeq ?? 0) + 1;
    await this.save(ref, r);
    return { status: "authorized" as const, statusCode: "135", message: `SIMULAÇÃO: CC-e nº ${r.cceSeq} registrada (sem validade fiscal)`, protocol: simProtocol(), sequence: r.cceSeq };
  }

  async disable() {
    const down = this.outage();
    if (down) return down;
    return { status: "unused" as const, statusCode: "102", message: "SIMULAÇÃO: inutilização de numeração homologada (sem validade fiscal)", protocol: simProtocol() };
  }

  fileUrl() {
    return "";
  }

  async download(): Promise<Buffer> {
    throw new Error("SIMULAÇÃO: arquivos são gerados localmente.");
  }

  async test() {
    if (this.opts.outage) return { ok: false, message: "SIMULAÇÃO: indisponibilidade simulada ativa na configuração fiscal." };
    return { ok: true, message: "Provedor de simulação ativo — sem conexão com SEFAZ/prefeitura; documentos sem validade fiscal." };
  }
}

function simProtocol() {
  return "SIM" + Date.now() + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
}

async function simNfseNumber(store?: Store) {
  if (!store) return Math.floor(Math.random() * 90000) + 1000;
  const { nextNumber } = await import("@/lib/core/numbering");
  return nextNumber(store, "sim-nfse-number");
}

/** Chave de acesso (44 dígitos) com estrutura da NF-e e DV módulo 11 — gerada para SIMULAÇÃO. */
export function simulatedAccessKey(model: FiscalModel, cnpj: string, series: string, number: number, ref: string) {
  const now = new Date();
  const aamm = String(now.getUTCFullYear()).slice(2) + String(now.getUTCMonth() + 1).padStart(2, "0");
  const mod = model === "nfce" ? "65" : "55";
  const code = String(parseInt(crypto.createHash("sha1").update(ref).digest("hex").slice(0, 8), 16) % 100000000).padStart(8, "0");
  const base = `35${aamm}${cnpj.slice(0, 14).padStart(14, "0")}${mod}${series.padStart(3, "0").slice(-3)}${String(number).padStart(9, "0").slice(-9)}9${code}`;
  let sum = 0;
  let w = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  const dv = r < 2 ? 0 : 11 - r;
  return base + dv;
}

const g = globalThis as unknown as { __simFiscal?: SimulatedFiscalProvider };

/**
 * Resolve o provedor configurado. Sem credencial (variável ausente) → null (estado "pendente de configuração").
 * Com `store`, o simulador persiste o estado remoto no banco.
 */
export function fiscalProviderFrom(config: Record<string, any> | null, store?: Store): FiscalProvider | null {
  if (!config?.provider) return null;
  if (config.provider === "simulated") {
    if (store || config.simulateOutage) return new SimulatedFiscalProvider(store, { outage: Boolean(config.simulateOutage) });
    g.__simFiscal ??= new SimulatedFiscalProvider();
    return g.__simFiscal;
  }
  if (config.provider === "focusnfe") {
    if (config.tokenRef === "") return null; // vínculo de credencial removido
    const token = process.env[config.tokenRef || "FOCUSNFE_TOKEN"];
    if (!token) return null;
    return new FocusNfeProvider(token, config.environment === "producao" ? "producao" : "homologacao", process.env.FOCUSNFE_BASE_URL || undefined);
  }
  return null;
}

/** Códigos tPag (NT 2020.006) */
export const TPAG: Record<string, string> = {
  cash: "01",
  check: "02",
  credit: "03",
  debit: "04",
  store_credit: "05",
  crediario: "05",
  voucher: "10",
  boleto: "15",
  deposit: "16",
  pix: "17",
  transfer: "18",
  none: "90",
  other: "99",
};

export const TPAG_LABEL: Record<string, string> = {
  cash: "Dinheiro",
  check: "Cheque",
  credit: "Cartão de crédito",
  debit: "Cartão de débito",
  store_credit: "Crédito loja / vale",
  crediario: "Crediário (crédito loja)",
  voucher: "Vale",
  boleto: "Boleto",
  deposit: "Depósito",
  pix: "Pix",
  transfer: "Transferência",
  none: "Sem pagamento",
  other: "Outros",
};
