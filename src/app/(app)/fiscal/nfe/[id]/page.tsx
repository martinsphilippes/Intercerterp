import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/server/session";
import { canSeeBranch } from "../../queries";
import { DocDetail } from "../../_components/doc-detail";

export const metadata = { title: "NF-e" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const s = await requireSession("fiscal");
  const { id } = await params;
  const { tab = "resumo" } = await searchParams;
  const doc = await s.ctx.store.get("fiscal_documents", id);
  if (!doc || doc.companyId !== s.ctx.companyId || !canSeeBranch(s.ctx, doc.branchId)) notFound();
  if (doc.model !== "nfe") redirect(`/fiscal/${doc.model}/${id}`);
  return <DocDetail s={s} doc={doc} tab={tab} />;
}
