import { XMLParser } from "fast-xml-parser";
import { BusinessError } from "@/lib/core/errors";
import { onlyDigits } from "@/lib/core/text";
import { parseQty, toCents } from "@/lib/money";

/**
 * Leitura de XML de NF-e (modelo 55, leiaute 4.00) — nfeProc ou NFe.
 * Extrai emitente, destinatário, chave, número/série, itens (cProd, cEAN, xProd, NCM, CFOP, uCom, qCom,
 * vUnCom, vProd, vDesc, vFrete, vOutro), totais e duplicatas (cobr/dup). Valores convertidos para
 * centavos e quantidades para milésimos sem ponto flutuante acumulado.
 */

export interface NfeItem {
  nItem: number;
  cProd: string;
  cEAN: string | null;
  xProd: string;
  ncm: string | null;
  cfop: string | null;
  uCom: string;
  qCom: number; // milésimos
  vUnCom: number; // centavos (arredondado; preço unitário pode ter até 10 casas)
  vUnComRaw: string;
  vProd: number;
  vDesc: number;
  vFrete: number;
  vOutro: number;
}

export interface NfeDuplicata {
  nDup: string;
  dVenc: string;
  vDup: number;
}

export interface ParsedNfe {
  key: string;
  model: string;
  number: string;
  series: string;
  issueDate: string | null;
  nature: string | null;
  emitter: { cnpj: string | null; cpf: string | null; name: string; tradeName: string | null; ie: string | null; address: Record<string, string | null> };
  recipient: { cnpj: string | null; cpf: string | null; name: string | null };
  items: NfeItem[];
  totals: { vProd: number; vFrete: number; vDesc: number; vOutro: number; vIPI: number; vST: number; vSeg: number; vICMS: number; vNF: number };
  duplicatas: NfeDuplicata[];
  protocol: string | null;
  authorized: boolean;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, parseTagValue: false, trimValues: true, isArray: (name) => ["det", "dup", "detPag"].includes(name) });

const str = (v: any): string | null => (v == null || v === "" ? null : String(typeof v === "object" ? (v["#text"] ?? "") : v).trim() || null);
const money = (v: any) => (str(v) ? toCents(str(v)!) : 0);

