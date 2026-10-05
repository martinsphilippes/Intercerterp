import { pct } from "@/lib/money";

/** Cálculo puro da NFS-e (usado no formulário para prévia e no servidor, que sempre recalcula). */

export interface NfseCalcInput {
  amount: number;
  unconditionalDiscount?: number;
  deductions?: number;
  issRateBps: number;
  issWithheld: boolean;
  pisBps?: number;
  cofinsBps?: number;
  inssBps?: number;
  irBps?: number;
  csllBps?: number;
  withhold?: { pis?: boolean; cofins?: boolean; inss?: boolean; ir?: boolean; csll?: boolean };
}

/**
 * Base de cálculo do ISS = serviços − desconto incondicionado − deduções.
 * ISS calculado = base × alíquota (sempre); ISS retido = ISS calculado somente quando o tomador retém.
 * Retenções federais (PIS/COFINS/INSS/IR/CSLL) = (serviços − desconto incondicionado) × alíquota, somente as marcadas como retidas.
 * Líquido = serviços − desconto incondicionado − ISS retido − retenções federais.
 */
export function calcNfse(i: NfseCalcInput) {
  if (!(i.amount >= 0)) throw new Error("Valor dos serviços inválido.");
  const disc = i.unconditionalDiscount ?? 0;
  if (!(disc >= 0 && disc <= i.amount)) throw new Error("Desconto incondicionado não pode exceder o valor dos serviços.");
  const base = Math.max(0, i.amount - disc - (i.deductions ?? 0));
  const iss = pct(base, i.issRateBps);
  const gross = i.amount - disc;
  const w = i.withhold ?? {};
  const pis = i.pisBps ? pct(gross, i.pisBps) : 0;
  const cofins = i.cofinsBps ? pct(gross, i.cofinsBps) : 0;
  const inss = i.inssBps ? pct(gross, i.inssBps) : 0;
  const ir = i.irBps ? pct(gross, i.irBps) : 0;
  const csll = i.csllBps ? pct(gross, i.csllBps) : 0;
  const federalWithheld = (w.pis ? pis : 0) + (w.cofins ? cofins : 0) + (w.inss ? inss : 0) + (w.ir ? ir : 0) + (w.csll ? csll : 0);
  const issWithheldValue = i.issWithheld ? iss : 0;
  const withheld = issWithheldValue + federalWithheld;
  return { base, iss, issWithheldValue, issDue: i.issWithheld ? 0 : iss, pis, cofins, inss, ir, csll, federalWithheld, withheld, net: gross - withheld };
}

