import { requireSession } from "@/lib/server/session";
import { getStore } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";
import { Card, DefinitionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/empty";
import { ActionButton } from "@/components/ui/action-form";
import { formatDateTime } from "@/lib/dates";
import { getAuth } from "@/lib/auth/provider";
import { isQuickAccessUser } from "@/lib/auth/quick-access";
import { twoFactorState, userRequiresTwoFactor } from "@/domain/two-factor";
import { openSessions } from "@/domain/users";
import { TwoFactorPanel } from "./panel";
import { revokeOtherSessionsAction } from "./actions";

export const metadata = { title: "Segurança da conta" };
export const dynamic = "force-dynamic";

/** Minha conta › Segurança (§44): autenticação em duas etapas com aplicativo autenticador (TOTP). */
export default async function Page() {
  const s = await requireSession();
  const u = (await getStore().get("users", s.user.id))!;
  const st = twoFactorState(u);
  const required = await userRequiresTwoFactor(getStore(), u);
  const sessions = getAuth().kind === "local" ? await openSessions(getStore(), u) : null;
  const quick = isQuickAccessUser(u);
  return (
    <>
      <PageHeader title="Segurança da conta" crumbs={[{ label: "Minha conta" }, { label: "Segurança" }]} description={`${u.name} · ${u.login ? `login ${u.login} · ` : ""}${u.email}`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Autenticação em duas etapas" actions={st.enabled ? <Badge tone="good">Ativa</Badge> : <Badge tone={required ? "warn" : "neutral"}>Desativada</Badge>}>
          {required && !st.enabled && <div className="mb-3"><Notice tone="warn">Seu perfil exige a autenticação em duas etapas. Cadastre o aplicativo agora; no próximo login ele será pedido de qualquer forma.</Notice></div>}
          {st.enabled && (
            <DefinitionList
              items={[
                { label: "Ativada em", value: formatDateTime(st.enabledAt) },
                { label: "Códigos de recuperação disponíveis", value: `${st.recoveryLeft} de 10` },
                { label: "Exigida pelo perfil", value: required ? "Sim (não pode ser desativada)" : "Não" },
              ]}
            />
          )}
          <TwoFactorPanel enabled={st.enabled} required={required} recoveryLeft={st.recoveryLeft} />
        </Card>
        <Card title="Sessões" className="lg:col-start-1">
          <DefinitionList
            items={[
              { label: "Sessões abertas (incluindo esta)", value: sessions ? String(sessions.count) : "Gerenciadas pelo serviço de autenticação" },
              { label: "Encerradas pela última vez", value: u.sessionsValidAfter ? formatDateTime(u.sessionsValidAfter) : "—" },
            ]}
          />
          <p className="mt-3 text-sm text-slate-600">Entrou em outro computador ou celular e não saiu? Encerre as outras sessões: esta continua aberta e os outros dispositivos precisarão entrar de novo.</p>
          <div className="mt-3">
            {quick ? (
              <p className="text-xs text-slate-500">Acesso da demonstração: o mesmo usuário é usado por outros visitantes, então as sessões dele não são encerradas por aqui.</p>
            ) : (
              <ActionButton action={revokeOtherSessionsAction} label="Encerrar as outras sessões" confirm="Encerrar todas as outras sessões? Esta continua aberta." disabled={sessions !== null && sessions.count <= 1} />
            )}
          </div>
        </Card>
        <Card title="Como funciona">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
            <li>Depois da senha, o sistema pede o código de 6 dígitos do aplicativo autenticador (muda a cada 30 segundos).</li>
            <li>Funciona com Google Authenticator, Microsoft Authenticator, 1Password, Authy e similares — sem SMS.</li>
            <li>“Manter conectado” não dispensa o código no login.</li>
            <li>Sem o celular, entre com um código de recuperação (cada um vale uma vez). Sem nenhum dos dois, peça ao administrador a redefinição.</li>
            <li>Códigos errados contam nas 5 tentativas do bloqueio temporário de 15 minutos.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
