import { requireSession } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { unscoped } from "@/lib/db/scoped-store";
import { companyModulesStatus, moduleHistory } from "@/domain/modules/changes";
import { FAMILIES, MODULE_MAP } from "@/lib/modules/catalog";

export const metadata = { title: "Módulos contratados" };

const STATE: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" | "info" }> = {
  enabled: { label: "Habilitado", tone: "good" },
  scheduled_off: { label: "Desligamento agendado", tone: "info" },
  draining: { label: "Em desligamento", tone: "warn" },
  disabled: { label: "Desligado", tone: "neutral" },
  absent: { label: "Não contratado", tone: "neutral" },
};
const MODE: Record<string, string> = { legacy: "Sem controle (comportamento anterior)", shadow: "Simulação (registra, não bloqueia)", enforced: "Controle aplicado" };
const ACCESS: Record<string, string> = { full: "operação completa", drain: "concluir pendências", read: "consulta histórica", none: "indisponível" };

/**
 * Administração › Módulos contratados (somente consulta): o que a empresa tem habilitado, o efeito em cada área,
 * a configuração pendente e o histórico. Quem altera é o Interos (fonte comercial); o ERP é a fonte operacional.
 */
export default async function Page() {
  const s = await requireSession("admin", "view");
  const store = unscoped(s.ctx.store);
  const st = await companyModulesStatus(store, s.ctx.companyId);
  const history = await moduleHistory(store, s.ctx.companyId, 10);
  const families = [...new Set(st.modules.map((m) => MODULE_MAP.get(m.module)!.family))];
  return (
    <>
      <PageHeader title="Módulos contratados" crumbs={[{ label: "Administração" }, { label: "Módulos contratados" }]} description="Módulos habilitados para esta empresa. Alterações chegam pelo Interos; os dados de módulos desligados ficam preservados." />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Controle" value={MODE[st.mode] ?? st.mode} />
        <Stat label="Versão" value={st.version} hint={`Catálogo ${st.catalogVersion}`} />
        <Stat label="Linha de base" value={st.baseline ? (st.baseline.status === "pending_review" ? "Divergências a revisar" : st.baseline.status === "reviewed" ? "Revisada" : "Sem divergências") : "Ainda não registrada"} tone={st.baseline?.status === "pending_review" ? "warn" : "default"} />
      </div>
      {st.baseline?.divergences?.length ? (
        <Card title="Divergências da linha de base" className="mb-4" description="Direitos que não puderam ser determinados com segurança: continuam habilitados até a revisão.">
          <ul className="list-disc space-y-1 pl-5 text-sm">{(st.baseline.divergences as Array<{ message: string }>).map((d, i) => <li key={i}>{d.message}</li>)}</ul>
        </Card>
      ) : null}
      {families.map((f) => (
        <Card key={f} title={FAMILIES[f] ?? f} className="mb-4" bodyClass="p-0">
          <table className="w-full text-sm">
            <tbody>
              {st.modules.filter((m) => MODULE_MAP.get(m.module)!.family === f).map((m) => {
                const def = MODULE_MAP.get(m.module)!;
                const state = STATE[m.state] ?? STATE.absent;
                return (
                  <tr key={m.module} className="border-t border-line first:border-t-0">
                    <td className="px-4 py-2 align-top">
                      <p className="font-medium text-ink">{def.name}{def.parent ? <span className="font-normal text-slate-500"> · função de {MODULE_MAP.get(def.parent)?.name}</span> : null}</p>
                      <p className="text-xs text-slate-500">{def.description}</p>
                      {!m.configuration.ready && <p className="mt-1 text-xs text-amber-700">Configuração pendente: {m.configuration.missing.join("; ")}</p>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 align-top text-right">
                      <Badge tone={state.tone}>{state.label}</Badge>
                      <p className="mt-1 text-xs text-slate-500">{ACCESS[m.access]}{st.mode === "shadow" && m.accessIfEnforced !== m.access ? ` (com controle: ${ACCESS[m.accessIfEnforced]})` : ""}</p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ))}
      <Card title="Histórico de alterações">
        <ul className="space-y-2 text-sm">
          {history.map((h) => (
            <li key={h.version}><span className="font-medium">Versão {h.version}</span> · {new Date(h.at).toLocaleString("pt-BR")} · {h.actor} ({h.actorType}) — {h.reason}</li>
          ))}
          {!history.length && <li className="text-slate-500">Sem alterações registradas.</li>}
        </ul>
      </Card>
    </>
  );
}
