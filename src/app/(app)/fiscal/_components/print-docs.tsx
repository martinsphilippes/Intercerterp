import QRCode from "qrcode";
import type { Doc } from "@/lib/db/types";
import { formatBps, formatMoney, formatQty } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { TPAG_LABEL } from "@/domain/fiscal/providers";
import { FREIGHT_MODE_LABEL, type DocItem } from "@/domain/fiscal/service";
import { formatKey } from "../labels";
import { Barcode128 } from "./barcode";

const TZ = process.env.APP_TIMEZONE || "America/Sao_Paulo";
const dt = (v?: string | null) => (v ? new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "medium" }).format(new Date(v)) : "—");

/** Tarja exibida no documento auxiliar conforme a situação real (nunca imprime como válido o que não é). */
export function printStamp(doc: Doc): string | null {
  if (doc.isSimulated) return "SIMULAÇÃO — SEM VALOR FISCAL";
  if (doc.status === "cancelled") return "DOCUMENTO CANCELADO";
  if (doc.status === "authorized") return null;
  if (doc.model === "nfce" && ["queued", "error", "processing"].includes(doc.status)) return "EMITIDA SEM AUTORIZAÇÃO — PENDENTE DE TRANSMISSÃO — SEM VALOR FISCAL";
  return "PRÉVIA — SEM VALOR FISCAL";
}

function Stamp({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
      <span className="rotate-[-24deg] whitespace-nowrap border-4 border-red-600/60 px-4 py-1 text-3xl font-black uppercase tracking-wider text-red-600/50">{text}</span>
    </div>
  );
}

const box = "border border-black px-1.5 py-0.5";
const lbl = "block text-[8px] uppercase leading-tight text-slate-700";

function addr(a: any) {
  if (!a) return "—";
  return [a.street, a.number, a.complement, a.district].filter(Boolean).join(", ");
}

