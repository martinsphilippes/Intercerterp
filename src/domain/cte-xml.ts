import { XMLParser } from "fast-xml-parser";
import { BusinessError } from "@/lib/core/errors";
import { onlyDigits } from "@/lib/core/text";
import { toCents } from "@/lib/money";
import { buildNfeKey, nfeKeyIsValid } from "./nfe-xml";

/**
 * Leitura de XML de CT-e (modelo 57, leiaute 3.00/4.00) — cteProc ou CTe — para o frete de compra (COM-10).
 * Extrai chave, número/série, emissão, CFOP, emitente (transportadora), remetente, destinatário, expedidor,
 * recebedor, tomador do serviço (toma3/toma4), valor da prestação (vTPrest/vRec), ICMS da prestação, chaves das
 * NF-e transportadas (infDoc/infNFe/chave), duplicatas (infCTeNorm/cobr/dup) e o protocolo. Valores em centavos e
 * alíquotas em pontos-base, sem ponto flutuante acumulado.
 */

export interface CteParty {
  cnpj: string | null;
  cpf: string | null;
  name: string | null;
  ie: string | null;
  uf: string | null;
}

export interface ParsedCte {
  key: string;
  model: string;
  number: string;
  series: string;
  issueDate: string | null;
  cfop: string | null;
  nature: string | null;
  /** tipo do CT-e: 0 normal, 1 complemento, 2 anulação, 3 substituto */
  type: string | null;
  /** modal: 01 rodoviário, 02 aéreo, 03 aquaviário, 04 ferroviário, 05 dutoviário, 06 multimodal */
  modal: string | null;
  ufStart: string | null;
  ufEnd: string | null;
  emitter: CteParty & { tradeName: string | null; address: Record<string, string | null> };
  sender: CteParty;
  recipient: CteParty;
  shipper: CteParty;
  receiver: CteParty;
  /** tomador do serviço (quem paga o frete): 0 remetente, 1 expedidor, 2 recebedor, 3 destinatário, 4 outros */
  tomador: { role: "0" | "1" | "2" | "3" | "4" | null; party: CteParty };
  /** valor total da prestação (vTPrest) e valor a receber (vRec), centavos */
  total: number;
  received: number;
  icms: { group: string | null; cst: string | null; vBC: number; pICMS: number; vICMS: number; simples: boolean };
  nfeKeys: string[];
  duplicatas: Array<{ nDup: string; dVenc: string; vDup: number }>;
  protocol: string | null;
  authorized: boolean;
  denied: boolean;
  environment: "producao" | "homologacao" | null;
  protocolStatus: string | null;
  protocolMessage: string | null;
}

export const TOMADOR_LABEL: Record<string, string> = { "0": "Remetente", "1": "Expedidor", "2": "Recebedor", "3": "Destinatário", "4": "Outros" };

const AUTHORIZED_CSTAT = ["100", "150"];
const DENIED_CSTAT = ["110", "205", "301", "302", "303"];

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, parseTagValue: false, trimValues: true, isArray: (name) => ["infNFe", "dup", "Comp", "infNF", "infOutros"].includes(name) });

const str = (v: any): string | null => (v == null || v === "" ? null : String(typeof v === "object" ? (v["#text"] ?? "") : v).trim() || null);
const money = (v: any) => (str(v) ? toCents(str(v)!) : 0);

function party(p: any): CteParty {
  const x = p ?? {};
  const addr = x.enderReme ?? x.enderDest ?? x.enderExped ?? x.enderReceb ?? x.enderToma ?? x.enderEmit ?? {};
  return { cnpj: str(x.CNPJ), cpf: str(x.CPF), name: str(x.xNome), ie: str(x.IE), uf: str(addr.UF) };
}

