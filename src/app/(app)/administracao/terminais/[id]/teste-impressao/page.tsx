import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { formatDoc } from "@/lib/core/text";
import { formatDateTime, nowIso } from "@/lib/dates";
import { PrintTest } from "./print-test";

export const metadata = { title: "Página de teste de impressão" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession("admin");
  const { id } = await params;
  const t = await s.ctx.store.get("terminals", id);
  if (!t || t.companyId !== s.ctx.companyId) notFound();
  const branch = await s.ctx.store.get("branches", t.branchId);
  const width = t.paperWidth === 58 ? 58 : 80;
  const cols = width === 58 ? 32 : 48;
  const line = "-".repeat(cols);
  const row = (l: string, r: string) => `${l}${" ".repeat(Math.max(1, cols - l.length - r.length))}${r}`;
  return (
    <>
      <div className="no-print">
        <PageHeader title={`Teste de impressão — ${t.name}`} crumbs={[{ label: "Administração" }, { label: "Terminais", href: "/administracao/terminais" }, { label: t.name, href: `/administracao/terminais/${id}` }, { label: "Teste de impressão" }]} description={`Papel ${width} mm (${cols} colunas) · modo ${t.printerMode === "connector" ? "conector local" : "navegador"}.`} />
      </div>
      <PrintTest id={id} width={width} cols={cols}>
        <pre className="whitespace-pre">
          {[
            (s.company.tradeName || s.company.name).toUpperCase().slice(0, cols),
            branch?.name?.slice(0, cols) ?? "",
            branch?.cnpj ? `CNPJ ${formatDoc(branch.cnpj)}` : "",
            line,
            "PÁGINA DE TESTE — SEM VALOR FISCAL",
            line,
            row("Terminal", t.code),
            row("Série NFC-e", String(t.nfceSeries ?? "-")),
            row("Papel", `${width} mm / ${cols} col`),
            row("Data", formatDateTime(nowIso())),
            line,
            row("1 x Produto de teste", "10,00"),
            row("2 x Item com acentuação ÁÉÍÓÚ ç", "5,90"),
            row("Desconto", "-0,90"),
            line,
            row("TOTAL R$", "20,90"),
            line,
            "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, cols),
            "Régua: " + "1234567890".repeat(5).slice(0, cols - 7),
            "A régua acima deve caber em 1 linha.",
          ]
            .filter((x) => x !== "")
            .join("\n")}
        </pre>
        <div className="mt-2 flex justify-center">
          <svg width="160" height="40" viewBox="0 0 160 40" aria-label="Código de barras de teste">
            {Array.from({ length: 40 }).map((_, i) => (
              <rect key={i} x={i * 4} y={0} width={(i * 7) % 3 === 0 ? 3 : 1.5} height={40} fill="black" />
            ))}
          </svg>
        </div>
        <p className="mt-1 text-center">*** fim do teste ***</p>
      </PrintTest>
    </>
  );
}
