import { listAll } from "@/lib/db";
import type { Doc } from "@/lib/db/types";
import { formatBps, formatMoney, pct, roundDiv } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { pixStaticPayload } from "@/lib/pix";
import type { Ctx } from "@/lib/core/ctx";
import { collectionYourNumber, lateChargeParams, type LateChargeParams } from "./finance";

/**
 * Carnê de pagamento (FIN-06) do título a receber — principalmente o crediário da venda a prazo.
 * Uma lâmina por parcela com canhoto (via da loja) e via do cliente; 3 lâminas por folha A4.
 * Multa e juros são INFORMATIVOS (parâmetros de atraso vigentes, §13); o valor a cobrar é calculado na baixa.
 * O Pix opcional é o "copia e cola" estático da chave cadastrada na conta financeira (sem integração/confirmação).
 */

export const SLIPS_PER_SHEET = 3;

export interface CarneParty {
  name: string;
  doc?: string | null;
  address?: string | null;
  phone?: string | null;
}

export interface CarneCompany {
  name: string;
  tradeName?: string | null;
  cnpj?: string | null;
  address?: string | null;
  phone?: string | null;
}

export interface CarnePix {
  key: string;
  merchantName: string;
  merchantCity: string;
}

export interface CarneSlip {
  installmentId: string;
  titleNumber: number;
  number: number;
  count: number;
  /** "123/2" — mesmo "seu número" usado na cobrança bancária */
  reference: string;
  documentLabel: string;
  dueDate: string;
  amount: number;
  /** saldo em aberto (o que se paga até o vencimento) */
  balance: number;
  paid: boolean;
  partial: boolean;
  ourNumber: string | null;
  /** multa única após o vencimento (+ tolerância) */
  fine: number;
  /** juros por dia de atraso (pro rata de juros% a.m. ÷ 30) */
  interestPerDay: number;
  instructions: string[];
  /** Pix copia e cola (estático) com o saldo da parcela, quando há chave configurada e saldo em aberto */
  pixPayload: string | null;
}

export interface CarneInput {
  company: CarneCompany;
  title: { id: string; number: number; description: string; documentNumber?: string | null; installmentsCount: number; originType?: string | null };
  installments: Array<{ id: string; number: number; dueDate: string; amount: number; balance: number; status: string; ourNumber?: string | null }>;
  late: LateChargeParams;
  pix?: CarnePix | null;
  /** somente parcelas em aberto (aberta/parcial) */
  onlyOpen?: boolean;
  /** texto livre adicional (até 2 linhas) */
  extraInstruction?: string | null;
}

/** Instruções informativas de atraso a partir dos parâmetros (§13). */
export function lateInstructions(amount: number, late: LateChargeParams): { fine: number; interestPerDay: number; lines: string[] } {
  const fine = pct(amount, late.fineBps);
  const interestPerDay = roundDiv(amount * late.interestMonthlyBps, 10000 * 30);
  const lines: string[] = [];
  const after = late.graceDays > 0 ? `Após ${late.graceDays} dia(s) do vencimento` : "Após o vencimento";
  if (late.fineBps > 0 || late.interestMonthlyBps > 0) {
    const parts = [
      late.fineBps > 0 ? `multa de ${formatBps(late.fineBps)} (${formatMoney(fine)})` : null,
      late.interestMonthlyBps > 0 ? `juros de ${formatBps(late.interestMonthlyBps)} ao mês (${formatMoney(interestPerDay)} por dia)` : null,
    ].filter(Boolean);
    lines.push(`${after}, cobrar ${parts.join(" e ")}.`);
  } else lines.push("Sem multa ou juros por atraso.");
  return { fine, interestPerDay, lines };
}

/** Monta as lâminas do carnê (função pura, testável). Parcelas canceladas/renegociadas nunca entram. */
export function buildCarne(input: CarneInput): { slips: CarneSlip[]; sheets: CarneSlip[][] } {
  const live = input.installments
    .filter((i) => i.status !== "cancelled" && i.status !== "renegotiated")
    .filter((i) => !input.onlyOpen || (i.status !== "paid" && i.balance > 0))
    .sort((a, b) => a.number - b.number);
  const t = input.title;
  const documentLabel = t.originType === "sale" && t.documentNumber ? `Venda nº ${t.documentNumber}` : t.documentNumber ? `Doc. ${t.documentNumber}` : t.description;
  const slips: CarneSlip[] = live.map((i) => {
    const paid = i.status === "paid" || i.balance <= 0;
    const base = paid ? i.amount : i.balance;
    const late = lateInstructions(base, input.late);
    const instructions = [...late.lines, "Pagável no estabelecimento até o vencimento. Guarde o canhoto como comprovante."];
    if (input.extraInstruction?.trim()) instructions.push(input.extraInstruction.trim().slice(0, 160));
    const reference = collectionYourNumber(t.number, i.number);
    return {
      installmentId: i.id,
      titleNumber: t.number,
      number: i.number,
      count: t.installmentsCount,
      reference,
      documentLabel,
      dueDate: i.dueDate,
      amount: i.amount,
      balance: paid ? 0 : i.balance,
      paid,
      partial: !paid && i.balance < i.amount,
      ourNumber: i.ourNumber ?? null,
      fine: late.fine,
      interestPerDay: late.interestPerDay,
      instructions,
      pixPayload:
        input.pix && !paid
          ? pixStaticPayload({ key: input.pix.key, merchantName: input.pix.merchantName, merchantCity: input.pix.merchantCity, amount: i.balance, txid: `T${t.number}P${i.number}` })
          : null,
    };
  });
  const sheets: CarneSlip[][] = [];
  for (let k = 0; k < slips.length; k += SLIPS_PER_SHEET) sheets.push(slips.slice(k, k + SLIPS_PER_SHEET));
  return { slips, sheets };
}

