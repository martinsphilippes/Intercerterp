import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/empty";
import { LinkButton } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDateTime, nowIso } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { sp, type SearchParams } from "@/lib/list";
import { nameMap } from "@/lib/server/lookups";
import { getIntegration } from "@/domain/integrations";
import { pixProviderFrom } from "@/domain/payments/providers";
import { getFiscalConfig } from "@/domain/fiscal/service";
import { resolveTerminal } from "../../pdv/terminal";
import { OpeningForm } from "./opening-form";

export const metadata = { title: "Abertura de caixa" };
export const dynamic = "force-dynamic";

/** Abertura de caixa (Tela 12): terminal, operador, filial, data/hora, fundo de troco e conferência do terminal. */
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await requireSession("cash", "create");
  const params = await searchParams;
  const header = <PageHeader title="Abertura de caixa" crumbs={[{ label: "Caixa", href: "/caixa" }, { label: "Abertura" }]} description="Confira os dados, informe o fundo inicial e valide os equipamentos antes de iniciar as vendas." />;
  if (!s.branch) return <>{header}<Notice tone="warn" title="Selecione uma filial">A abertura de caixa é feita numa filial específica.</Notice></>;
  const { terminal, terminals, session } = await resolveTerminal(s, sp(params, "terminal") || null);
  if (!terminal) return <>{header}<Notice tone="warn" title="Nenhum terminal ativo nesta filial">Cadastre um terminal em Administração → Terminais.</Notice></>;
  const store = s.ctx.store;
  const users = await nameMap(s.ctx, "users");
  const last = (await store.list("cash_sessions", { filters: [["eq", "terminalId", terminal.id], ["eq", "status", "closed"]], orderBy: [{ field: "closedAt", dir: "desc" }], limit: 1 })).items[0] ?? null;
  const lastDiff = last ? Object.values(last.differences ?? {}).reduce((a: number, b: any) => a + Number(b), 0) : 0;
  const [pixInteg, cardInteg] = await Promise.all([getIntegration(store, s.ctx.companyId, s.ctx.branchId, "pix"), getIntegration(store, s.ctx.companyId, s.ctx.branchId, "card_tef")]);
  const fiscalCfg = await getFiscalConfig(store, s.ctx.companyId, s.ctx.branchId);
  const pixProvider = pixProviderFrom(pixInteg);
  if (session) {
    const mine = session.operatorId === s.user.id;
    return (
      <>
        {header}
        <Notice tone={mine ? "info" : "warn"} title={`Caixa nº ${session.number} já está aberto em ${terminal.name}`}>
          Aberto em {formatDateTime(session.openedAt)} por {users.get(session.operatorId) ?? "—"} com fundo de {formatMoney(session.openingFund)}.
          {mine ? " A sessão aberta é retomada neste terminal — não é preciso abrir outra." : " Somente uma sessão por terminal: o operador responsável deve fechá-la antes de nova abertura."}
          <div className="mt-3 flex flex-wrap gap-2">
            {mine && can(s.user, "pdv", "create") && <LinkButton href={`/pdv?terminal=${terminal.id}`} variant="primary">Retomar no PDV</LinkButton>}
            <LinkButton href={`/caixa/${session.id}`}>Ver sessão</LinkButton>
            {terminals.filter((t) => t.id !== terminal.id && t.status === "active").map((t) => <LinkButton key={t.id} href={`/caixa/abertura?terminal=${t.id}`} variant="ghost">Abrir em {t.name}</LinkButton>)}
          </div>
        </Notice>
      </>
    );
  }
  return (
    <>
      {header}
      <OpeningForm
        operator={s.user.name}
        branch={s.branch.name}
        now={formatDateTime(nowIso())}
        terminal={{ id: terminal.id, name: terminal.name, code: terminal.code, printerMode: terminal.printerMode ?? null, printerName: terminal.printerName ?? null, paperWidth: terminal.paperWidth ?? null, scannerMode: terminal.scannerMode ?? null, lastPrinterTestAt: terminal.lastPrinterTestAt ?? null, lastPrinterTestResult: terminal.lastPrinterTestResult ?? null }}
        terminals={terminals.filter((t) => t.status === "active").map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))}
        lastClosing={last ? { at: formatDateTime(last.closedAt), number: last.number, diff: lastDiff, countedCash: last.counted?.cash ?? 0 } : null}
        integrations={{
          pix: { provider: pixInteg?.provider ?? null, status: pixInteg?.status ?? "not_configured", ready: Boolean(pixProvider), simulated: Boolean(pixProvider?.simulated), lastTest: pixInteg?.lastTestMessage ?? null },
          card: { provider: cardInteg?.provider ?? null, status: cardInteg?.status ?? "not_configured", acquirer: cardInteg?.config?.acquirer ?? null },
          fiscal: { provider: fiscalCfg?.provider ?? null, environment: fiscalCfg?.environment ?? null, status: fiscalCfg?.connectionStatus ?? null, lastTest: fiscalCfg?.lastTestResult ?? null, lastTestAt: fiscalCfg?.lastTestAt ?? null },
        }}
      />
    </>
  );
}
