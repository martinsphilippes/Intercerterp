import Link from "@/components/ui/link";
import { redirect } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filters";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, Stat } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { buttonClass } from "@/components/ui/button";
import { paginate, parseList, sp, type SearchParams } from "@/lib/list";
import { addDays, formatDate, formatDateTime, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatDoc } from "@/lib/core/text";
import { canDo } from "@/lib/permissions";
import { CERT_STATUS, certificationSettings, listCertificationQueue, requestDisplayStatus, requestNextAction } from "@/domain/accounting";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Certificação digital — fila da equipe" };

/** Rótulo curto de quem responde pela próxima ação (requestNextAction().owner). */
const OWNER_SHORT: Record<string, string> = { firm: "escritório", team: "equipe", company: "titular", none: "—" };
const OWNER_TONE: Record<string, "accent" | "info" | "warn" | "neutral"> = { firm: "accent", team: "info", company: "warn", none: "neutral" };
const DONE_WINDOW_DAYS = 30;
const docLabel = (doc: string | null | undefined) => (doc && String(doc).replace(/\D/g, "").length === 11 ? "CPF" : "CNPJ");

const STAGE_OPTIONS = [
  { value: "open", label: "Em atendimento" },
  { value: "overdue", label: "Cobrança vencida" },
  ...CERT_STATUS.map((s) => ({ value: s.value, label: s.label })),
];

interface Row {
  id: string;
  protocol: string;
  firmId: string;
  firmName: string;
  holderName: string;
  holderDoc: string | null;
  productLabel: string;
  amount: number;
  dueDate: string;
  status: string;
  display: string;
  nextLabel: string;
  nextOwner: string;
  createdAt: string;
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("admin", "view");
  if (!canDo(s.user, "certification.operate")) redirect("/sem-permissao");
  const params = await searchParams;
  const p = parseList(params, { sort: "createdAt", dir: "asc" });
  const stageInput = sp(params, "etapa").trim();
  const stage = STAGE_OPTIONS.some((o) => o.value === stageInput) ? stageInput : "";
  const firmId = sp(params, "escritorio").trim();
  const filtered = Boolean(stage || firmId);

  // a fila inteira alimenta os indicadores e as opções de escritório; o recorte filtrado alimenta a tabela
  const [all, settings] = await Promise.all([listCertificationQueue(s.ctx), certificationSettings(s.ctx.store)]);
  const queue = filtered ? await listCertificationQueue(s.ctx, { status: stage || null, firmId: firmId || null }) : all;
  const ref = today();
  const rows: Row[] = queue.map((r) => {
    const next = requestNextAction(r, ref);
    return {
      id: r.id,
      protocol: r.protocol,
      firmId: r.companyId,
      firmName: r.firmName,
      holderName: r.holderName,
      holderDoc: r.holderDoc ?? null,
      productLabel: r.productLabel,
      amount: Number(r.amount ?? 0),
      dueDate: r.dueDate,
      status: r.status,
      display: requestDisplayStatus(r, ref),
      nextLabel: next.label,
      nextOwner: next.owner,
      createdAt: r.createdAt,
    };
  });
  const { rows: pageRows, total } = paginate(rows, p);

