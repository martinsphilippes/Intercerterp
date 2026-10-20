import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { canDo } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { addMonths, formatDate, formatDateTime, formatMonth, monthStart, today } from "@/lib/dates";
import { formatDoc } from "@/lib/core/text";
import { BusinessError } from "@/lib/core/errors";
import { sp, type SearchParams } from "@/lib/list";
import { buildSintegra, sintegraHistory, SINTEGRA_FINALIDADES, SINTEGRA_NATUREZAS, type SintegraResult } from "@/domain/fiscal/files/sintegra";
import { readSintegraParams, toSintegraOptions } from "./params";
import { GenerateSintegraForm } from "./forms";

export const metadata = { title: "Sintegra" };

const RECORD_LABEL: Record<string, string> = {
  "10": "Mestre do estabelecimento",
  "11": "Dados complementares",
  "50": "Total de NF-e por CFOP e alíquota (ICMS)",
  "51": "Total de NF-e quanto ao IPI",
  "53": "Substituição tributária",
  "54": "Itens das NF-e (e frete/seguro/outras: 991/992/999)",
  "61": "NFC-e — resumo diário",
  "61R": "NFC-e — resumo mensal por produto",
  "70": "CT-e de entrada",
  "74": "Inventário",
  "75": "Código de produto",
  "90": "Totalização do arquivo",
};
const SITUATION_LABEL: Record<string, string> = { N: "Normal", S: "Cancelada", "2": "Denegada", "4": "Inutilizada" };
const SITUATION_TONE: Record<string, "good" | "bad" | "warn" | "neutral"> = { N: "good", S: "bad", "2": "warn", "4": "neutral" };