export function parseCteXml(xml: string): ParsedCte {
  if (!xml || !xml.includes("<")) throw new BusinessError("Arquivo vazio ou não é XML.", "invalid_xml");
  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch (e: any) {
    throw new BusinessError(`XML inválido: ${e.message}`, "invalid_xml");
  }
  const cte = doc?.cteProc?.CTe ?? doc?.CTe;
  const inf = cte?.infCte;
  if (!inf) throw new BusinessError("O XML não é um CT-e (elemento infCte não encontrado). Para NF-e use o recebimento de mercadorias.", "invalid_xml");
  const ide = inf.ide ?? {};
  const model = str(ide.mod) ?? "57";
  if (model !== "57") throw new BusinessError(`Modelo ${model} não suportado (esperado CT-e modelo 57).`, "invalid_xml");
  const prot = doc?.cteProc?.protCTe?.infProt;
  const key = onlyDigits(str(prot?.chCTe) ?? String(inf["@_Id"] ?? "").replace(/^CTe/, ""));
  if (key.length !== 44) throw new BusinessError("Chave de acesso do CT-e não encontrada no XML.", "invalid_xml");
  if (!nfeKeyIsValid(key)) throw new BusinessError(`Chave de acesso ${key} com dígito verificador inválido.`, "invalid_xml");
  if (key.slice(20, 22) !== "57") throw new BusinessError(`Chave ${key} não é de CT-e (modelo ${key.slice(20, 22)}).`, "invalid_xml");
  const emit = inf.emit ?? {};
  const ender = emit.enderEmit ?? {};
  const sender = party(inf.rem);
  const recipient = party(inf.dest);
  const shipper = party(inf.exped);
  const receiver = party(inf.receb);
  // tomador: toma3 (papel 0–3, documento do papel) ou toma4 (outros, com o próprio documento); leiaute 3.00 usava toma03
  const toma3 = ide.toma3 ?? ide.toma03;
  const toma4 = ide.toma4;
  const role = (str(toma3?.toma) ?? (toma4 ? "4" : null)) as ParsedCte["tomador"]["role"];
  const byRole: Record<string, CteParty> = { "0": sender, "1": shipper, "2": receiver, "3": recipient };
  const tomadorParty = role === "4" ? party(toma4) : role ? byRole[role] : { cnpj: null, cpf: null, name: null, ie: null, uf: null };
  // ICMS da prestação: primeiro grupo (ICMS00, ICMS20, ICMS45, ICMS60, ICMS90, ICMSOutraUF, ICMSSN)
  const icmsNode = inf.imp?.ICMS ?? {};
  const icmsGroup = Object.keys(icmsNode).find((k) => !k.startsWith("@_")) ?? null;
  const g = icmsGroup ? (icmsNode[icmsGroup] ?? {}) : {};
  const icms = {
    group: icmsGroup,
    cst: str(g.CST),
    vBC: money(g.vBC ?? g.vBCOutraUF ?? g.vBCSTRet),
    pICMS: money(g.pICMS ?? g.pICMSOutraUF ?? g.pICMSSTRet),
    vICMS: money(g.vICMS ?? g.vICMSOutraUF ?? g.vICMSSTRet),
    simples: icmsGroup === "ICMSSN",
  };
  const norm = inf.infCTeNorm ?? {};
  const nfeKeys = [...new Set(((norm.infDoc?.infNFe ?? []) as any[]).map((n) => onlyDigits(str(n.chave) ?? "")).filter((k) => k.length === 44))];
  const dups: any[] = norm.cobr?.dup ?? [];
  const tpAmb = str(ide.tpAmb) ?? str(prot?.tpAmb);
  return {
    key,
    model,
    number: str(ide.nCT) ?? "",
    series: str(ide.serie) ?? "",
    issueDate: str(ide.dhEmi),
    cfop: str(ide.CFOP),
    nature: str(ide.natOp),
    type: str(ide.tpCTe),
    modal: str(ide.modal),
    ufStart: str(ide.UFIni),
    ufEnd: str(ide.UFFim),
    emitter: {
      cnpj: str(emit.CNPJ),
      cpf: str(emit.CPF),
      name: str(emit.xNome),
      tradeName: str(emit.xFant),
      ie: str(emit.IE),
      uf: str(ender.UF),
      address: { street: str(ender.xLgr), number: str(ender.nro), district: str(ender.xBairro), cityName: str(ender.xMun), cityCode: str(ender.cMun), uf: str(ender.UF), zip: str(ender.CEP) },
    },
    sender,
    recipient,
    shipper,
    receiver,
    tomador: { role, party: tomadorParty },
    total: money(inf.vPrest?.vTPrest),
    received: money(inf.vPrest?.vRec),
    icms,
    nfeKeys,
    duplicatas: dups.map((d) => ({ nDup: str(d.nDup) ?? "", dVenc: str(d.dVenc) ?? "", vDup: money(d.vDup) })).filter((d) => d.dVenc && d.vDup > 0),
    protocol: str(prot?.nProt),
    authorized: AUTHORIZED_CSTAT.includes(str(prot?.cStat) ?? ""),
    denied: DENIED_CSTAT.includes(str(prot?.cStat) ?? ""),
    environment: tpAmb === "1" ? "producao" : tpAmb === "2" ? "homologacao" : null,
    protocolStatus: str(prot?.cStat),
    protocolMessage: str(prot?.xMotivo),
  };
}

