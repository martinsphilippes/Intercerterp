import { requireSession } from "@/lib/server/session";
import { findOne } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { TICKET_CATEGORIES, TICKET_PRIORITIES } from "@/domain/support";
import { TicketForm } from "./ticket-form";

export const metadata = { title: "Novo chamado" };

const AREA_CATEGORY: Record<string, string> = { vendas: "pdv", estoque: "estoque", financeiro: "financeiro", fiscal: "fiscal", administracao: "acesso", inicio: "duvida", compras: "duvida", clientes: "duvida", relatorios: "duvida", suporte: "duvida" };

export default async function Page({ searchParams }: { searchParams: Promise<{ origem?: string; artigo?: string }> }) {
  const s = await requireSession("support", "create");
  const { origem, artigo } = await searchParams;
  const art = artigo ? await findOne(s.ctx.store, "help_articles", [["eq", "slug", artigo]]) : null;
  return (
    <>
      <PageHeader title="Novo chamado" crumbs={[{ label: "Ajuda", href: "/ajuda" }, { label: "Chamados", href: "/ajuda/chamados" }, { label: "Novo" }]} description="Registre sua solicitação com contexto. O chamado recebe um número e você acompanha as respostas por aqui e pelas notificações." />
      <Card>
        <TicketForm
          categories={TICKET_CATEGORIES}
          priorities={TICKET_PRIORITIES}
          origin={origem ?? ""}
          branchName={s.branch?.name ?? (s.consolidated ? "Consolidado" : "—")}
          defaultSubject={art ? `Dúvida não resolvida: ${art.title}` : undefined}
          defaultCategory={art ? AREA_CATEGORY[art.area] : undefined}
        />
      </Card>
    </>
  );
}
