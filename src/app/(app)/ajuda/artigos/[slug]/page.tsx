import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { findOne, listAll } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { HELP_AREAS, ensureHelpArticles } from "@/domain/help-content";
import { Markdown } from "../../markdown";

export const metadata = { title: "Artigo de ajuda" };

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ rota?: string }> }) {
  const s = await requireSession("support");
  const { slug } = await params;
  const { rota } = await searchParams;
  await ensureHelpArticles(s.ctx.store);
  const a = await findOne(s.ctx.store, "help_articles", [["eq", "slug", slug]]);
  if (!a || (a.companyId && a.companyId !== s.ctx.companyId)) notFound();
  const related = (await listAll(s.ctx.store, "help_articles", { filters: [["eq", "area", a.area]] })).filter((x) => x.id !== a.id && (!x.companyId || x.companyId === s.ctx.companyId));
  const area = HELP_AREAS.find((x) => x.key === a.area);
  const origin = rota || a.contextRoutes?.[0] || "/ajuda";
  return (
    <>
      <PageHeader
        title={a.title}
        crumbs={[{ label: "Ajuda", href: "/ajuda" }, { label: area?.label ?? a.area, href: `/ajuda?assunto=${a.area}` }, { label: "Artigo" }]}
        badges={<Badge tone="info">{area?.label ?? a.area}</Badge>}
        description={a.summary}
        actions={
          <>
            {a.contextRoutes?.[0] && <LinkButton href={a.contextRoutes[0]}>Ir para a tela</LinkButton>}
            <LinkButton href={`/ajuda/chamados/novo?origem=${encodeURIComponent(origin)}&artigo=${a.slug}`} variant="primary">Não resolveu? Abrir chamado</LinkButton>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card>
          <Markdown source={a.body ?? ""} />
          <p className="mt-6 text-xs text-slate-400">Atualizado em {formatDateTime(a.updatedAt)}</p>
        </Card>
        <div className="space-y-4">
          {(a.contextRoutes ?? []).length > 0 && (
            <Card title="Telas relacionadas">
              <ul className="space-y-1 text-sm">
                {a.contextRoutes.map((r: string) => (
                  <li key={r}><Link className="text-brand-700 hover:underline" href={r}>{r}</Link></li>
                ))}
              </ul>
            </Card>
          )}
          {related.length > 0 && (
            <Card title={`Mais em ${area?.label ?? a.area}`}>
              <ul className="space-y-2 text-sm">
                {related.map((r) => (
                  <li key={r.id}><Link className="text-brand-700 hover:underline" href={`/ajuda/artigos/${r.slug}`}>{r.title}</Link></li>
                ))}
              </ul>
            </Card>
          )}
          {(a.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {a.tags.map((t: string) => (
                <Link key={t} href={`/ajuda?q=${encodeURIComponent(t)}`}><Badge>{t}</Badge></Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
