/**
 * Levantamento rastreável CAPACIDADE → IMPLEMENTAÇÃO gerado do código (nada escrito à mão):
 *  - docs/modulos/inventario-capacidades.md: por módulo, telas (arquivos), itens de menu, server actions (arquivo#função),
 *    abas/botões condicionados a recurso, APIs, páginas públicas, exportações, tarefas, rotinas, avisos, permissões e
 *    tabelas com uso; superfícies compartilhadas e o que ficou sem dono;
 *  - docs/modulos/matriz-dependencias.md: dependências diretas, transitivas, componentes técnicos, dependentes e política.
 *   npm run modules:inventory
 */
import fs from "node:fs";
import path from "node:path";
import { CATALOG_VERSION, FAMILIES, MODULES_CATALOG } from "../../src/lib/modules/catalog";
import { dependentsOf, transitiveComponents, transitiveRequires } from "../../src/lib/modules/graph";
import { modulesForFeature, modulesForPath } from "../../src/lib/modules/surfaces";
import { NAV, NAV_ACCOUNTING, NAV_CERTIFICATION } from "../../src/components/shell/nav";
import { USAGE_EVIDENCE } from "../../src/domain/modules/baseline";

const ROOT = path.join(__dirname, "../..");
const APP = path.join(ROOT, "src/app");
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
function walk(dir: string, pick: (f: string) => boolean, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pick, out);
    else if (pick(e.name)) out.push(p);
  }
  return out;
}
const routeOf = (file: string) => "/" + path.relative(APP, path.dirname(file)).split(path.sep).filter((s) => !/^\(.+\)$/.test(s)).join("/");

type Bucket = { pages: string[]; nav: string[]; actions: string[]; embedded: string[]; apis: string[] };
const by = new Map<string, Bucket>();
const bucket = (k: string) => {
  if (!by.has(k)) by.set(k, { pages: [], nav: [], actions: [], embedded: [], apis: [] });
  return by.get(k)!;
};
const shared: string[] = [];

// telas e rotas
for (const f of walk(APP, (n) => n === "page.tsx" || n === "route.ts")) {
  const r = routeOf(f);
  const hit = modulesForPath(r === "" ? "/" : r);
  const owners = hit?.modules ?? ["(sem dono)"];
  if (owners.length > 1) shared.push(`| \`${r}\` | ${owners.map((o) => `\`${o}\``).join(", ")} | tela/rota compartilhada: disponível se qualquer dono estiver |`);
  for (const o of owners) (r.startsWith("/api/") ? bucket(o).apis : bucket(o).pages).push(`\`${r}\` — ${rel(f)}`);
}
// menu
for (const [label, groups] of [["varejo", NAV], ["escritório", NAV_ACCOUNTING], ["parceiro da rede", NAV_CERTIFICATION]] as const) {
  for (const g of groups) for (const i of g.items) for (const o of modulesForPath(i.href)?.modules ?? ["(sem dono)"]) bucket(o).nav.push(`${g.label} › ${i.label} (${label})${i.action ? ` · exige ${i.action}` : ""}${i.feature ? ` · recurso ${i.feature}` : ""}`);
}
// server actions
for (const f of walk(APP, (n) => n === "actions.ts")) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/runAction\(\{ entitlement: (\[[^\]]+\]|"[^"]+"), action: "([^"]+)"/g)) {
    const keys: string[] = JSON.parse(m[1].startsWith("[") ? m[1] : `[${m[1]}]`);
    if (keys.length > 1) shared.push(`| \`${rel(f)}#${m[2]}\` | ${keys.map((k) => `\`${k}\``).join(", ")} | ação compartilhada: basta um dono |`);
    for (const k of keys) bucket(k).actions.push(`\`${m[2]}\` — ${rel(f)}`);
  }
}
// abas, botões e telas condicionados a recurso (featureOn/requireFeature/requireFeaturePage)
for (const f of walk(path.join(ROOT, "src"), (n) => /\.(tsx?|ts)$/.test(n))) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/(featureOn|requireFeaturePage|requireFeature)\(s[^,]*,\s*"([a-zA-Z]+)"/g)) {
    for (const k of modulesForFeature(m[2])) bucket(k).embedded.push(`${m[1]}("${m[2]}") — ${rel(f)}`);
  }
}

const uniq = (a: string[]) => [...new Set(a)].sort();
const list = (title: string, a: string[]) => (a.length ? `- **${title}:**\n${uniq(a).map((x) => `  - ${x}`).join("\n")}\n` : "");
const inline = (title: string, a: string[] | undefined) => (a?.length ? `- **${title}:** ${a.map((x) => `\`${x}\``).join(", ")}\n` : "");

let md = `# Inventário de capacidades → implementação (catálogo ${CATALOG_VERSION})