/** Dígito verificador da chave de acesso (módulo 11, pesos 2..9). */
export function nfeKeyIsValid(key: string) {
  const k = onlyDigits(key);
  if (k.length !== 44) return false;
  let sum = 0;
  let w = 2;
  for (let i = 42; i >= 0; i--) {
    sum += Number(k[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  const dv = r < 2 ? 0 : 11 - r;
  return dv === Number(k[43]);
}

export function parseNfeXml(xml: string): ParsedNfe {
  if (!xml || !xml.includes("<")) throw new BusinessError("Arquivo vazio ou não é XML.", "invalid_xml");
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch (e: any) {
    throw new BusinessError(`XML inválido: ${e.message}`, "invalid_xml");
  }
  const nfe = doc?.nfeProc?.NFe ?? doc?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new BusinessError("O XML não é uma NF-e (elemento infNFe não encontrado). Para NFC-e/CT-e use o módulo correspondente.", "invalid_xml");
  const ide = inf.ide ?? {};
  const model = str(ide.mod) ?? "";
  if (model && model !== "55") throw new BusinessError(`Modelo ${model} não suportado no recebimento (esperado NF-e modelo 55).`, "invalid_xml");
  const prot = doc?.nfeProc?.protNFe?.infProt;
  const key = onlyDigits(str(prot?.chNFe) ?? String(inf["@_Id"] ?? "").replace(/^NFe/, ""));
  if (key.length !== 44) throw new BusinessError("Chave de acesso não encontrada no XML.", "invalid_xml");
  if (!nfeKeyIsValid(key)) throw new BusinessError(`Chave de acesso ${key} com dígito verificador inválido.`, "invalid_xml");
  const emit = inf.emit ?? {};
  const ender = emit.enderEmit ?? {};
  const dest = inf.dest ?? {};
  const dets: any[] = inf.det ?? [];
  if (!dets.length) throw new BusinessError("NF-e sem itens.", "invalid_xml");
  const items: NfeItem[] = dets.map((d, i) => {
    const p = d.prod ?? {};
    const qRaw = str(p.qCom) ?? "0";
    return {
      nItem: Number(d["@_nItem"] ?? i + 1),
      cProd: str(p.cProd) ?? "",
      cEAN: str(p.cEAN) && !/SEM GTIN/i.test(str(p.cEAN)!) ? str(p.cEAN) : null,
      xProd: str(p.xProd) ?? "",
      ncm: str(p.NCM),
      cfop: str(p.CFOP),
      uCom: str(p.uCom) ?? "UN",
      qCom: parseQty(qRaw),
      vUnCom: money(p.vUnCom),
      vUnComRaw: str(p.vUnCom) ?? "0",
      vProd: money(p.vProd),
      vDesc: money(p.vDesc),
      vFrete: money(p.vFrete),
      vOutro: money(p.vOutro),
    };
  });
  const tot = inf.total?.ICMSTot ?? {};
  const dups: any[] = inf.cobr?.dup ?? [];
  return {
    key,
    model: model || "55",
    number: str(ide.nNF) ?? "",
    series: str(ide.serie) ?? "",
    issueDate: str(ide.dhEmi) ?? (str(ide.dEmi) ? `${str(ide.dEmi)}T12:00:00-03:00` : null),
    nature: str(ide.natOp),
    emitter: {
      cnpj: str(emit.CNPJ),
      cpf: str(emit.CPF),
      name: str(emit.xNome) ?? "",
      tradeName: str(emit.xFant),
      ie: str(emit.IE),
      address: { street: str(ender.xLgr), number: str(ender.nro), district: str(ender.xBairro), cityName: str(ender.xMun), cityCode: str(ender.cMun), uf: str(ender.UF), zip: str(ender.CEP) },
    },
    recipient: { cnpj: str(dest.CNPJ), cpf: str(dest.CPF), name: str(dest.xNome) },
    items,
    totals: { vProd: money(tot.vProd), vFrete: money(tot.vFrete), vDesc: money(tot.vDesc), vOutro: money(tot.vOutro), vIPI: money(tot.vIPI), vST: money(tot.vST), vSeg: money(tot.vSeg), vICMS: money(tot.vICMS), vNF: money(tot.vNF) },
    duplicatas: dups.map((d) => ({ nDup: str(d.nDup) ?? "", dVenc: str(d.dVenc) ?? "", vDup: money(d.vDup) })).filter((d) => d.dVenc && d.vDup > 0),
    protocol: str(prot?.nProt),
    authorized: str(prot?.cStat) === "100",
  };
}

/** Monta uma chave de acesso válida (usada na geração do XML de exemplo/demonstração). */
export function buildNfeKey(parts: { uf: string; yymm: string; cnpj: string; model?: string; series: number; number: number; tpEmis?: number; code: number }) {
  const base = `${parts.uf.padStart(2, "0")}${parts.yymm}${onlyDigits(parts.cnpj).padStart(14, "0")}${parts.model ?? "55"}${String(parts.series).padStart(3, "0")}${String(parts.number).padStart(9, "0")}${parts.tpEmis ?? 1}${String(parts.code).padStart(8, "0")}`;
  let sum = 0;
  let w = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  return base + String(r < 2 ? 0 : 11 - r);
}

// ───────────────────────────── Geração de XML de exemplo (testes e demonstração)

export interface SampleNfeInput {
  number: number;
  series?: number;
  issueDate: string; // AAAA-MM-DD
  code?: number;
  emitter: { cnpj: string; name: string; tradeName?: string; ie?: string; uf?: string; cityCode?: string; cityName?: string };
  recipient: { cnpj: string; name: string; ie?: string };
  items: Array<{ cProd: string; cEAN?: string | null; xProd: string; ncm?: string; cfop?: string; uCom?: string; qCom: number; vUnCom: number; vDesc?: number }>;
  freight?: number;
  other?: number;
  duplicatas?: Array<{ dVenc: string; vDup?: number }>;
}

const dec = (cents: number) => (cents / 100).toFixed(2);
const q4 = (milli: number) => (milli / 1000).toFixed(4);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Gera um XML de NF-e (nfeProc, leiaute 4.00) estruturalmente válido para testes e demonstração.
 * NÃO é documento fiscal: protocolo fictício marcado em xMotivo. Valores em centavos; quantidades em milésimos.
 */
export function buildSampleNfeXml(i: SampleNfeInput) {
  const series = i.series ?? 1;
  const [y, m] = i.issueDate.split("-");
  const key = buildNfeKey({ uf: "35", yymm: `${y.slice(2)}${m}`, cnpj: i.emitter.cnpj, series, number: i.number, code: i.code ?? 10000000 + i.number });
  const freight = i.freight ?? 0;
  const other = i.other ?? 0;
  const lines = i.items.map((it) => {
    const vProd = Math.round((it.vUnCom * it.qCom) / 1000);
    return { ...it, vProd, vDesc: it.vDesc ?? 0 };
  });
  const vProd = lines.reduce((a, l) => a + l.vProd, 0);
  const vDesc = lines.reduce((a, l) => a + l.vDesc, 0);
  // frete rateado nos itens (vFrete por item), fechando o total
  const shares = (() => {
    if (!freight) return lines.map(() => 0);
    const out = lines.map((l) => Math.floor((freight * l.vProd) / (vProd || 1)));
    out[0] += freight - out.reduce((a, b) => a + b, 0);
    return out;
  })();
  const vNF = vProd - vDesc + freight + other;
  const dups = i.duplicatas?.length ? i.duplicatas : [];
  const dupVals = dups.length ? (dups.every((d) => d.vDup != null) ? dups.map((d) => d.vDup!) : splitEven(vNF, dups.length)) : [];
  const det = lines
    .map(
      (l, n) => `<det nItem="${n + 1}"><prod><cProd>${esc(l.cProd)}</cProd><cEAN>${l.cEAN ?? "SEM GTIN"}</cEAN><xProd>${esc(l.xProd)}</xProd><NCM>${l.ncm ?? "61091000"}</NCM><CFOP>${l.cfop ?? "5102"}</CFOP><uCom>${l.uCom ?? "UN"}</uCom><qCom>${q4(l.qCom)}</qCom><vUnCom>${(l.vUnCom / 100).toFixed(10)}</vUnCom><vProd>${dec(l.vProd)}</vProd><cEANTrib>${l.cEAN ?? "SEM GTIN"}</cEANTrib><uTrib>${l.uCom ?? "UN"}</uTrib><qTrib>${q4(l.qCom)}</qTrib><vUnTrib>${(l.vUnCom / 100).toFixed(10)}</vUnTrib>${shares[n] ? `<vFrete>${dec(shares[n])}</vFrete>` : ""}${l.vDesc ? `<vDesc>${dec(l.vDesc)}</vDesc>` : ""}<indTot>1</indTot></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISOutr><CST>49</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS><COFINS><COFINSOutr><CST>49</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS></imposto></det>`,
    )
    .join("");
  const cobr = dups.length
    ? `<cobr><fat><nFat>${i.number}</nFat><vOrig>${dec(vNF)}</vOrig><vDesc>0.00</vDesc><vLiq>${dec(vNF)}</vLiq></fat>${dups.map((d, n) => `<dup><nDup>${String(n + 1).padStart(3, "0")}</nDup><dVenc>${d.dVenc}</dVenc><vDup>${dec(dupVals[n])}</vDup></dup>`).join("")}</cobr>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${key}" versao="4.00"><ide><cUF>35</cUF><cNF>${key.slice(35, 43)}</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>${series}</serie><nNF>${i.number}</nNF><dhEmi>${i.issueDate}T10:00:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>${i.emitter.cityCode ?? "3550308"}</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${key[43]}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>0</indFinal><indPres>9</indPres><procEmi>0</procEmi><verProc>Intercert-Exemplo</verProc></ide><emit><CNPJ>${i.emitter.cnpj}</CNPJ><xNome>${esc(i.emitter.name)}</xNome>${i.emitter.tradeName ? `<xFant>${esc(i.emitter.tradeName)}</xFant>` : ""}<enderEmit><xLgr>Rua Industrial</xLgr><nro>200</nro><xBairro>Distrito Industrial</xBairro><cMun>${i.emitter.cityCode ?? "3550308"}</cMun><xMun>${i.emitter.cityName ?? "Sao Paulo"}</xMun><UF>${i.emitter.uf ?? "SP"}</UF><CEP>03000000</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderEmit><IE>${i.emitter.ie ?? "ISENTO"}</IE><CRT>1</CRT></emit><dest><CNPJ>${i.recipient.cnpj}</CNPJ><xNome>${esc(i.recipient.name)}</xNome><enderDest><xLgr>Rua das Flores</xLgr><nro>100</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>Sao Paulo</xMun><UF>SP</UF><CEP>01001000</CEP><cPais>1058</cPais><xPais>BRASIL</xPais></enderDest><indIEDest>1</indIEDest><IE>${i.recipient.ie ?? "110042490114"}</IE></dest>${det}<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${dec(vProd)}</vProd><vFrete>${dec(freight)}</vFrete><vSeg>0.00</vSeg><vDesc>${dec(vDesc)}</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>${dec(other)}</vOutro><vNF>${dec(vNF)}</vNF></ICMSTot></total><transp><modFrete>${freight ? 0 : 9}</modFrete></transp>${cobr}<pag><detPag><indPag>1</indPag><tPag>15</tPag><vPag>${dec(vNF)}</vPag></detPag></pag><infAdic><infCpl>XML DE EXEMPLO PARA TESTE/DEMONSTRACAO - SEM VALOR FISCAL</infCpl></infAdic></infNFe></NFe><protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>EXEMPLO</verAplic><chNFe>${key}</chNFe><dhRecbto>${i.issueDate}T10:01:00-03:00</dhRecbto><nProt>135${String(i.number).padStart(12, "0")}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e (EXEMPLO SEM VALOR FISCAL)</xMotivo></infProt></protNFe></nfeProc>`;
}

function splitEven(total: number, n: number) {
  const base = Math.trunc(total / n);
  const parts = Array(n).fill(base);
  parts[0] += total - base * n;
  return parts;
}