/** Fiscal › Sintegra (Convênio ICMS 57/95): prévia com pendências e contagem por registro, geração e histórico. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("fiscal");
  await requireFeaturePage(s, "arquivosFiscais");
  if (!canDo(s.user, "fiscal.files")) notFound();
  const params = await searchParams;
  const branches = s.branch ? [s.branch] : s.branches;
  const p = readSintegraParams((k) => sp(params, k), s.branch?.id ?? branches[0]?.id ?? "");
  if (s.branch) p.branchId = s.branch.id;
  let r: SintegraResult | null = null;
  let problem: string | null = null;
  if (p.branchId) {
    try {
      r = await buildSintegra(s.ctx, toSintegraOptions(p));
    } catch (e) {
      if (!(e instanceof BusinessError)) throw e;
      problem = e.message;
    }
  }
  const history = await sintegraHistory(s.ctx, { branchId: s.branch?.id ?? null });
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? s.branches.find((b) => b.id === id)?.name ?? "—";
  const hidden: Record<string, string> = {
    filial: p.branchId,
    periodo: p.period,
    finalidade: p.finalidade,
    natureza: p.natureza,
    inventario: p.withInventory ? "1" : "",
    database: p.inventoryDate,
    nfce: p.nfce,
    ipi: p.ipi ? "1" : "",
    contato: p.contact,
  };
  const prev = addMonths(monthStart(today()), -1).slice(0, 7);
  const errors = r?.pendencies.filter((x) => x.level === "error") ?? [];
  const warnings = r?.pendencies.filter((x) => x.level === "warning") ?? [];
  const order = ["10", "11", "50", "51", "53", "54", "61", "61R", "70", "74", "75", "90"];
  const inp = "focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm";
  const lbl = "flex flex-col gap-1 text-xs font-medium text-slate-600";
  return (
    <>
      <PageHeader
        title="Sintegra (Convênio ICMS 57/95)"
        crumbs={[{ label: "Fiscal" }, { label: "Arquivos fiscais" }, { label: "Sintegra" }]}
        description="Arquivo magnético por estabelecimento e mês: NF-e emitidas e recebidas (50/51/53/54), NFC-e (61/61R, opcional), CT-e de entrada (70), inventário (74), produtos (75) e totalização (90). Prévia com pendências antes de gerar."
      />
      <Notice tone="warn" title="Valide antes do primeiro envio">
        Valide o arquivo no validador Sintegra da sua UF e com a contabilidade antes do primeiro envio. Regras assumidas e fontes: docs/regras-assumidas.md §42.
      </Notice>
      <div className="no-print my-4 rounded-lg border border-line bg-white p-3">
        <form method="get" action="/fiscal/arquivos/sintegra" className="flex flex-wrap items-end gap-3">
          <label className={`${lbl} min-w-[200px]`}>
            Estabelecimento
            {s.branch ? (
              <input disabled value={s.branch.name} className={`${inp} bg-slate-50`} aria-label="Estabelecimento (filial atual)" />
            ) : (
              <select name="filial" defaultValue={p.branchId} className={inp}>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className={lbl}>
            Período (mês)
            <input type="month" name="periodo" defaultValue={p.period} max={today().slice(0, 7)} className={inp} />
          </label>
          <label className={`${lbl} min-w-[220px]`}>
            Finalidade
            <select name="finalidade" defaultValue={p.finalidade} className={inp}>
              {SINTEGRA_FINALIDADES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className={`${lbl} min-w-[240px]`}>
            Natureza das operações
            <select name="natureza" defaultValue={p.natureza} className={inp}>
              {SINTEGRA_NATUREZAS.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
          <label className={lbl}>
            NFC-e (61/61R)
            <select name="nfce" defaultValue={p.nfce} className={inp}>
              <option value="">Conforme parâmetro{r ? ` (${r.options.includeNfce ? "incluir" : "não incluir"})` : ""}</option>
              <option value="1">Incluir</option>
              <option value="0">Não incluir</option>
            </select>
          </label>
          <fieldset className="flex items-end gap-2">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="inventario" value="1" defaultChecked={p.withInventory} /> Incluir inventário (74)
            </label>
            <label className={lbl}>
              Data-base
              <input type="date" name="database" defaultValue={p.inventoryDate} max={today()} className={inp} />
            </label>
          </fieldset>
          <label className="flex h-9 items-center gap-2 text-sm" title="Somente contribuinte do IPI (indústria/equiparado) informa o registro 51">
            <input type="checkbox" name="ipi" value="1" defaultChecked={p.ipi} /> Contribuinte do IPI (51)
          </label>
          <label className={`${lbl} min-w-[180px]`}>
            Contato (registro 11)
            <input name="contato" defaultValue={p.contact} placeholder={s.user.name} maxLength={60} className={inp} />
          </label>
          <button type="submit" className={buttonClass("primary")}>
            Ver prévia
          </button>
          <Link href={`/fiscal/arquivos/sintegra?periodo=${prev}`} className={buttonClass("ghost", "sm")}>
            Mês anterior
          </Link>
        </form>
        <p className="mt-2 text-xs text-slate-500">Inventário: normalmente informado no arquivo de fevereiro (ou janeiro, conforme a UF) com a data-base de 31/12 do ano anterior.</p>
      </div>

      {problem && <Notice tone="bad">{problem}</Notice>}
      {!p.branchId && <EmptyState title="Selecione um estabelecimento" description="O Sintegra é gerado por estabelecimento (filial com CNPJ e inscrição estadual)." />}

      {r && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Registros (linhas)" value={r.totalLines} hint={`${branchName(r.options.branchId)} · ${formatMonth(r.options.period)}`} />
            <Stat label="Documentos" value={r.documents.length} hint={`${r.documents.filter((d) => d.direction === "out").length} saída(s) · ${r.documents.filter((d) => d.direction === "in").length} entrada(s)`} />
            <Stat label="Pendências bloqueantes" value={errors.length} tone={errors.length ? "bad" : "good"} hint={errors.length ? "Corrija antes de gerar" : "Nenhuma"} />
            <Stat label="Avisos" value={warnings.length} tone={warnings.length ? "warn" : "good"} />
            <Stat label="Inventário (74)" value={r.inventory ? formatMoney(r.inventory.value) : "—"} hint={r.inventory ? `${r.inventory.items} produto(s) em ${formatDate(r.inventory.date)}` : "Não incluído"} />
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-[1fr_2fr]">
            <Card title="Contagem por registro" bodyClass="p-0">
              <table className="table-base w-full text-sm">
                <thead>
                  <tr>
                    <th>Registro</th>
                    <th>Conteúdo</th>
                    <th className="text-right">Linhas</th>
                  </tr>
                </thead>
                <tbody>
                  {order
                    .filter((t) => r!.counts[t])
                    .map((t) => (
                      <tr key={t}>
                        <td className="tabular font-medium">{t}</td>
                        <td>{RECORD_LABEL[t]}</td>
                        <td className="tabular text-right">{r!.counts[t]}</td>
                      </tr>
                    ))}
                  <tr>
                    <td colSpan={2} className="font-semibold">
                      Total (registro 90, tipo 99)
                    </td>
                    <td className="tabular text-right font-semibold">{r.totalLines}</td>
                  </tr>
                </tbody>
              </table>
              <p className="border-t border-line px-4 py-2 text-xs text-slate-500">
                Conferência interna: {r.checks.docs} NF-e com total do 50 = soma dos 54{r.checks.mismatches ? ` — ${r.checks.mismatches} divergente(s)` : " (todas conferem)"}.{" "}
                {r.nfce.included ? `${r.nfce.docs} NFC-e incluída(s).` : "NFC-e fora do arquivo."}
              </p>
            </Card>
            <Card title="Pendências" description="Bloqueantes impedem a geração (salvo confirmação); avisos explicam o que ficou de fora ou foi assumido." bodyClass="p-0">
              {r.pendencies.length === 0 ? (
                <p className="px-4 py-3 text-sm text-emerald-700">Nenhuma pendência encontrada.</p>
              ) : (
                <ul className="max-h-[420px] divide-y divide-line overflow-y-auto text-sm">
                  {[...errors, ...warnings].map((x, i) => (
                    <li key={i} className="flex items-start gap-2 px-4 py-2">
                      <Badge tone={x.level === "error" ? "bad" : "warn"}>{x.level === "error" ? "Bloqueante" : "Aviso"}</Badge>
                      <span className="min-w-0 flex-1">
                        {x.message}
                        {x.href && (
                          <>
                            {" "}
                            <Link href={x.href} className="text-brand-700 hover:underline">
                              abrir
                            </Link>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card title="Gerar arquivo" className="mb-4">
            <GenerateSintegraForm params={hidden} errors={errors.length} />
            <p className="mt-2 text-xs text-slate-500">
              Arquivo texto de largura fixa (126 posições por linha, CR/LF, ASCII sem acentos), guardado em Arquivos com histórico. Mesmo período e mesmos dados geram o mesmo arquivo (gerar de novo devolve o último). O último arquivo do mês entra no pacote da contabilidade (pasta “sintegra”).
            </p>
          </Card>

          <Card title="Documentos no arquivo" description={r.documents.length > 100 ? `Primeiros 100 de ${r.documents.length}.` : undefined} bodyClass="p-0" className="mb-4">
            {r.documents.length === 0 ? (
              <EmptyState title="Nenhum documento no período" description="Não há NF-e emitidas, entradas concluídas nem CT-e no recorte escolhido." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Documento</th>
                      <th>Modelo/série</th>
                      <th>Participante</th>
                      <th>UF</th>
                      <th>Situação</th>
                      <th className="text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.documents.slice(0, 100).map((d) => (
                      <tr key={d.key}>
                        <td className="whitespace-nowrap">{formatDate(d.date)}</td>
                        <td>
                          {d.href ? (
                            <Link href={d.href} className="text-brand-700 hover:underline">
                              {d.label}
                            </Link>
                          ) : (
                            d.label
                          )}
                          <span className="block text-xs text-slate-500">{d.direction === "out" ? "Emitida pela empresa" : "Entrada"}</span>
                        </td>
                        <td className="tabular">
                          {d.model}/{d.series || "—"}
                        </td>
                        <td>
                          {d.participant}
                          <span className="block text-xs text-slate-500">{d.participantDoc ? formatDoc(d.participantDoc) : "sem CNPJ/CPF"}</span>
                        </td>
                        <td>{d.uf || "—"}</td>
                        <td>
                          <Badge tone={SITUATION_TONE[d.situation] ?? "neutral"}>{SITUATION_LABEL[d.situation] ?? d.situation}</Badge>
                        </td>
                        <td className="tabular text-right">{formatMoney(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Prévia do arquivo" description={r.lines.length > 40 ? `Primeiras 40 de ${r.lines.length} linhas.` : undefined} bodyClass="p-0" className="mb-4">
            <pre className="overflow-x-auto bg-slate-50 p-3 text-[11px] leading-5 text-slate-700">{r.lines.slice(0, 40).join("\n")}</pre>
          </Card>
        </>
      )}

      <Card title="Arquivos gerados" bodyClass="p-0">
        {history.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">Nenhum arquivo Sintegra gerado ainda.</p>
        ) : (
          <table className="table-base w-full text-sm">
            <thead>
              <tr>
                <th>Arquivo</th>
                <th>Estabelecimento</th>
                <th>Período</th>
                <th>Finalidade</th>
                <th>Gerado em</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>
                    <a className="text-brand-700 hover:underline" href={`/api/files/${h.id}`}>
                      {h.name}
                    </a>
                  </td>
                  <td>{branchName(h.branchId)}</td>
                  <td>{h.period ? formatMonth(h.period) : "—"}</td>
                  <td>{SINTEGRA_FINALIDADES.find((f) => f.value === h.finalidade)?.label ?? h.finalidade}</td>
                  <td className="whitespace-nowrap">{formatDateTime(h.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
