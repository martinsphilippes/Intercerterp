import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { TerminalForm } from "../terminal-form";
import { terminalFormOptions } from "../form-options";

export const metadata = { title: "Novo terminal" };

export default async function Page() {
  const s = await requireSession("admin", "create");
  const o = await terminalFormOptions(s.ctx);
  return (
    <>
      <PageHeader title="Novo terminal do PDV" crumbs={[{ label: "Administração" }, { label: "Terminais", href: "/administracao/terminais" }, { label: "Novo" }]} description="Cada caixa físico é um terminal: filial, série NFC-e, depósito de saída e periféricos." />
      <TerminalForm {...o} defaultBranchId={s.ctx.branchId} />
    </>
  );
}
