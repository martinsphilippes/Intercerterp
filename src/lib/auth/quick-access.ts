import { configuredBackend } from "../db";

/**
 * ACESSO RÁPIDO DA TELA DE LOGIN — os usuários da demonstração, por setor, com a senha e um botão "Entrar".
 *
 * DECISÃO DO TITULAR (13/11/2026): os logins de acesso ficam na tela inicial ATÉ ELE MANDAR TIRAR. Não remover,
 * esconder nem desligar por iniciativa própria — nem para "operação real", nem por segurança. Quem desliga é o titular,
 * apagando a variável `SHOW_DEMO_LOGIN` na Vercel (ou pedindo para apagar).
 *
 * Enquanto a variável estiver ligada, os usuários da lista ficam PROTEGIDOS (`isQuickAccessUser`): a senha deles está
 * na tela, então qualquer visitante entra como Administração — e não pode tirá-los da lista nem impedir o botão de
 * entrar (inativar, suspender, trocar senha, e-mail ou login, cadastrar autenticador, bloquear por tentativas
 * erradas). Desligada a variável, a proteção sai junto. Regras em docs/regras-assumidas.md §47.
 */

/**
 * Usuários da demonstração no acesso rápido, na ordem de apresentação: [login, setor exibido]. É também a lista de
 * reserva da tela quando o banco não responde (os acessos continuam visíveis). `tests/login-screen.test.ts` confere
 * que ela acompanha, nos dois sentidos, os usuários com acesso criados pela demonstração (`src/domain/seed`).
 */
export const DEMO_DIRECTORY: Array<[login: string, sector: string]> = [
  // loja (varejo)
  ["admin", "Administração"],
  ["gerente", "Gerência"],
  ["diretoria", "Diretoria"],
  ["caixa", "Caixa (PDV)"],
  ["vendedora", "Vendas — vendedora comissionada"],
  ["estoque", "Estoque"],
  ["financeiro", "Financeiro"],
  ["fiscal", "Fiscal"],
  // escritório contábil e certificação
  ["contador", "Escritório contábil — sócio"],
  ["analista", "Escritório contábil — analista"],
  ["certificacao", "Equipe de certificação Intercert"],
  // rede de certificação (§43)
  ["rede", "Rede de certificação — plataforma Intercert"],
  ["master", "Rede — Master (Rede Nordeste)"],
  ["regional.ce", "Rede — Regional Ceará"],
  ["regional.ba", "Rede — Regional Bahia"],
  ["revenda.juazeiro", "Rede — Revenda Juazeiro do Norte"],
  ["revenda.fortaleza", "Rede — Revenda Fortaleza"],
  ["revenda.salvador", "Rede — Revenda Salvador"],
  ["vendedor.juazeiro", "Rede — vendedor (Juazeiro do Norte)"],
  ["vendedor.fortaleza", "Rede — vendedor (Fortaleza)"],
  ["vendedor.salvador", "Rede — vendedor (Salvador)"],
];

/** Setor e posição de cada login da demonstração. */
export const DEMO_SECTORS: Record<string, { sector: string; order: number }> = Object.fromEntries(DEMO_DIRECTORY.map(([login, sector], i) => [login, { sector, order: i + 1 }]));

/** O titular ligou o acesso rápido na publicação (`SHOW_DEMO_LOGIN=1`): a lista aparece e os usuários dela ficam protegidos. */
export function quickAccessPinned(): boolean {
  return process.env.SHOW_DEMO_LOGIN === "1";
}

/** Acesso rápido na tela de login: ligado pelo titular (`SHOW_DEMO_LOGIN=1`) ou na demonstração volátil em memória. */
export function demoLoginEnabled(): boolean {
  return quickAccessPinned() || configuredBackend() === "memory";
}

/**
 * Usuário que aparece no acesso rápido enquanto o titular mantém a lista ligada: da empresa de demonstração, com login
 * da lista e sem ser administrador geral. Esses usuários não podem sair da lista nem deixar de entrar pelo botão.
 */
export function isQuickAccessUser(u: Record<string, any> | null | undefined): boolean {
  return quickAccessPinned() && Boolean(u?.isDemo) && !u?.isAdmin && typeof u?.login === "string" && Object.prototype.hasOwnProperty.call(DEMO_SECTORS, u.login);
}

/** Código do erro de negócio quando uma ação tiraria um usuário do acesso rápido. */
export const QUICK_ACCESS_LOCKED = "quick_access";

/** Mensagem da recusa: o que foi tentado, de quem, e como liberar. */
export function quickAccessLockedMessage(what: string, name?: string | null): string {
  return `${what}: ${name ? `${name} está` : "este usuário está"} no acesso rápido da tela de login, que fica ligado por decisão do titular. Enquanto a lista estiver ligada, os usuários dela não podem ser alterados assim — para liberar, o titular desliga o acesso rápido.`;
}