export function Danfe({ doc, company, branch }: { doc: Doc; company: Doc; branch: Doc | null }) {
  const t = doc.totals ?? {};
  const items = (doc.items ?? []) as DocItem[];
  const r = doc.recipient ?? {};
  const stamp = printStamp(doc);
  const ba = branch?.address ?? company.address ?? {};
  return (
    <div className="danfe relative mx-auto w-[200mm] bg-white p-[4mm] text-[10px] leading-tight text-black">
      <Stamp text={stamp} />
      <div className="grid grid-cols-[1fr_auto]">
        <div className={box}>
          <span className={lbl}>Recebemos de {company.name} os produtos constantes da nota fiscal indicada ao lado</span>
          <div className="mt-3 grid grid-cols-[120px_1fr] gap-2 text-[8px]">
            <span>Data de recebimento: ____/____/______</span>
            <span>Identificação e assinatura do recebedor: ____________________________________</span>
          </div>
        </div>
        <div className={`${box} w-[40mm] text-center`}>
          <b className="text-sm">NF-e</b>
          <div>Nº {String(doc.number ?? "—").padStart(9, "0")}</div>
          <div>Série {doc.series ?? "—"}</div>
        </div>
      </div>
      <div className="mt-1 grid grid-cols-[1fr_44mm_1fr]">
        <div className={box}>
          <b className="text-[12px]">{company.name}</b>
          <div>{addr(ba)}</div>
          <div>{ba.cityName ?? branch?.cityName} / {ba.uf ?? branch?.uf} — CEP {ba.zip ?? "—"}</div>
          <div>Fone {branch?.phone ?? company.phone ?? "—"}</div>
        </div>
        <div className={`${box} text-center`}>
          <b className="text-[13px]">DANFE</b>
          <div className="text-[8px]">Documento Auxiliar da Nota Fiscal Eletrônica</div>
          <div className="mt-1 flex items-center justify-center gap-2">
            <span className="text-[8px] text-left">0 — Entrada<br />1 — Saída</span>
            <span className="border border-black px-2 text-sm font-bold">{doc.operationType === "entrada" ? 0 : 1}</span>
          </div>
          <div className="mt-1">Nº {String(doc.number ?? "—").padStart(9, "0")} · Série {doc.series ?? "—"}</div>
          <div>Folha 1/1</div>
        </div>
        <div className={box}>
          {doc.accessKey ? <Barcode128 value={doc.accessKey} className="h-10 w-full" /> : <div className="flex h-10 items-center justify-center text-[9px]">Chave gerada na autorização</div>}
          <span className={`${lbl} mt-1`}>Chave de acesso</span>
          <div className="font-mono text-[10px] font-bold">{formatKey(doc.accessKey)}</div>
          <div className="mt-1 text-[8px]">Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da SEFAZ autorizadora</div>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_1fr]">
        <div className={box}><span className={lbl}>Natureza da operação</span>{doc.nature}</div>
        <div className={box}><span className={lbl}>Protocolo de autorização de uso</span>{doc.protocol ? `${doc.protocol} — ${dt(doc.authorizedAt)}` : "—"}</div>
      </div>
      <div className="grid grid-cols-3">
        <div className={box}><span className={lbl}>Inscrição estadual</span>{branch?.ie ?? company.ie ?? "—"}</div>
        <div className={box}><span className={lbl}>Inscrição municipal</span>{branch?.im ?? company.im ?? "—"}</div>
        <div className={box}><span className={lbl}>CNPJ</span>{formatDoc(branch?.cnpj ?? company.cnpj)}</div>
      </div>
      <p className="mt-1 text-[9px] font-bold">DESTINATÁRIO / REMETENTE</p>
      <div className="grid grid-cols-[1fr_44mm_30mm]">
        <div className={box}><span className={lbl}>Nome / razão social</span>{r.name ?? "—"}</div>
        <div className={box}><span className={lbl}>CNPJ / CPF</span>{formatDoc(r.doc) || "—"}</div>
        <div className={box}><span className={lbl}>Data da emissão</span>{formatDate(doc.issuedAt)}</div>
      </div>
      <div className="grid grid-cols-[1fr_40mm_24mm_30mm]">
        <div className={box}><span className={lbl}>Endereço</span>{addr(r.address)}</div>
        <div className={box}><span className={lbl}>Município</span>{r.address?.cityName ?? "—"}</div>
        <div className={box}><span className={lbl}>UF / CEP</span>{r.address?.uf ?? "—"} {r.address?.zip ?? ""}</div>
        <div className={box}><span className={lbl}>Data saída/entrada</span>{doc.exitAt ? dt(doc.exitAt) : "—"}</div>
      </div>
      <div className="grid grid-cols-[1fr_1fr]">
        <div className={box}><span className={lbl}>Inscrição estadual</span>{r.ie ?? "—"}</div>
        <div className={box}><span className={lbl}>E-mail</span>{r.email ?? "—"}</div>
      </div>
      {(doc.payments ?? []).length > 0 && (
        <div className={box}>
          <span className={lbl}>Pagamento</span>
          {(doc.payments as any[]).map((p) => `${TPAG_LABEL[p.kind] ?? p.kind}${p.kind === "none" ? "" : ` ${formatMoney(p.amount)}`}`).join(" · ")}
        </div>
      )}
      <p className="mt-1 text-[9px] font-bold">CÁLCULO DO IMPOSTO</p>
      <div className="grid grid-cols-5">
        <div className={box}><span className={lbl}>Base de cálculo ICMS</span>{formatMoney(t.icmsBase)}</div>
        <div className={box}><span className={lbl}>Valor do ICMS</span>{formatMoney(t.icms)}</div>
        <div className={box}><span className={lbl}>Valor aprox. tributos</span>{formatMoney(t.approxTax ?? 0)}</div>
        <div className={box}><span className={lbl}>Valor PIS / COFINS</span>{formatMoney(t.pis)} / {formatMoney(t.cofins)}</div>
        <div className={box}><span className={lbl}>Valor total dos produtos</span>{formatMoney(t.products)}</div>
        <div className={box}><span className={lbl}>Valor do frete</span>{formatMoney(t.freight)}</div>
        <div className={box}><span className={lbl}>Valor do seguro</span>{formatMoney(t.insurance ?? 0)}</div>
        <div className={box}><span className={lbl}>Desconto</span>{formatMoney(t.discount)}</div>
        <div className={box}><span className={lbl}>Outras despesas</span>{formatMoney(t.other)}</div>
        <div className={box}><span className={lbl}>Valor total da nota</span><b>{formatMoney(t.total)}</b></div>
      </div>
      <p className="mt-1 text-[9px] font-bold">TRANSPORTADOR / VOLUMES TRANSPORTADOS</p>
      <div className="grid grid-cols-[1fr_50mm_30mm_34mm]">
        <div className={box}><span className={lbl}>Nome / razão social</span>{doc.transport?.carrierName ?? "—"}</div>
        <div className={box}><span className={lbl}>Frete por conta</span>{FREIGHT_MODE_LABEL[String(doc.transport?.mode ?? "9")]}</div>
        <div className={box}><span className={lbl}>Placa / UF</span>{doc.transport?.vehiclePlate ?? "—"} {doc.transport?.vehicleUf ?? ""}</div>
        <div className={box}><span className={lbl}>CNPJ / CPF</span>{formatDoc(doc.transport?.carrierDoc) || "—"}</div>
      </div>
      <div className="grid grid-cols-4">
        <div className={box}><span className={lbl}>Quantidade</span>{doc.transport?.volumes ?? "—"}</div>
        <div className={box}><span className={lbl}>Espécie</span>{doc.transport?.species ?? "—"}</div>
        <div className={box}><span className={lbl}>Peso bruto (kg)</span>{doc.transport?.grossWeightKg ?? "—"}</div>
        <div className={box}><span className={lbl}>Peso líquido (kg)</span>{doc.transport?.netWeightKg ?? "—"}</div>
      </div>
      <p className="mt-1 text-[9px] font-bold">DADOS DOS PRODUTOS / SERVIÇOS</p>
      <table className="w-full border-collapse text-[9px]">
        <thead>
          <tr className="[&_th]:border [&_th]:border-black [&_th]:px-1 [&_th]:text-left [&_th]:font-semibold">
            <th>Código</th><th>Descrição</th><th>NCM</th><th>CST/CSOSN</th><th>CFOP</th><th>UN</th><th className="!text-right">Qtd</th><th className="!text-right">V. unit.</th><th className="!text-right">V. desc.</th><th className="!text-right">V. total</th><th className="!text-right">BC ICMS</th><th className="!text-right">V. ICMS</th><th className="!text-right">Alíq.</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.seq} className="[&_td]:border [&_td]:border-black [&_td]:px-1">
              <td>{i.code}</td><td>{i.description}</td><td>{i.ncm}</td><td>{i.origin}{i.cstCsosn}</td><td>{i.cfop}</td><td>{i.unit}</td>
              <td className="text-right">{formatQty(i.qty)}</td><td className="text-right">{formatMoney(i.unitPrice)}</td><td className="text-right">{i.discount ? formatMoney(i.discount) : "—"}</td><td className="text-right">{formatMoney(i.total)}</td>
              <td className="text-right">{formatMoney(i.icmsBase)}</td><td className="text-right">{formatMoney(i.icms)}</td><td className="text-right">{i.icmsBase ? formatBps(i.icmsRateBps) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[9px] font-bold">DADOS ADICIONAIS</p>
      <div className={`${box} min-h-[20mm]`}>
        <span className={lbl}>Informações complementares</span>
        {["simples", "mei"].includes(company.regime) && <div>Documento emitido por ME ou EPP optante pelo Simples Nacional. Não gera direito a crédito fiscal de IPI.</div>}
        {t.approxTax ? <div>Valor aproximado dos tributos: {formatMoney(t.approxTax)} (Lei 12.741/2012 — percentual parametrizado).</div> : null}
        {(doc.service?.referencedKeys ?? []).length > 0 && <div>Documento(s) referenciado(s): {(doc.service.referencedKeys as string[]).join(", ")}</div>}
        {doc.service?.additionalInfo && <div>{doc.service.additionalInfo}</div>}
        {doc.isSimulated && <div className="font-bold">DOCUMENTO GERADO EM SIMULAÇÃO — SEM VALIDADE FISCAL. Chave e protocolo não existem na SEFAZ.</div>}
      </div>
    </div>
  );
}