/** Endereço em uma linha (json de endereço do cadastro). */
export function addressLine(a: Record<string, any> | null | undefined): string | null {
  if (!a || typeof a !== "object") return null;
  const street = [a.street, a.number].filter(Boolean).join(", ");
  const city = [a.cityName ?? a.city, a.uf].filter(Boolean).join("/");
  const line = [street, a.district, city, a.zip ? `CEP ${a.zip}` : null].filter(Boolean).join(" — ");
  return line || null;
}

/** Carrega o título a receber e monta o carnê (empresa, cliente, parâmetros de atraso, chave Pix da conta). */
export async function loadCarne(ctx: Ctx, titleId: string, opts: { onlyOpen?: boolean } = {}) {
  const title = await ctx.store.get("titles", titleId);
  if (!title || title.companyId !== ctx.companyId || title.kind !== "receivable") return null;
  const [installments, company, branch, accounts] = await Promise.all([
    listAll(ctx.store, "installments", { filters: [["eq", "titleId", titleId]], orderBy: [{ field: "number", dir: "asc" }] }),
    ctx.store.getOrThrow("companies", ctx.companyId),
    title.branchId ? ctx.store.get("branches", title.branchId) : Promise.resolve(null),
    listAll(ctx.store, "financial_accounts", { filters: [["eq", "companyId", ctx.companyId], ["eq", "active", true]] }),
  ]);
  const customer: Doc | null = title.partyType === "customer" && title.partyId ? await ctx.store.get("customers", title.partyId) : null;
  const late = await lateChargeParams(ctx.store, ctx.companyId, title.branchId ?? ctx.branchId);
  // conta com chave Pix: a da filial do título primeiro, depois bancos/carteiras da empresa
  const withPix = accounts.filter((a) => a.pixKey && String(a.pixKey).trim());
  const pixAcc = withPix.find((a) => a.branchId && a.branchId === title.branchId) ?? withPix.find((a) => a.kind !== "cash") ?? withPix[0] ?? null;
  const companyAddr = addressLine(branch?.address ?? company.address);
  const cityName = branch?.cityName ?? branch?.address?.cityName ?? company.address?.cityName ?? "";
  const custAddr = Array.isArray(customer?.addresses) ? (customer!.addresses.find((x: any) => x?.main || x?.isDefault || x?.primary) ?? customer!.addresses[0]) : null;
  const carne = buildCarne({
    company: { name: company.name, tradeName: company.tradeName, cnpj: branch?.cnpj ?? company.cnpj, address: companyAddr, phone: branch?.phone ?? company.phone },
    title: { id: title.id, number: title.number, description: title.description, documentNumber: title.documentNumber, installmentsCount: title.installmentsCount, originType: title.originType },
    installments: installments.map((i) => ({ id: i.id, number: i.number, dueDate: i.dueDate, amount: i.amount, balance: i.balance, status: i.status, ourNumber: i.ourNumber ?? null })),
    late,
    pix: pixAcc ? { key: String(pixAcc.pixKey).trim(), merchantName: company.tradeName || company.name, merchantCity: cityName } : null,
    onlyOpen: opts.onlyOpen,
  });
  const party: CarneParty = {
    name: customer?.name ?? title.partyName ?? "—",
    doc: customer?.doc ?? null,
    address: addressLine(custAddr),
    phone: customer?.mobile ?? customer?.phone ?? null,
  };
  return {
    title,
    company: { name: company.name, tradeName: company.tradeName ?? null, cnpj: branch?.cnpj ?? company.cnpj ?? null, address: companyAddr, phone: branch?.phone ?? company.phone ?? null } as CarneCompany,
    party,
    late,
    pixAccountName: pixAcc?.name ?? null,
    ...carne,
    dueRange: carne.slips.length ? `${formatDate(carne.slips[0].dueDate)} a ${formatDate(carne.slips[carne.slips.length - 1].dueDate)}` : null,
  };
}