> Gerado por \`npm run modules:inventory\` a partir do código (rotas, menu, ações marcadas, recursos, exportações, rotinas).
> Não edite à mão. Testes em \`tests/modules-catalog.test.ts\` recusam tela, ação, exportação, rotina ou recurso sem módulo.

Legenda de situação: **exists** já existe e está isolado · **shared_screen** usa tela/recurso compartilhado · **needs_confirmation** precisa de confirmação de negócio · **gap** lacuna (não existe; não ativável).

`;
for (const fam of Object.keys(FAMILIES)) {
  const mods = MODULES_CATALOG.filter((m) => m.family === fam);
  if (!mods.length) continue;
  md += `\n## ${FAMILIES[fam]}\n`;
  for (const m of mods) {
    const b = bucket(m.key);
    md += `\n### \`${m.key}\` — ${m.name}\n\n${m.description}\n\n`;
    md += `- **Classe:** ${m.classification} · **Disponibilidade:** ${m.availability} · **Situação no repositório:** ${m.existing}${m.parent ? ` · **Pai:** \`${m.parent}\`` : ""}\n`;
    if (m.notes) md += `- **Observação do levantamento:** ${m.notes}\n`;
    md += list("Telas e rotas", b.pages) + list("Itens de menu", b.nav) + list("Server actions (gravações)", b.actions) + list("Abas, botões e telas condicionados a recurso", b.embedded) + list("APIs", b.apis);
    md += inline("Páginas públicas", m.surfaces.publicRoutes) + inline("Exportações", m.surfaces.exports) + inline("Tarefas duráveis (fila)", m.surfaces.jobs) + inline("Rotinas diárias", m.surfaces.routines);
    md += inline("Avisos de terceiros (webhooks)", m.surfaces.webhooks) + inline("Recursos de Parâmetros", m.surfaces.features) + inline("Permissões de perfil", m.surfaces.permissions);
    md += m.surfaces.embedded?.length ? `- **Pontos dentro de outras telas:** ${m.surfaces.embedded.join("; ")}\n` : "";
    const ev = USAGE_EVIDENCE[m.key];
    md += ev ? `- **Dados (evidência de uso na linha de base):** tabela \`${ev.collection}\`${ev.filters ? ` com ${JSON.stringify(ev.filters)}` : ""}\n` : "";
    md += `- **Ao desligar:** ${m.deactivation.mode}${m.deactivation.blockers?.length ? ` (pendências: ${m.deactivation.blockers.map((x) => `\`${x}\``).join(", ")})` : ""}; depois: ${m.deactivation.afterOff === "read_history" ? "consulta histórica" : "oculto"}.${m.deactivation.obligations?.length ? " " + m.deactivation.obligations.join(" ") : ""}\n`;
  }
}
md += `\n## Superfícies compartilhadas\n\n| Superfície | Donos | Regra |\n|---|---|---|\n${uniq(shared).join("\n")}\n`;
const orphan = bucket("(sem dono)");
md += `\n## Sem dono\n\n${orphan.pages.length + orphan.nav.length + orphan.apis.length ? list("Itens", [...orphan.pages, ...orphan.nav, ...orphan.apis]) : "Nenhuma tela, rota, item de menu ou API sem módulo."}\n`;
fs.writeFileSync(path.join(ROOT, "docs/modulos/inventario-capacidades.md"), md);

// matriz de dependências
let mx = `# Matriz de dependências (catálogo ${CATALOG_VERSION})\n\n> Gerado por \`npm run modules:inventory\`. Dependência **obrigatória** = regra real de negócio; **componente técnico** = serviço compartilhado que fica ativo sozinho; **integração opcional** = funciona quando o outro módulo também está habilitado.\n\n`;
mx += `| Módulo | Classe | Pai | Obrigatórias diretas | Basta um de | Transitivas | Componentes técnicos | Dependentes | Integrações opcionais | Pré-requisitos de configuração | Desligamento |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
const c = (a: string[] | undefined) => (a?.length ? a.map((x) => `\`${x}\``).join(", ") : "—");
for (const m of MODULES_CATALOG) {
  mx += `| \`${m.key}\` ${m.name} | ${m.classification}${m.availability !== "available" ? ` (${m.availability})` : ""} | ${m.parent ? `\`${m.parent}\`` : "—"} | ${c(m.requires)} | ${m.requiresAny?.map((g) => g.join(" / ")).join("; ") || "—"} | ${c(transitiveRequires(MODULES_CATALOG, m.key))} | ${c(transitiveComponents(MODULES_CATALOG, m.key))} | ${c(dependentsOf(MODULES_CATALOG, m.key))} | ${m.optionalIntegrations?.map((i) => `\`${i.module}\`: ${i.effect}`).join("<br>") || "—"} | ${m.configPrereqs?.map((p) => p.description).join("<br>") || "—"} | ${m.deactivation.mode}${m.deactivation.drainDays ? ` (${m.deactivation.drainDays} d)` : ""} → ${m.deactivation.afterOff === "read_history" ? "consulta" : "oculto"} |\n`;
}
fs.writeFileSync(path.join(ROOT, "docs/modulos/matriz-dependencias.md"), mx);
console.log("gravados docs/modulos/inventario-capacidades.md e docs/modulos/matriz-dependencias.md");