  const toConfirm = all.filter((r) => r.status === "awaiting_payment" && Number(r.chargeSends ?? 0) > 0).length;
  const validations = all.filter((r) => r.status === "validation").length;
  const issuing = all.filter((r) => r.status === "issuing").length;
  const failed = all.filter((r) => r.status === "issue_failed").length;
  const doneSince = addDays(ref, -DONE_WINDOW_DAYS);
  const doneAll = all.filter((r) => r.status === "downloaded").length;
  const done = all.filter((r) => r.status === "downloaded" && String(r.lastDownloadAt ?? r.updatedAt ?? "").slice(0, 10) >= doneSince).length;
  const firms = [...new Map(all.map((r) => [r.companyId, r.firmName])).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  const columns: Column<Row>[] = [
    { key: "protocol", label: "Protocolo", sortable: true, fixed: true, cell: (r) => <span className="font-mono text-sm font-medium">{r.protocol}</span> },
    { key: "firmName", label: "Escritório", sortable: true, cell: (r) => <span className="block max-w-[200px] truncate" title={r.firmName}>{r.firmName}</span> },
    {
      key: "holderName", label: "Titular", sortable: true, className: "min-w-[160px]",
      cell: (r) => (
        <span className="block">
          <span className="font-medium">{r.holderName}</span>
          {r.holderDoc && <span className="tabular block text-xs text-slate-500">{docLabel(r.holderDoc)} {formatDoc(r.holderDoc)}</span>}
        </span>
      ),
    },
    { key: "productLabel", label: "Produto", sortable: true, cell: (r) => <span className="whitespace-nowrap">{r.productLabel}</span> },
    { key: "amount", label: "Valor", sortable: true, align: "right", cell: (r) => <span className="tabular whitespace-nowrap">{formatMoney(r.amount)}</span> },
    { key: "dueDate", label: "Vencimento", sortable: true, cell: (r) => <span className={r.display === "overdue" ? "whitespace-nowrap font-medium text-red-700" : "whitespace-nowrap"}>{formatDate(r.dueDate)}</span> },
    { key: "display", label: "Etapa", sortable: true, cell: (r) => <StatusBadge kind="certificate_request" status={r.display} /> },
    {
      key: "nextLabel", label: "Próxima ação", className: "min-w-[220px]",
      cell: (r) => (
        <span className="block">
          <span className="block text-sm">{r.nextLabel}</span>
          <Badge tone={OWNER_TONE[r.nextOwner] ?? "neutral"} className="mt-1">{OWNER_SHORT[r.nextOwner] ?? r.nextOwner}</Badge>
        </span>
      ),
    },
    { key: "createdAt", label: "Aberta em", sortable: true, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span> },
    {
      key: "actions", label: "Ação", fixed: true,
      cell: (r) => (
        <Link href={`/administracao/certificacao/${r.id}`} className={buttonClass("primary", "sm")} title={`Atender o protocolo ${r.protocol}`}>
          <ClipboardCheck className="size-3.5" aria-hidden /> Atender
        </Link>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Certificação digital — fila da equipe"
        crumbs={[{ label: "Administração" }, { label: "Certificação digital" }]}
        description="Pagamentos a confirmar, validações a agendar, emissões a registrar. Cada etapa é uma ação real com autor e referência."
      />
      <section aria-label="Indicadores da fila" className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Pagamentos a confirmar" value={toConfirm.toLocaleString("pt-BR")} href="/administracao/certificacao?etapa=awaiting_payment" tone={toConfirm ? "warn" : "default"} hint="Cobranças já enviadas pelo escritório" />
        <Stat label="Validações pendentes" value={validations.toLocaleString("pt-BR")} href="/administracao/certificacao?etapa=validation" tone={validations ? "warn" : "default"} hint="Agendar, aprovar ou registrar pendência" />
        <Stat label="Emissões em andamento" value={issuing.toLocaleString("pt-BR")} href="/administracao/certificacao?etapa=issuing" hint="Registrar o arquivo emitido ou a falha" />
        <Stat label="Falhas" value={failed.toLocaleString("pt-BR")} href="/administracao/certificacao?etapa=issue_failed" tone={failed ? "bad" : "default"} hint="Aguardam nova tentativa, sem nova cobrança" />
        <Stat label="Concluídas" value={doneAll.toLocaleString("pt-BR")} href="/administracao/certificacao?etapa=downloaded" tone={doneAll ? "good" : "default"} hint={`${done.toLocaleString("pt-BR")} com download nos últimos ${DONE_WINDOW_DAYS} dias`} />
      </section>
      <FilterBar
        basePath="/administracao/certificacao"
        values={params}
        filters={[
          { type: "select", name: "etapa", label: "Etapa", options: STAGE_OPTIONS, all: "Todas" },
          { type: "select", name: "escritorio", label: "Escritório", options: firms, all: "Todos" },
        ]}
      />
      <DataTable
        id="certification-queue"
        basePath="/administracao/certificacao"
        params={params}
        columns={columns}
        rows={pageRows}
        total={total}
        page={p.page}
        pageSize={p.pageSize}
        rowHref={(r) => `/administracao/certificacao/${r.id}`}
        empty={
          all.length === 0 ? (
            <EmptyState title="Nenhuma solicitação de certificado" description="Os escritórios contábeis abrem as solicitações para seus clientes em Certificados digitais; elas chegam aqui para confirmação do pagamento, validação do titular e emissão." />
          ) : (
            <EmptyState
              title="Nenhuma solicitação no recorte"
              description="Ajuste a etapa ou o escritório."
              action={
                <Link href="/administracao/certificacao" className="text-sm text-brand-700 underline">
                  Limpar filtros
                </Link>
              }
            />
          )
        }
      />

      <div className="mt-6">
        <Card
          title="Parâmetros da certificação"
          description="Catálogo de produtos, instruções de pagamento e base do link de pagamento — valem para todos os escritórios. Toda alteração fica no histórico."
        >
          {/* a chave remonta o formulário quando os parâmetros salvos mudam (após salvar, o produto novo passa a "já em uso") */}
          <SettingsForm key={JSON.stringify(settings)} settings={settings} />
        </Card>
      </div>
    </>
  );
}