// ───────────────────────────── XML de exemplo (testes e demonstração)

export interface SampleCteInput {
  number: number;
  series?: number;
  issueDate: string; // AAAA-MM-DD
  code?: number;
  cfop?: string;
  emitter: { cnpj: string; name: string; ie?: string; uf?: string; rntrc?: string };
  sender: { cnpj: string; name: string; uf?: string };
  recipient: { cnpj: string; name: string; uf?: string };
  /** tomador: 0 remetente (frete CIF), 3 destinatário (frete FOB — padrão); 4 outros com CNPJ */
  tomador?: 0 | 3 | { cnpj: string; name: string };
  /** valor total da prestação (centavos) */
  total: number;
  /** ICMS da prestação (ICMS00). Ausente = Simples Nacional (ICMSSN). */
  icms?: { vBC: number; pICMS: number; vICMS: number };
  nfeKeys: string[];
  duplicatas?: Array<{ dVenc: string; vDup: number }>;
  environment?: "producao" | "homologacao";
  protocol?: false | { cStat: string; xMotivo: string };
}

const dec = (cents: number) => (cents / 100).toFixed(2);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Gera um XML de CT-e (cteProc, leiaute 4.00) estruturalmente válido para testes e demonstração.
 * NÃO é documento fiscal: protocolo fictício marcado em xMotivo.
 */