export async function Danfce({ doc, company, branch, sale, payments, operator, terminal }: { doc: Doc; company: Doc; branch: Doc | null; sale: Doc | null; payments: Doc[]; operator: Doc | null; terminal: Doc | null }) {
  const t = doc.totals ?? {};
  const items = (doc.items ?? []) as DocItem[];
  const stamp = printStamp(doc);
  const qr = doc.qrCodeUrl ? await QRCode.toString(doc.qrCodeUrl, { type: "svg", margin: 0, width: 140 }) : null;
  const ba = branch?.address ?? company.address ?? {};
  const change = payments.reduce((a, p) => a + (p.change ?? 0), 0);
  return (
    <div className="danfce relative mx-auto w-[76mm] bg-white p-[2mm] font-mono text-[10px] leading-snug text-black">
      {stamp && <p className="mb-1 border border-black p-1 text-center text-[10px] font-bold">{stamp}</p>}
      <div className="text-center">
        <b>{company.tradeName || company.name}</b>
        <div>{company.name}</div>
        <div>CNPJ {formatDoc(branch?.cnpj ?? company.cnpj)} IE {branch?.ie ?? company.ie ?? "—"}</div>
        <div>{addr(ba)} — {ba.cityName}/{ba.uf}</div>
        <div className="mt-1 border-y border-dashed border-black py-0.5 font-bold">DANFE NFC-e — Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
      </div>
      <table className="mt-1 w-full">
        <thead><tr className="text-left"><th>#</th><th>Descrição</th><th className="text-right">Qtd</th><th className="text-right">Total</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.seq} className="align-top">
              <td className="pr-1">{i.seq}</td>
              <td>{i.description}<div className="text-[9px]">{i.code} · {formatMoney(i.unitPrice)}/{i.unit}</div></td>
              <td className="text-right">{formatQty(i.qty)}</td>
              <td className="text-right">{formatMoney(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 border-t border-dashed border-black pt-1">
        <div className="flex justify-between"><span>Qtde. total de itens</span><span>{items.length}</span></div>
        <div className="flex justify-between"><span>Valor total</span><span>{formatMoney(t.products)}</span></div>
        {t.discount ? <div className="flex justify-between"><span>Descontos</span><span>-{formatMoney(t.discount)}</span></div> : null}
        {t.other ? <div className="flex justify-between"><span>Acréscimos</span><span>{formatMoney(t.other)}</span></div> : null}
        <div className="flex justify-between text-[12px] font-bold"><span>VALOR A PAGAR</span><span>{formatMoney(t.total)}</span></div>
        <div className="mt-1 flex justify-between font-bold"><span>FORMA DE PAGAMENTO</span><span>VALOR PAGO</span></div>
        {(doc.payments ?? []).map((p: any, i: number) => (
          <div key={i} className="flex justify-between"><span>{TPAG_LABEL[p.kind] ?? p.kind}</span><span>{formatMoney(p.amount)}</span></div>
        ))}
        {change ? <div className="flex justify-between"><span>Troco</span><span>{formatMoney(change)}</span></div> : null}
      </div>
      <div className="mt-1 border-t border-dashed border-black pt-1 text-center">
        <div>Consulte pela chave de acesso em {doc.isSimulated ? "(simulação — sem consulta na SEFAZ)" : "www.nfce.fazenda.gov.br (portal da SEFAZ da UF)"}</div>
        <div className="font-bold">{formatKey(doc.accessKey)}</div>
      </div>
      <div className="mt-1 border-t border-dashed border-black pt-1 text-center">
        {doc.recipientDoc ? <div>CONSUMIDOR CPF/CNPJ {formatDoc(doc.recipientDoc)} {doc.recipientName ?? ""}</div> : <div>CONSUMIDOR NÃO IDENTIFICADO</div>}
        <div className="font-bold">NFC-e nº {String(doc.number ?? "—").padStart(9, "0")} Série {doc.series} {dt(doc.issuedAt)}</div>
        <div>{doc.contingency ? "EMITIDA EM CONTINGÊNCIA" : doc.protocol ? `Protocolo de autorização: ${doc.protocol}` : "Sem protocolo de autorização"}</div>
        {doc.authorizedAt && <div>Data de autorização: {dt(doc.authorizedAt)}</div>}
      </div>
      {qr && <div className="mx-auto mt-2 size-[35mm]" dangerouslySetInnerHTML={{ __html: qr }} />}
      <div className="mt-1 text-center text-[9px]">
        Tributos totais incidentes (Lei Federal 12.741/2012): {formatMoney(t.approxTax ?? 0)}
        <div>Venda nº {sale?.number ?? "—"} · {terminal?.code ?? ""} · operador {operator?.name ?? "—"}</div>
        {doc.isSimulated && <div className="font-bold">SIMULAÇÃO — SEM VALOR FISCAL</div>}
      </div>
    </div>
  );
}

export function Danfse({ doc, company, branch }: { doc: Doc; company: Doc; branch: Doc | null }) {
  const s = doc.service ?? {};
  const r = doc.recipient ?? {};
  const stamp = printStamp(doc);
  return (
    <div className="danfse relative mx-auto w-[200mm] bg-white p-[6mm] text-[11px] text-black">
      <Stamp text={stamp} />
      <div className="grid grid-cols-[1fr_60mm] border border-black">
        <div className="p-2">
          <b className="text-base">NOTA FISCAL DE SERVIÇOS ELETRÔNICA — NFS-e</b>
          <div className="text-[10px]">{s.standard === "nacional" ? "Padrão nacional (DPS)" : "Padrão municipal"} · documento auxiliar gerado pelo sistema{doc.danfeUrl && !doc.isSimulated ? " (o documento oficial é o do provedor/prefeitura)" : ""}</div>
        </div>
        <div className="border-l border-black p-2 text-[10px]">
          <div>Número da NFS-e: <b>{doc.number ?? "—"}</b></div>
          <div>Emissão: {dt(doc.authorizedAt ?? doc.issuedAt)}</div>
          <div>Código de verificação: <b>{doc.verificationCode ?? "—"}</b></div>
          <div>RPS nº {doc.rpsNumber ?? "—"} série {doc.rpsSeries ?? "—"}</div>
          <div>Competência: {formatDate(s.competence)}</div>
        </div>
      </div>
      <div className="mt-2 border border-black p-2">
        <p className="text-[10px] font-bold">PRESTADOR DE SERVIÇOS</p>
        <div>{company.name} — CNPJ {formatDoc(branch?.cnpj ?? company.cnpj)} — IM {branch?.im ?? company.im ?? "—"}</div>
        <div>{addr(branch?.address ?? company.address)} — {branch?.cityName}/{branch?.uf}</div>
      </div>
      <div className="mt-2 border border-black p-2">
        <p className="text-[10px] font-bold">TOMADOR DE SERVIÇOS</p>
        <div>{r.name ?? "—"} — {formatDoc(r.doc) || "CPF/CNPJ não informado"}{r.im ? ` — IM ${r.im}` : ""}</div>
        <div>{addr(r.address)} {r.address?.cityName ? `— ${r.address.cityName}/${r.address.uf}` : ""} {r.email ? `— ${r.email}` : ""}</div>
      </div>
      <div className="mt-2 min-h-[30mm] border border-black p-2">
        <p className="text-[10px] font-bold">DISCRIMINAÇÃO DOS SERVIÇOS</p>
        <div className="whitespace-pre-wrap">{s.description}</div>
      </div>
      <div className="mt-2 border border-black p-2 text-[10px]">
        Item LC 116: <b>{s.serviceListItem}</b> · Código municipal: {s.municipalCode ?? "—"} · Local da prestação (IBGE): {s.serviceCityCode ?? branch?.cityCode ?? "—"} · Exigibilidade: {s.issExigibility ?? "1"}
      </div>
      <table className="mt-2 w-full border-collapse text-[10px]">
        <tbody className="[&_td]:border [&_td]:border-black [&_td]:p-1">
          <tr><td>Valor dos serviços</td><td className="text-right">{formatMoney(s.amount)}</td><td>Desconto incondicionado</td><td className="text-right">{formatMoney(s.unconditionalDiscount)}</td><td>Deduções</td><td className="text-right">{formatMoney(s.deductions)}</td></tr>
          <tr><td>Base de cálculo</td><td className="text-right">{formatMoney(s.base)}</td><td>Alíquota ISS</td><td className="text-right">{formatBps(s.issRateBps)}</td><td>ISS {s.issWithheld ? "retido" : "devido"}</td><td className="text-right">{formatMoney(s.iss)}</td></tr>
          <tr><td>PIS</td><td className="text-right">{formatMoney(s.withhold?.pis ? s.pis : 0)}</td><td>COFINS</td><td className="text-right">{formatMoney(s.withhold?.cofins ? s.cofins : 0)}</td><td>INSS</td><td className="text-right">{formatMoney(s.withhold?.inss ? s.inss : 0)}</td></tr>
          <tr><td>IR</td><td className="text-right">{formatMoney(s.withhold?.ir ? s.ir : 0)}</td><td>CSLL</td><td className="text-right">{formatMoney(s.withhold?.csll ? s.csll : 0)}</td><td><b>Valor líquido</b></td><td className="text-right"><b>{formatMoney(s.net)}</b></td></tr>
        </tbody>
      </table>
      {doc.isSimulated && <p className="mt-2 text-center font-bold">DOCUMENTO GERADO EM SIMULAÇÃO — SEM VALIDADE FISCAL</p>}
    </div>
  );
}
