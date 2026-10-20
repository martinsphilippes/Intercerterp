import Link from "@/components/ui/link";
import { notFound } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { requireFeaturePage } from "@/lib/server/features";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState, Notice } from "@/components/ui/empty";
import { can, canDo } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { qs, type SearchParams } from "@/lib/list";
import { lookups } from "@/lib/server/lookups";
import { BusinessError } from "@/lib/core/errors";
import { buildFiscalFile, fiscalFileHistory, FILE_KIND_LABEL, type FiscalFileBuild } from "@/domain/fiscal/files/service";
import { GenerateFileForm } from "./forms";
import { filesQuery, toRequest } from "./params";

export const metadata = { title: "Arquivos fiscais" };

const BLOCK_LABEL: Record<string, string> = {
  "0": "Abertura e cadastros",
  A: "Serviços (ISS)",
  B: "ISS (DF)",
  C: "Mercadorias",
  D: "Transporte",
  E: "Apuração do ICMS",
  F: "Demais documentos",
  G: "CIAP",
  H: "Inventário",
  I: "Instituições financeiras",
  K: "Produção e estoque",
  M: "Apuração PIS/COFINS",
  P: "Contribuição previdenciária",
  "1": "Outras informações",
  "9": "Controle e encerramento",
};

const inputCls = "focus-ring h-9 rounded-md border border-line bg-white px-3 text-sm";
const labelCls = "flex flex-col gap-1 text-xs font-medium text-slate-600";