export function buildSampleCteXml(i: SampleCteInput) {
  const series = i.series ?? 1;
  const [y, m] = i.issueDate.split("-");
  const key = buildNfeKey({ uf: "35", yymm: `${y.slice(2)}${m}`, cnpj: i.emitter.cnpj, model: "57", series, number: i.number, code: i.code ?? 20000000 + i.number });
  const tpAmb = i.environment === "producao" ? 1 : 2;
  const prot = i.protocol === false ? null : i.protocol ?? { cStat: "100", xMotivo: "Autorizado o uso do CT-e (EXEMPLO SEM VALOR FISCAL)" };
  const toma = i.tomador ?? 3;
  const tomaXml = typeof toma === "object" ? `<toma4><toma>4</toma><CNPJ>${toma.cnpj}</CNPJ><xNome>${esc(toma.name)}</xNome></toma4>` : `<toma3><toma>${toma}</toma></toma3>`;
  const icms = i.icms ? `<ICMS00><CST>00</CST><vBC>${dec(i.icms.vBC)}</vBC><pICMS>${dec(i.icms.pICMS)}</pICMS><vICMS>${dec(i.icms.vICMS)}</vICMS></ICMS00>` : "<ICMSSN><CST>90</CST><indSN>1</indSN></ICMSSN>";
  const dups = i.duplicatas?.length ? `<cobr><fat><nFat>${i.number}</nFat><vOrig>${dec(i.total)}</vOrig><vDesc>0.00</vDesc><vLiq>${dec(i.total)}</vLiq></fat>${i.duplicatas.map((d, n) => `<dup><nDup>${String(n + 1).padStart(3, "0")}</nDup><dVenc>${d.dVenc}</dVenc><vDup>${dec(d.vDup)}</vDup></dup>`).join("")}</cobr>` : "";
  const addr = (uf: string) => `<xLgr>Rua Exemplo</xLgr><nro>1</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>Sao Paulo</xMun><CEP>01001000</CEP><UF>${uf}</UF>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
${prot ? '<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">' : ""}<CTe xmlns="http://www.portalfiscal.inf.br/cte"><infCte Id="CTe${key}" versao="4.00"><ide><cUF>35</cUF><cCT>${key.slice(35, 43)}</cCT><CFOP>${i.cfop ?? "5353"}</CFOP><natOp>PRESTACAO DE SERVICO DE TRANSPORTE</natOp><mod>57</mod><serie>${series}</serie><nCT>${i.number}</nCT><dhEmi>${i.issueDate}T09:00:00-03:00</dhEmi><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${key[43]}</cDV><tpAmb>${tpAmb}</tpAmb><tpCTe>0</tpCTe><procEmi>0</procEmi><verProc>Intercert-Exemplo</verProc><cMunEnv>3550308</cMunEnv><xMunEnv>Sao Paulo</xMunEnv><UFEnv>${i.emitter.uf ?? "SP"}</UFEnv><modal>01</modal><tpServ>0</tpServ><cMunIni>3550308</cMunIni><xMunIni>Sao Paulo</xMunIni><UFIni>${i.sender.uf ?? "SP"}</UFIni><cMunFim>3550308</cMunFim><xMunFim>Sao Paulo</xMunFim><UFFim>${i.recipient.uf ?? "SP"}</UFFim><retira>1</retira><indIEToma>1</indIEToma>${tomaXml}</ide><emit><CNPJ>${i.emitter.cnpj}</CNPJ><IE>${i.emitter.ie ?? "110042490777"}</IE><xNome>${esc(i.emitter.name)}</xNome><enderEmit>${addr(i.emitter.uf ?? "SP")}</enderEmit><CRT>${i.icms ? 3 : 1}</CRT></emit><rem><CNPJ>${i.sender.cnpj}</CNPJ><xNome>${esc(i.sender.name)}</xNome><enderReme>${addr(i.sender.uf ?? "SP")}</enderReme></rem><dest><CNPJ>${i.recipient.cnpj}</CNPJ><xNome>${esc(i.recipient.name)}</xNome><enderDest>${addr(i.recipient.uf ?? "SP")}</enderDest></dest><vPrest><vTPrest>${dec(i.total)}</vTPrest><vRec>${dec(i.total)}</vRec><Comp><xNome>FRETE PESO</xNome><vComp>${dec(i.total)}</vComp></Comp></vPrest><imp><ICMS>${icms}</ICMS></imp><infCTeNorm><infCarga><vCarga>0.00</vCarga><proPred>MERCADORIAS DIVERSAS</proPred><infQ><cUnid>01</cUnid><tpMed>PESO BRUTO</tpMed><qCarga>100.0000</qCarga></infQ></infCarga><infDoc>${i.nfeKeys.map((k) => `<infNFe><chave>${k}</chave></infNFe>`).join("")}</infDoc><infModal versaoModal="4.00"><rodo><RNTRC>${i.emitter.rntrc ?? "12345678"}</RNTRC></rodo></infModal>${dups}</infCTeNorm></infCte></CTe>${prot ? `<protCTe versao="4.00"><infProt><tpAmb>${tpAmb}</tpAmb><verAplic>EXEMPLO</verAplic><chCTe>${key}</chCTe><dhRecbto>${i.issueDate}T09:01:00-03:00</dhRecbto><nProt>235${String(i.number).padStart(12, "0")}</nProt><cStat>${prot.cStat}</cStat><xMotivo>${esc(prot.xMotivo)}</xMotivo></infProt></protCTe></cteProc>` : ""}`;
}
