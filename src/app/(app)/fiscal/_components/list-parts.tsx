import Link from "@/components/ui/link";
import { Eye, FileDown, Pencil, Printer, RefreshCw, Search, Send } from "lucide-react";
import type { Doc } from "@/lib/db/types";
import { Badge, SimBadge, StatusBadge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-form";
import { IconAction } from "./icon-action";
import { cn } from "@/components/ui/cn";
import { qs, type SearchParams } from "@/lib/list";
import { formatDateTime } from "@/lib/dates";
import { queryAction, retransmitAction, testConnectionAction, transmitAction } from "../actions";
import { measuredStatus } from "@/domain/fiscal/service";

const ENV_LABEL: Record<string, string> = { homologacao: "Homologação", producao: "Produção" };

/** Situação do serviço fiscal medida pelo último teste real (nunca presumida) + contexto de emissão. */
export function FiscalStatusBar({ cfg, model, extra, canTest }: { cfg: Doc | null; model: "nfe" | "nfce" | "nfse"; extra?: React.ReactNode; canTest: boolean }) {
  if (!cfg)
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Configuração fiscal não cadastrada para esta filial. <Link className="underline" href="/fiscal/configuracoes">Configurar</Link>
      </div>
    );
  const provider = cfg.provider === "focusnfe" ? "Focus NFe" : cfg.provider === "simulated" ? "Simulação" : (cfg.provider ?? "—");
  const enabled = model === "nfe" ? cfg.nfeEnabled : model === "nfce" ? cfg.nfceEnabled : cfg.nfseEnabled;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-white px-3 py-2 text-xs text-slate-600">
      <span className="flex items-center gap-1.5">
        <span className="font-medium text-ink">Provedor:</span> {provider}
        {cfg.provider === "simulated" && <SimBadge />}
      </span>
      {cfg.provider !== "simulated" && <Badge tone={cfg.environment === "producao" ? "brand" : "info"}>{ENV_LABEL[cfg.environment] ?? cfg.environment}</Badge>}
      <span className="flex items-center gap-1.5">
        <span className="font-medium text-ink">Conexão (último teste):</span> <StatusBadge kind="integration" status={measuredStatus(cfg)} />
        <span title={cfg.lastTestResult ?? ""}>{cfg.lastTestAt ? formatDateTime(cfg.lastTestAt) : "nunca testada"}</span>
      </span>
      {enabled === false && <Badge tone="warn">Emissão desabilitada</Badge>}
      {cfg.contingency && <Badge tone="warn">Contingência ativa</Badge>}
      {extra}
      {canTest && (
        <span className="ml-auto">
          <ActionButton action={testConnectionAction.bind(null, "branch")} label="Testar conexão fiscal" size="sm" variant="ghost" icon={<Search className="size-3.5" />} title="Teste real com o provedor configurado (resultado registrado)" />
        </span>
      )}
    </div>
  );
}

/** Abas de situação (atalhos para o filtro `status`, preservando os demais filtros). */
export function StatusTabs({ basePath, params, tabs }: { basePath: string; params: SearchParams; tabs: Array<{ label: string; status: string; count?: number }> }) {
  const cur = (Array.isArray(params.status) ? params.status[0] : params.status) ?? "";
  return (
    <div role="tablist" className="no-print mb-3 flex gap-1 overflow-x-auto">
      {tabs.map((t) => {
        const active = cur === t.status;
        return (
          <Link
            key={t.label}
            role="tab"
            aria-selected={active}
            href={`${basePath}${qs({ status: t.status || null, page: null }, params)}`}
            className={cn("focus-ring whitespace-nowrap rounded-full px-3 py-1 text-sm", active ? "bg-brand-800 text-white" : "bg-white text-slate-600 ring-1 ring-line hover:bg-slate-50")}
          >
            {t.label}
            {t.count != null && <span className={cn("ml-1.5 rounded-full px-1.5 text-xs", active ? "bg-white/20" : "bg-slate-100")}>{t.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}

/** Selo de situação com o código de retorno (ex.: Rejeitado 778) e marcação de simulação. */
export function DocStatus({ d }: { d: Doc }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <StatusBadge kind="fiscal" status={d.status} />
      {["rejected", "denied"].includes(d.status) && d.statusCode && d.statusCode !== "999" && <span className="font-mono text-[11px] text-red-700">{d.statusCode}</span>}
      <SimBadge show={Boolean(d.isSimulated)} />
      {d.contingency && <Badge tone="warn">Contingência</Badge>}
    </span>
  );
}

const iconBtn = "focus-ring inline-flex size-7 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-brand-700";

/** Ações por linha conforme o estado (ver, imprimir, XML, consultar, editar, transmitir/retransmitir) — escrita só na filial do documento. */
export function RowActions({ d, canIssue: canIssueAny, branchId }: { d: Doc; canIssue: boolean; branchId: string | null }) {
  const model = d.model as string;
  const canIssue = canIssueAny && Boolean(branchId) && d.branchId === branchId;
  const editable = ["draft", "pending", "rejected"].includes(d.status) && d.originType !== "disable";
  const editHref = model === "nfe" ? `/fiscal/nfe/nova?rascunho=${d.id}` : model === "nfse" ? `/fiscal/nfse/nova?id=${d.id}` : `/fiscal/nfce/${d.id}`;
  return (
    <span className="flex items-center gap-0.5">
      <Link href={`/fiscal/${model}/${d.id}`} className={iconBtn} title="Ver detalhes" aria-label="Ver detalhes">
        <Eye className="size-4" />
      </Link>
      {(["authorized", "cancelled"].includes(d.status) || (model !== "nfce" && d.status === "draft")) && d.originType !== "disable" && (
        <Link href={`/fiscal/${model}/${d.id}/imprimir`} target="_blank" className={iconBtn} title={d.status === "draft" ? "Prévia (sem valor fiscal)" : "Imprimir"} aria-label="Imprimir">
          <Printer className="size-4" />
        </Link>
      )}
      {d.xmlFileId && (
        <a href={`/api/files/${d.xmlFileId}`} className={iconBtn} title="Baixar XML" aria-label="Baixar XML">
          <FileDown className="size-4" />
        </a>
      )}
      {canIssue && d.status === "processing" && d.originType !== "disable" && (
        <IconAction action={queryAction.bind(null, d.id)} title="Consultar retorno">
          <RefreshCw className="size-4" />
        </IconAction>
      )}
      {canIssue && editable && (
        <Link href={editHref} className={iconBtn} title={model === "nfce" ? "Corrigir (abre o detalhe)" : "Editar/corrigir"} aria-label="Editar">
          <Pencil className="size-4" />
        </Link>
      )}
      {canIssue && d.status === "draft" && (
        <IconAction action={transmitAction.bind(null, d.id)} title="Transmitir" confirm="Transmitir o documento agora?">
          <Send className="size-4" />
        </IconAction>
      )}
      {canIssue && ["rejected", "error", "pending", "queued"].includes(d.status) && d.originType !== "disable" && (
        <IconAction action={retransmitAction.bind(null, d.id)} title="Retransmitir (mesma referência)" confirm="Retransmitir com a mesma referência?">
          <Send className="size-4" />
        </IconAction>
      )}
    </span>
  );
}
