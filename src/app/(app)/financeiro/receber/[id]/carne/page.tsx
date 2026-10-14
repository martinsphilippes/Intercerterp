import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { requireSession } from "@/lib/server/session";
import { featureOn } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/core/audit";
import { formatDoc, formatPhone } from "@/lib/core/text";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { sp, type SearchParams } from "@/lib/list";
import { loadCarne, SLIPS_PER_SHEET, type CarneCompany, type CarneParty, type CarneSlip } from "@/domain/carne";
import { CarneControls } from "./carne-controls";

export const metadata = { title: "Carnê de pagamento" };

/**
 * Carnê do título a receber (FIN-06): uma lâmina por parcela com canhoto, 3 por folha A4 (impressão pelo navegador em
 * escala 100%). `?print=1` abre o diálogo de impressão; `?abertas=1` imprime só as parcelas em aberto.
 * Acesso: Financeiro, ou Vendas quando o título é de venda a prazo (o caixa imprime o carnê na conclusão da venda).
 */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const s = await requireSession();
  const { id } = await params;
  const q = await searchParams;
  if (!(await featureOn(s, "carne"))) notFound();
  const onlyOpen = sp(q, "abertas") === "1";
  const data = await loadCarne(s.ctx, id, { onlyOpen });
  if (!data) notFound();
  const canSee = can(s.user, "finance", "view") || (data.title.originType === "sale" && can(s.user, "sales", "view"));
  if (!canSee) notFound();
  const branchOk = !s.ctx.branchId || !data.title.branchId || data.title.branchId === s.ctx.branchId || can(s.user, "finance", "view");
  if (!branchOk) notFound();
  const print = sp(q, "print") === "1";
  const back = can(s.user, "finance", "view") ? `/financeiro/receber/${id}` : data.title.originId ? `/vendas/${data.title.originId}` : "/vendas";
  const self = (extra: Record<string, string>) => `/financeiro/receber/${id}/carne?${new URLSearchParams(extra).toString()}`;
  if (print && data.slips.length) {
    await audit(s.ctx, { module: "finance", action: "title.carne_print", entityType: "title", entityId: id, summary: `Carnê do título nº ${data.title.number} impresso (${data.slips.length} lâmina(s)${onlyOpen ? ", somente em aberto" : ""})` });
  }
  const qrs = new Map<string, string>();
  for (const sl of data.slips) if (sl.pixPayload) qrs.set(sl.installmentId, await QRCode.toString(sl.pixPayload, { type: "svg", margin: 0, width: 110 }));
  const note = [
    `${data.slips.length} lâmina(s) · ${data.sheets.length} folha(s) A4 (${SLIPS_PER_SHEET} por folha) · imprima em escala 100%`,
    data.pixAccountName ? `Pix pela chave da conta ${data.pixAccountName} (copia e cola estático; baixa manual)` : "Sem chave Pix cadastrada nas contas financeiras",
  ].join(" · ");
  return (
    <>
      <div className="no-print">
        <PageHeader
          title={`Carnê — título nº ${data.title.number}`}
          crumbs={[{ label: "Contas a receber", href: "/financeiro/receber" }, { label: `nº ${data.title.number}`, href: back }, { label: "Carnê" }]}
          description={`${data.party.name} · ${data.title.description}${data.dueRange ? ` · vencimentos de ${data.dueRange}` : ""}`}
        />
      </div>
      <CarneControls back={back} auto={print && data.slips.length > 0} note={note} toggle={onlyOpen ? { href: self({}), label: "Todas as parcelas" } : { href: self({ abertas: "1" }), label: "Somente em aberto" }} />
      {data.slips.length === 0 ? (
        <EmptyState title="Nenhuma parcela para o carnê" description={onlyOpen ? "Todas as parcelas deste título estão quitadas." : "O título não tem parcelas ativas (canceladas ou renegociadas não entram)."} />
      ) : (
        <>
          <style>{`@page { size: A4; margin: 6mm; } @media print { .lg\\:pl-64 { padding-left: 0 !important; } main { padding: 0 !important; max-width: none !important; } body { background: #fff !important; } .carne-sheet { break-after: page; box-shadow: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important; } .carne-sheet:last-child { break-after: auto; } }`}</style>
          <div className="overflow-x-auto rounded-lg border border-line bg-slate-100 p-4 print:overflow-visible print:border-0 print:bg-white print:p-0">
            {data.sheets.map((sheet, n) => (
              <div key={n} className="carne-sheet mx-auto mb-4 w-[198mm] bg-white shadow-sm">
                {sheet.map((sl) => (
                  <Slip key={sl.installmentId} slip={sl} company={data.company} party={data.party} qr={qrs.get(sl.installmentId) ?? null} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Slip({ slip, company, party, qr }: { slip: CarneSlip; company: CarneCompany; party: CarneParty; qr: string | null }) {
  const name = company.tradeName || company.name;
  const value = slip.paid ? slip.amount : slip.balance;
  return (
    <section className="relative flex h-[93mm] overflow-hidden border-b border-dashed border-slate-500 text-[8pt] leading-tight text-black last:border-b-0" aria-label={`Parcela ${slip.number} de ${slip.count}`}>
      {/* canhoto (via da loja) */}
      <div className="flex w-[52mm] shrink-0 flex-col gap-[1.5mm] border-r border-dashed border-slate-500 p-[3mm]">
        <p className="text-[7pt] font-semibold uppercase tracking-wide">Canhoto — via da loja</p>
        <p className="truncate font-semibold">{name}</p>
        <Info label="Título / parcela" value={`nº ${slip.titleNumber} · ${slip.number}/${slip.count}`} />
        <Info label="Cliente" value={party.name} />
        <Info label="Vencimento" value={formatDate(slip.dueDate)} strong />
        <Info label="Valor" value={formatMoney(value)} strong />
        <div className="mt-auto space-y-[3mm] text-[7pt]">
          <p>Pago em ____/____/________</p>
          <p>Valor pago R$ ______________</p>
          <p className="border-t border-black pt-[0.5mm] text-center">Recebido por</p>
        </div>
      </div>
      {/* via do cliente */}
      <div className="flex min-w-0 flex-1 flex-col p-[3mm]">
        <header className="flex items-start justify-between gap-[2mm] border-b border-black pb-[1.5mm]">
          <div className="min-w-0">
            <p className="truncate text-[10pt] font-bold">{name}</p>
            <p className="truncate text-[7pt]">
              {company.name !== name ? `${company.name} · ` : ""}
              {company.cnpj ? `CNPJ ${formatDoc(company.cnpj)}` : ""}
              {company.phone ? ` · ${formatPhone(company.phone)}` : ""}
            </p>
            {company.address && <p className="truncate text-[7pt]">{company.address}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[9pt] font-bold uppercase">Carnê de pagamento</p>
            <p className="text-[9pt]">
              Parcela <b>{slip.number}</b> de {slip.count}
            </p>
          </div>
        </header>
        <div className="mt-[1.5mm] grid grid-cols-4 gap-x-[2mm] gap-y-[1.5mm]">
          <Info label="Cliente" value={`${party.name}${party.doc ? ` — ${formatDoc(party.doc)}` : ""}`} className="col-span-3" />
          <Info label="Nº do documento" value={slip.reference} />
          <Info label="Referente a" value={slip.documentLabel} className="col-span-2" />
          <Info label="Nosso número" value={slip.ourNumber ?? "—"} />
          <Info label="Título" value={`nº ${slip.titleNumber}`} />
          {party.address && <Info label="Endereço" value={party.address} className="col-span-4" />}
        </div>
        <div className="mt-[2mm] flex min-h-0 flex-1 gap-[3mm]">
          <div className="min-w-0 flex-1">
            <div className="grid grid-cols-2 gap-[2mm]">
              <div className="rounded-[1mm] border border-black px-[2mm] py-[1mm]">
                <p className="text-[6.5pt] uppercase">Vencimento</p>
                <p className="tabular text-[13pt] font-extrabold">{formatDate(slip.dueDate)}</p>
              </div>
              <div className="rounded-[1mm] border border-black px-[2mm] py-[1mm] text-right">
                <p className="text-[6.5pt] uppercase">{slip.partial ? "Saldo a pagar" : "Valor da parcela"}</p>
                <p className="tabular text-[13pt] font-extrabold">{formatMoney(value)}</p>
                {slip.partial && <p className="text-[6.5pt]">valor original {formatMoney(slip.amount)}</p>}
              </div>
            </div>
            <p className="mt-[1.5mm] text-[6.5pt] font-semibold uppercase">Instruções</p>
            <ul className="mt-[0.5mm] list-disc space-y-[0.5mm] pl-[4mm] text-[7.5pt]">
              {slip.instructions.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
          {qr && slip.pixPayload && (
            <div className="flex w-[34mm] shrink-0 flex-col items-center">
              <p className="text-[7pt] font-semibold">Pague com Pix</p>
              <div className="mt-[0.5mm] size-[27mm]" dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="mt-[0.5mm] line-clamp-3 break-all text-center font-mono text-[4.5pt] leading-[1.15]">{slip.pixPayload}</p>
            </div>
          )}
        </div>
        <p className="mt-[1mm] text-right text-[6.5pt]">Via do cliente</p>
      </div>
      {slip.paid && (
        <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded border-4 border-emerald-700 px-[4mm] py-[1mm] text-[20pt] font-extrabold tracking-widest text-emerald-700 opacity-60">QUITADA</span>
      )}
    </section>
  );
}

function Info({ label, value, strong, className }: { label: string; value: string; strong?: boolean; className?: string }) {
  return (
    <div className={`min-w-0 ${className ?? ""}`}>
      <p className="text-[6.5pt] uppercase text-slate-600">{label}</p>
      <p className={`truncate ${strong ? "tabular text-[10pt] font-bold" : ""}`}>{value}</p>
    </div>
  );
}
