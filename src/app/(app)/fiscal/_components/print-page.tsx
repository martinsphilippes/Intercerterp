import { notFound, redirect } from "next/navigation";
import { listAll } from "@/lib/db";
import { requireSession } from "@/lib/server/session";
import { audit } from "@/lib/core/audit";
import { Danfce, Danfe, Danfse, printStamp } from "./print-docs";
import { PrintToolbar } from "./print-toolbar";

/** Página de impressão compartilhada (DANFE A4 / DANFCE 80 mm / DANFSE) — usada também pelas telas de venda. */
export async function PrintPage({ model, id }: { model: "nfe" | "nfce" | "nfse"; id: string }) {
  const s = await requireSession("fiscal");
  const doc = await s.ctx.store.get("fiscal_documents", id);
  if (!doc || doc.companyId !== s.ctx.companyId) notFound();
  if (doc.model !== model) redirect(`/fiscal/${doc.model}/${id}/imprimir`);
  const company = await s.ctx.store.getOrThrow("companies", doc.companyId);
  const branch = doc.branchId ? await s.ctx.store.get("branches", doc.branchId) : null;
  const stamp = printStamp(doc);
  if (["authorized", "cancelled"].includes(doc.status)) await audit(s.ctx, { module: "fiscal", action: "document.print", entityType: "fiscal_document", entityId: doc.id, summary: `${model.toUpperCase()} ${doc.number ?? doc.ref} impressa/reimpressa${stamp ? ` (${stamp})` : ""}` });
  const page = model === "nfce" ? "@page { size: 80mm auto; margin: 2mm; }" : "@page { size: A4; margin: 6mm; }";
  let body: React.ReactNode;
  if (model === "nfce") {
    const sale = doc.originType === "sale" && doc.originId ? await s.ctx.store.get("sales", doc.originId) : null;
    const payments = sale ? await listAll(s.ctx.store, "sale_payments", { filters: [["eq", "saleId", sale.id]] }) : [];
    const operator = doc.operatorId ? await s.ctx.store.get("users", doc.operatorId) : null;
    const terminal = doc.terminalId ? await s.ctx.store.get("terminals", doc.terminalId) : null;
    body = await Danfce({ doc, company, branch, sale, payments, operator, terminal });
  } else if (model === "nfse") body = <Danfse doc={doc} company={company} branch={branch} />;
  else body = <Danfe doc={doc} company={company} branch={branch} />;
  return (
    <>
      <style>{`${page} @media print { .lg\\:pl-64 { padding-left: 0 !important; } main { padding: 0 !important; max-width: none !important; } body { background: #fff !important; } }`}</style>
      <PrintToolbar back={`/fiscal/${model}/${id}`} providerPdf={!doc.isSimulated && doc.status === "authorized" ? doc.danfeUrl : null} note={stamp ? `Tarja: ${stamp}` : model === "nfce" ? "Impressão 80 mm pelo navegador" : "Impressão A4 pelo navegador"} />
      <div className="overflow-x-auto rounded-lg border border-line bg-slate-100 p-4 print:border-0 print:bg-white print:p-0">{body}</div>
    </>
  );
}
