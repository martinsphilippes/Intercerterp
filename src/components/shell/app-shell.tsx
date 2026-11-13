"use client";

import Link from "@/components/ui/link";
import { Bell } from "lucide-react";
import { InstallAppButton } from "@/components/pwa/install-button";
import { GlobalSearch } from "./global-search";
import type { NavGroup } from "./nav";
import { Sidebar } from "./sidebar";
import { UnitSwitcher } from "./unit-switcher";
import { UserMenu } from "./user-menu";

export interface AppShellProps {
  /** Conteúdo da página. Tem de ser a PRIMEIRA propriedade passada pelo layout (ver o comentário abaixo). */
  page: React.ReactNode;
  /** Menu já filtrado pelas permissões e recursos do usuário. */
  groups: NavGroup[];
  /** Empresa de demonstração (faixa de aviso e selo no menu). */
  demo: boolean;
  /** Demonstração volátil em memória (DATA_BACKEND=memory). */
  volatile: boolean;
  units: {
    companies: Array<{ id: string; name: string; isDemo?: boolean; inactive?: boolean }>;
    branches: Array<{ id: string; name: string; companyId: string; inactive?: boolean }>;
    current: { companyId: string; branchId: string | null; consolidated: boolean; label: string };
    canConsolidate: boolean;
  };
  /** Notificações não lidas. */
  unread: number;
  user: { name: string; role: string };
}

/**
 * Moldura das telas internas: menu lateral, cabeçalho (unidade, busca, notificações, usuário) e a área da página.
 *
 * É um componente de cliente que recebe só DADOS do layout do servidor — de propósito. Com banco de verdade a resposta
 * chega ao navegador em partes, e o React embutido no Next 15.5 (19.2 canary de 08/2025) falha ao montar a tela quando
 * um elemento HTML tem um filho que vem numa linha posterior do fluxo de dados: ele reinicia o elemento, perde a posição
 * e descarta a tela montada pelo servidor (erro 418, a página inteira é refeita no navegador). O servidor adia elementos
 * depois de ~3,2 KB na mesma linha, e o menu sozinho passa disso — a caixa principal ficava exatamente nessa situação em
 * cerca de 2% das cargas. Aqui o servidor não envia nenhum elemento HTML da moldura: envia este componente e os dados
 * dele. `page` vem antes dos dados grandes (a ordem das propriedades é a ordem de envio) para não ser adiada também.
 * Pode voltar a ser montada no servidor quando o Next for atualizado para uma versão com o React corrigido.
 */
export function AppShell({ page, groups, demo, volatile, units, unread, user }: AppShellProps) {
  return (
    <div className="min-h-screen">
      <Sidebar groups={groups} demo={demo} />
      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-white/95 px-4 pl-14 backdrop-blur lg:pl-4">
          <UnitSwitcher companies={units.companies} branches={units.branches} current={units.current} canConsolidate={units.canConsolidate} />
          <div className="hidden flex-1 justify-center md:flex">
            <GlobalSearch />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/notificacoes" className="focus-ring relative rounded-md p-2 hover:bg-slate-100" aria-label={`Notificações${unread ? ` (${unread} não lidas)` : ""}`}>
              <Bell className="size-5 text-slate-600" />
              {unread > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-accent-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <InstallAppButton />
            <UserMenu name={user.name} role={user.role} />
          </div>
        </header>
        {(demo || volatile) && (
          <div className="no-print border-b border-fuchsia-200 bg-fuchsia-50 px-4 py-1.5 text-center text-xs text-fuchsia-900">
            {volatile ? "Demonstração volátil em memória — os dados são recriados quando o servidor reinicia. " : "Empresa de demonstração. "}
            Documentos fiscais e cobranças usam provedores de simulação, sem validade fiscal ou financeira.
          </div>
        )}
        <div className="md:hidden border-b border-line bg-white p-2 no-print">
          <GlobalSearch />
        </div>
        <main className="mx-auto max-w-[1600px] p-4 md:p-6">{page}</main>
      </div>
    </div>
  );
}