/**
 * §41 — Arquivos fiscais: EFD ICMS/IPI (SPED Fiscal) por estabelecimento e EFD Contribuições da empresa. Prévia com
 * pendências e totais, geração (guardada em Arquivos) e histórico. Validar no PVA da Receita e com a contabilidade.
 */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("fiscal");
  await requireFeaturePage(s, "arquivosFiscais");
  if (!canDo(s.user, "fiscal.files")) notFound();
  const params = await searchParams;
  const branches = await lookups.branches(s.ctx);
  const q = filesQuery(params, s.ctx.branchId ?? branches[0]?.value ?? null);
  let build: FiscalFileBuild | null = null;
  let failure: string | null = null;
  try {
    build = await buildFiscalFile(s.ctx, toRequest(q));
  } catch (e) {
    if (!(e instanceof BusinessError)) throw e;
    failure = e.message;
  }
  const history = await fiscalFileHistory(s.ctx);
  const errors = build?.pendencies.filter((p) => p.severity === "error") ?? [];
  const warnings = build?.pendencies.filter((p) => p.severity === "warning") ?? [];
  const values: Record<string, string> = { arquivo: q.kind, periodo: q.period, filial: q.branchId ?? "", finalidade: q.finality, inventario: q.inventory, saldo: q.carry, recibo: q.previousReceipt };
  const branchName = (id: string | null) => (id ? (branches.find((b) => b.value === id)?.label ?? "—") : "Empresa (todos os estabelecimentos)");
  const sped = q.kind === "sped_fiscal";
  return (
    <>
      <PageHeader
        title="Arquivos fiscais"
        crumbs={[{ label: "Fiscal" }, { label: "Arquivos fiscais" }]}
        description="EFD ICMS/IPI (SPED Fiscal) por estabelecimento e EFD Contribuições (PIS/COFINS) da empresa, montadas a partir dos documentos emitidos, das entradas (recebimentos e CT-e) e do inventário em data-base."
        actions={
          can(s.user, "admin", "view") ? (
            <Link href="/administracao/parametros" className={buttonClass("secondary")}>
              <SlidersHorizontal className="size-4" aria-hidden /> Parâmetros (perfil, contabilista, recolhimento)
            </Link>
          ) : null
        }
      />
      <p className="mb-2 text-sm text-slate-600">
        O arquivo do Sintegra (Convênio ICMS 57/95) fica em{" "}
        <Link className="text-brand-700 hover:underline" href="/fiscal/arquivos/sintegra">
          Fiscal › Sintegra
        </Link>
        .
      </p>
      <Notice tone="warn" title="Validar antes do primeiro envio">
        Arquivo gerado a partir dos dados do sistema: valide no PVA da Receita Federal e com a contabilidade antes do primeiro envio. Regras e hipóteses em docs/regras-assumidas.md (§41).
      </Notice>
      <div className="no-print my-4 rounded-lg border border-line bg-white p-3">
        <form method="get" action="/fiscal/arquivos" className="flex flex-wrap items-end gap-3">
          <label className={labelCls}>
            Arquivo
            <select name="arquivo" defaultValue={q.kind} className={inputCls}>
              <option value="sped_fiscal">{FILE_KIND_LABEL.sped_fiscal}</option>
              <option value="efd_contribuicoes">{FILE_KIND_LABEL.efd_contribuicoes}</option>
            </select>
          </label>
          <label className={labelCls}>
            Estabelecimento (SPED Fiscal)
            <select name="filial" defaultValue={q.branchId ?? ""} className={`${inputCls} min-w-[180px]`}>
              {branches.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            Período
            <input type="month" name="periodo" defaultValue={q.period} className={inputCls} />
          </label>
          <label className={labelCls}>
            Finalidade
            <select name="finalidade" defaultValue={q.finality} className={inputCls}>
              <option value="original">Original</option>
              <option value="retificadora">Retificadora (substituta)</option>
            </select>
          </label>
          <label className={labelCls}>
            Inventário (bloco H)
            <input type="text" name="inventario" defaultValue={q.inventory} placeholder="padrão" title="Vazio = padrão (31/12 do ano anterior no arquivo de fevereiro); 'none' = sem inventário; ou AAAA-MM-DD" className={`${inputCls} w-32`} />
          </label>
          <label className={labelCls}>
            Saldo credor anterior
            <input type="text" name="saldo" defaultValue={q.carry} placeholder="do mês anterior" className={`${inputCls} w-32`} />
          </label>
          <label className={labelCls}>
            Recibo anterior (retificadora)
            <input type="text" name="recibo" defaultValue={q.previousReceipt} className={`${inputCls} w-40`} />
          </label>
          <button type="submit" className={buttonClass("primary")}>
            Ver prévia
          </button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Inventário: vazio = padrão (31/12 do ano anterior no arquivo de fevereiro), “none” = sem inventário, ou uma data AAAA-MM-DD. A EFD Contribuições reúne todos os estabelecimentos (a matriz centraliza).</p>
      </div>

      {failure && <Notice tone="bad">{failure}</Notice>}
      {build?.blocked && <Notice tone="bad" title="Arquivo não aplicável">{build.blocked}</Notice>}

      {build && !build.blocked && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Linhas do arquivo" value={build.lines.length} hint={`${build.entityLabel} · ${build.period.slice(5, 7)}/${build.period.slice(0, 4)}`} />
            <Stat label="Documentos" value={build.docs.issued + build.docs.entries + build.docs.ctes + build.docs.services} hint={`${build.docs.issued} emitidos · ${build.docs.entries} entradas · ${build.docs.ctes} CT-e · ${build.docs.services} NFS-e · ${build.docs.cancelled} cancel./deneg. · ${build.docs.disabled} inutil.`} />
            {sped && build.apuracao ? (
              <>
                <Stat label="Débitos × créditos (ICMS)" value={`${formatMoney(build.apuracao.debits)} × ${formatMoney(build.apuracao.credits)}`} hint={`Saldo anterior ${formatMoney(build.apuracao.creditCarry)}`} />
                <Stat label="ICMS a recolher" value={formatMoney(build.apuracao.toPay)} tone={build.apuracao.toPay ? "warn" : "good"} hint={`Saldo credor a transportar ${formatMoney(build.apuracao.carryOut)}${build.inventoryDate ? ` · inventário de ${formatDate(build.inventoryDate)}` : ""}`} />
              </>
            ) : build.contrib ? (
              <>
                <Stat label="PIS a recolher" value={formatMoney(build.contrib.pisDue)} hint={`Base ${formatMoney(build.contrib.pisBase)} · ${build.contrib.regime === "cumulative" ? "cumulativo" : "não cumulativo"}${build.contrib.pisCredit ? ` · créditos ${formatMoney(build.contrib.pisCredit)}` : ""}`} />
                <Stat label="COFINS a recolher" value={formatMoney(build.contrib.cofinsDue)} hint={`Base ${formatMoney(build.contrib.cofinsBase)}${build.contrib.cofinsCredit ? ` · créditos ${formatMoney(build.contrib.cofinsCredit)}` : ""}`} />
              </>
            ) : null}
          </div>

          <Card title="Pendências" description="Conferidas antes de gerar. Erros tendem a ser recusados pelo PVA; avisos não impedem a geração." className="mb-4" bodyClass="p-0">
            {build.pendencies.length === 0 ? (
              <p className="px-4 py-3 text-sm text-emerald-700">Nenhuma pendência encontrada.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {[...errors, ...warnings].slice(0, 80).map((p, i) => (
                  <li key={i} className="flex items-start gap-2 px-4 py-2">
                    <Badge tone={p.severity === "error" ? "bad" : "warn"}>{p.severity === "error" ? "Erro" : "Aviso"}</Badge>
                    <span>
                      {p.message}
                      {p.href && (
                        <>
                          {" "}
                          <Link href={p.href} className="text-brand-700 hover:underline">
                            corrigir
                          </Link>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Gerar arquivo" className="mb-4">
            <GenerateFileForm values={values} errors={errors.length} label={FILE_KIND_LABEL[build.kind]} />
            <p className="mt-2 text-xs text-slate-500">
              Texto “|REG|campo|…|”, ISO-8859-1, CRLF, vírgula decimal, datas DDMMAAAA. O mesmo período com os mesmos dados gera o mesmo conteúdo; o arquivo fica em Arquivos e o último de cada mês entra no pacote contábil.
            </p>
          </Card>

          <div className="mb-4 grid gap-4 xl:grid-cols-[1fr_2fr]">
            <Card title="Linhas por bloco" bodyClass="p-0">
              <table className="table-base w-full text-sm">
                <tbody>
                  {build.blocks.map((b) => (
                    <tr key={b.block}>
                      <td className="w-12 font-semibold">{b.block}</td>
                      <td>{BLOCK_LABEL[b.block] ?? ""}</td>
                      <td className="tabular text-right">{b.lines}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Card title="Registros" bodyClass="p-3">
              <div className="flex flex-wrap gap-1.5 text-xs">
                {build.counts.map((c) => (
                  <span key={c.reg} className="rounded border border-line px-2 py-0.5 tabular">
                    {c.reg}: {c.qty}
                  </span>
                ))}
              </div>
            </Card>
          </div>

          <Card title="Prévia do arquivo" description={build.lines.length > 60 ? `Primeiras 60 de ${build.lines.length} linhas.` : undefined} className="mb-4" bodyClass="p-0">
            {build.lines.length === 0 ? <EmptyState title="Arquivo vazio" /> : <pre className="overflow-x-auto bg-slate-50 p-3 text-[11px] leading-5 text-slate-700">{build.lines.slice(0, 60).join("\n")}</pre>}
          </Card>
        </>
      )}

      <Card title="Arquivos gerados" bodyClass="p-0">
        {history.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-500">Nenhum arquivo gerado ainda.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {history.slice(0, 40).map((h, i) => (
              <li key={`${h.fileId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
                <span className="min-w-0">
                  <a className="text-brand-700 hover:underline" href={`/api/files/${h.fileId}`}>
                    {h.fileName}
                  </a>
                  <span className="block text-xs text-slate-500">
                    {FILE_KIND_LABEL[h.kind]} · {h.period.slice(5, 7)}/{h.period.slice(0, 4)} · {branchName(h.branchId)} · {h.finality === "1" ? "retificadora" : "original"} · {h.lines} linhas · {h.summary}
                    {h.errors ? ` · ${h.errors} pendência(s) aceita(s)` : ""}
                  </span>
                </span>
                <span className="whitespace-nowrap text-xs text-slate-500">
                  {formatDateTime(h.generatedAt)} · {h.by}
                  {h.reused ? " · mesmo conteúdo" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Atalhos: <Link className="text-brand-700 hover:underline" href={`/fiscal/arquivos${qs({ ...values, arquivo: "sped_fiscal" })}`}>EFD ICMS/IPI</Link> ·{" "}
        <Link className="text-brand-700 hover:underline" href={`/fiscal/arquivos${qs({ ...values, arquivo: "efd_contribuicoes" })}`}>EFD Contribuições</Link> ·{" "}
        <Link className="text-brand-700 hover:underline" href="/fiscal/arquivos/sintegra">Sintegra</Link> ·{" "}
        <Link className="text-brand-700 hover:underline" href="/estoque/inventario-fiscal">Inventário em data-base</Link> ·{" "}
        <Link className="text-brand-700 hover:underline" href="/fiscal/entradas">Livro de entradas</Link>
      </p>
    </>
  );
}
