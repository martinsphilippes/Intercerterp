/**
 * Catálogo hierárquico v2 (PROPOSTA — Fase 3): Produto → Módulo (NN) → Submódulo (NN.SS) → Recurso (NN.SS.RR) → Permissão.
 *
 * Entradas (todas versionadas no repositório):
 *  - docs/MODULE_CATALOG/taxonomia-referencia.txt — taxonomia mínima do titular (literal)
 *  - docs/MODULE_CATALOG/extras.tsv               — funcionalidades existentes fora da taxonomia (módulos 51+ e submódulos novos)
 *  - docs/MODULE_CATALOG/auditoria/*.tsv          — status e evidência de cada código, auditado no código-fonte
 *  - docs/MODULE_CATALOG/duplicidades.tsv         — proprietário técnico e aliases
 *  - docs/MODULE_CATALOG/classificacao.tsv        — ajustes de classificação (PERMISSÃO, INTEGRAÇÃO, CORE…)
 *  - src/lib/modules/catalog.ts                   — catálogo v1 (runtime): unidades contratáveis e dependências
 *
 * Saídas: docs/MODULE_CATALOG/catalogo-modulos-erp-v2.json e docs/MODULE_CATALOG/catalogo-v2.md
 *   npx tsx scripts/modules/build-catalog-v2.ts [--check]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MODULES_CATALOG, MODULE_MAP } from "../../src/lib/modules/catalog";
import { SPECIAL_ACTIONS } from "../../src/lib/permissions";

const ROOT = path.join(__dirname, "../..");
const DIR = path.join(ROOT, "docs/MODULE_CATALOG");
const CREATED = "2026-11-26";
export const CATALOG_V2_VERSION = "2.0.0-proposta";

export type DevStatus = "OP" | "PARC" | "FALHA" | "DEV" | "PLAN" | "NAO" | "EXT" | "DESC";
export const DEV_STATUS_LABEL: Record<DevStatus, string> = {
  OP: "Implementado e operacional", PARC: "Implementado parcialmente", FALHA: "Implementado, mas com falhas", DEV: "Em desenvolvimento",
  PLAN: "Planejado", NAO: "Não implementado", EXT: "Dependente de integração externa", DESC: "Descontinuado",
};
export type CommercialClass = "CORE" | "MODULO_COMERCIAL" | "ADD_ON" | "INTEGRACAO" | "RECURSO_COMPARTILHADO" | "PERMISSAO" | "RECURSO_FUTURO";

/** Slug do módulo (nível 2) — estável. */
export const MODULE_SLUG: Record<string, string> = {
  "01": "cadastros", "02": "fiscal_config", "03": "fiscal_entrada", "04": "fiscal_emissao", "05": "compras", "06": "vendas", "07": "pdv",
  "08": "trocas", "09": "produtos", "10": "estoque", "11": "catalogo", "12": "ecommerce", "13": "whatsapp", "14": "food", "15": "composicao",
  "16": "pcp", "17": "logistica", "18": "financeiro", "19": "bancos", "20": "crm", "21": "bi", "22": "contabil", "23": "equipamentos",
  "24": "admin", "25": "precificacao", "26": "servicos", "27": "contratos", "28": "locacoes", "29": "patrimonio", "30": "manutencao",
  "31": "rh", "32": "tarefas", "33": "documentos", "34": "multiempresa", "35": "marketplaces", "36": "pagamentos", "37": "apps",
  "38": "automacao", "39": "qualidade", "40": "frotas", "41": "wms", "42": "comex", "43": "vendas_externas", "44": "agenda",
  "45": "garantias", "46": "supermercado", "47": "moda", "48": "certificacao", "49": "suporte", "50": "configuracoes",
};

const STOP = new Set(["de", "da", "do", "das", "dos", "e", "em", "por", "para", "com", "a", "o", "as", "os", "na", "no", "ao"]);
export function slugify(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).join("_").slice(0, 60);
}
/** ID interno imutável: derivado do código NA CRIAÇÃO e gravado no JSON; nunca recalculado para um código existente. */
const stableId = (code: string) => {
  const h = crypto.createHash("sha256").update(`intercert-erp|${code}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

interface Node {
  id: string;
  code: string;
  level: "module" | "submodule" | "resource";
  name: string;
  technicalName: string;
  slug: string;
  description: string;
  parent: string | null;
  origin: "taxonomia" | "auditoria";
  devStatus: DevStatus;
  devStatusLabel: string;
  availability: "disponivel" | "indisponivel";
  commercialClass: CommercialClass;
  technicalClass: "core" | "commercial" | "addon" | "integration" | "shared" | "permission" | "future";
  aliasOf: string | null;
  aliases: string[];
  reuses: string | null;
  v1Keys: string[];
  commercialUnit: string | null;
  includedIn: string | null;
  dependencies: { required: string[]; optional: string[] };
  routes: string[];
  apis: string[];
  permissions: string[];
  evidence: string[];
  notes: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

/** Todos os arquivos do repositório (para resolver evidências abreviadas como "schema.ts:228"). */
let FILES: string[] | null = null;
function repoFiles(): string[] {
  if (FILES) return FILES;
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = d ? `${d}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  for (const d of ["src", "public", "docs", "tests", "scripts"]) walk(d);
  return (FILES = out);
}

/**
 * Evidência "arquivo:linhas[ anotação]" separada por ";". Caminho abreviado é resolvido pelo nome do arquivo,
 * preferindo a pasta da evidência anterior. Diretórios (ex.: src/app/(app)/pdv) também valem.
 */
export function resolveEvidence(raw: string): string[] {
  const out: string[] = [];
  let prevDir = "";
  for (const part of raw.split(";")) {
    let tok = part.trim().split(/\s+/)[0] ?? "";
    if (!tok || tok === "-") continue;
    tok = tok.replace(/^\(app\)\//, "src/app/(app)/").replace(/\/\*$/, "");
    const [file, lines] = tok.split(/:(?=[\d,-]+$)/);
    let resolved = file;
    if (!fs.existsSync(path.join(ROOT, file))) {
      const base = path.basename(file);
      const hits = repoFiles().filter((f) => f === file || f.endsWith("/" + file) || (!file.includes("/") && path.basename(f) === base));
      resolved = hits.find((h) => prevDir && h.startsWith(prevDir)) ?? hits.find((h) => h.startsWith("src/")) ?? hits[0] ?? file;
    }
    prevDir = path.dirname(resolved);
    out.push(lines ? `${resolved}:${lines}` : resolved);
  }
  return out;
}

function readTsv(file: string): string[][] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.split("\t").map((c) => c.trim()));
}

export function buildCatalogV2() {
  const nodes = new Map<string, Node>();
  const blank = (code: string, name: string, level: Node["level"], parent: string | null, origin: Node["origin"]): Node => ({
    id: stableId(code), code, level, name, technicalName: "", slug: "", description: name, parent, origin, devStatus: "NAO", devStatusLabel: "", availability: "indisponivel",
    commercialClass: "RECURSO_FUTURO", technicalClass: "future", aliasOf: null, aliases: [], reuses: null, v1Keys: [], commercialUnit: null, includedIn: null,
    dependencies: { required: [], optional: [] }, routes: [], apis: [], permissions: [], evidence: [], notes: "", version: "2.0.0", createdAt: CREATED, updatedAt: CREATED,
  });
  // 1. taxonomia literal
  let mod = "";
  for (const line of fs.readFileSync(path.join(DIR, "taxonomia-referencia.txt"), "utf8").split("\n")) {
    const m = /^MÓDULO (\d\d) — (.+)$/.exec(line);
    if (m) {
      mod = m[1];
      nodes.set(mod, blank(mod, m[2], "module", null, "taxonomia"));
      continue;
    }
    const s = /^(\d\d\.\d\d) — (.+)$/.exec(line);
    if (s) nodes.set(s[1], blank(s[1], s[2], "submodule", mod, "taxonomia"));
  }
  // 2. funcionalidades encontradas fora da taxonomia (código, nome, nível, pai, slug do módulo quando 51+)
  for (const [code, name, , , , moduleSlug] of readTsv(path.join(DIR, "extras.tsv"))) {
    const level: Node["level"] = /^\d\d$/.test(code) ? "module" : /^\d\d\.\d\d$/.test(code) ? "submodule" : "resource";
    const parent = level === "module" ? null : code.split(".").slice(0, -1).join(".");
    if (nodes.has(code)) throw new Error(`extras.tsv: código já existe na taxonomia: ${code}`);
    nodes.set(code, blank(code, name, level, parent, "auditoria"));
    if (level === "module" && moduleSlug) MODULE_SLUG[code] = moduleSlug;
  }
  // 3. auditoria (status + evidência + chaves v1 citadas entre colchetes)
  const audited = new Set<string>();
  const auditDir = path.join(DIR, "auditoria");
  const extraRows = readTsv(path.join(DIR, "extras.tsv")).map(([code, , status, evidence, note]) => [code, status, evidence, note]);
  const rows = [...(fs.existsSync(auditDir) ? fs.readdirSync(auditDir).filter((f) => f.endsWith(".tsv")).sort().flatMap((f) => readTsv(path.join(auditDir, f))) : []), ...extraRows];
  for (const [code, status, evidence, note] of rows) {
    const n = nodes.get(code);
    if (!n) continue;
    if (n.level !== "module") audited.add(code);
    n.devStatus = (["OP", "PARC", "FALHA", "DEV", "PLAN", "NAO", "EXT", "DESC"].includes(status) ? status : "NAO") as DevStatus;
    n.evidence = evidence && evidence !== "-" ? resolveEvidence(evidence) : [];
    n.v1Keys = [...new Set([...(note ?? "").matchAll(/\b([a-z]+\.[a-z_]+)\b/g)].map((m) => m[1]).filter((k) => MODULE_MAP.has(k)))];
    n.notes = (note ?? "").replace(/\[[^\]]+\]/g, "").trim();
  }
  // 4. classificação
  const overrides = new Map(readTsv(path.join(DIR, "classificacao.tsv")).map(([code, cls, perms, note]) => [code, { cls: cls as CommercialClass, perms: perms && perms !== "-" ? perms.split(",") : [], note }]));
  for (const n of nodes.values()) {
    if (n.level === "module") continue;
    // EXT: a parte do ERP existe e está testada; a operação real depende do provedor externo (não liberável ainda)
    const implemented = ["OP", "PARC", "FALHA", "EXT"].includes(n.devStatus);
    const v1 = n.v1Keys.map((k) => MODULE_MAP.get(k)!);
    let cls: CommercialClass = "RECURSO_FUTURO";
    if (n.devStatus === "EXT" && !v1.length) cls = "INTEGRACAO";
    else if (implemented) {
      if (v1.some((d) => d.classification === "platform")) cls = "CORE";
      else if (v1.some((d) => d.classification === "technical")) cls = "RECURSO_COMPARTILHADO";
      else if (v1.some((d) => d.classification === "commercial")) cls = "MODULO_COMERCIAL";
      else if (v1.some((d) => d.classification === "optional_function")) cls = "ADD_ON";
      else cls = "ADD_ON";
    }
    const o = overrides.get(n.code);
    if (o && (implemented || o.cls === "RECURSO_FUTURO" || o.cls === "INTEGRACAO")) cls = o.cls;
    if (o?.perms.length) n.permissions = o.perms;
    if (o?.note) n.notes = [n.notes, o.note].filter(Boolean).join(" · ");
    n.commercialClass = cls;
  }
  // 5. duplicidades: aliases e reusos
  for (const [alias, owner, rel, note] of readTsv(path.join(DIR, "duplicidades.tsv"))) {
    const a = nodes.get(alias);
    const o = nodes.get(owner);
    if (!a || !o || rel === "-") continue;
    if (rel === "alias") {
      a.aliasOf = owner;
      o.aliases.push(alias);
    } else a.reuses = owner;
    a.notes = [a.notes, note].filter(Boolean).join(" · ");
  }
  // 6. unidade comercial: definida explicitamente por chave v1 (unidades.tsv); os demais códigos que citam a chave vêm incluídos nela
  const unitOfV1 = new Map<string, string>();
  for (const [k, code] of readTsv(path.join(DIR, "unidades.tsv"))) {
    if (!MODULE_MAP.has(k)) throw new Error(`unidades.tsv: chave v1 inexistente ${k}`);
    const n = nodes.get(code);
    if (!n) throw new Error(`unidades.tsv: código v2 inexistente ${code}`);
    unitOfV1.set(k, code);
    if (!n.v1Keys.includes(k)) n.v1Keys.unshift(k);
  }
  const ordered = [...nodes.values()].filter((n) => n.level !== "module").sort((a, b) => a.code.localeCompare(b.code));
  const units = new Set(unitOfV1.values());
  for (const n of ordered) {
    if (n.aliasOf) {
      n.includedIn = n.aliasOf;
      continue;
    }
    if (units.has(n.code)) {
      n.commercialUnit = n.code;
      continue;
    }
    if (!["OP", "PARC", "FALHA", "EXT"].includes(n.devStatus)) continue;
    const unit = n.v1Keys.map((k) => unitOfV1.get(k)).find(Boolean);
    if (unit) n.includedIn = unit;
  }
  // 7. dependências derivadas do grafo v1 (já validado sem ciclos), traduzidas para unidades v2
  for (const n of ordered) {
    if (!n.commercialUnit) continue;
    const req = new Set<string>();
    const opt = new Set<string>();
    for (const k of n.v1Keys) {
      const d = MODULE_MAP.get(k);
      for (const r of [...(d?.parent ? [d.parent] : []), ...(d?.requires ?? [])]) {
        const u = unitOfV1.get(r);
        if (u && u !== n.code) req.add(u);
      }
      for (const i of d?.optionalIntegrations ?? []) {
        const u = unitOfV1.get(i.module);
        if (u && u !== n.code) opt.add(u);
      }
    }
    n.dependencies = { required: [...req].sort(), optional: [...opt].filter((x) => !req.has(x)).sort() };
  }
  // 8. rotas, APIs e permissões (evidência do app + superfícies v1 da unidade)
  for (const n of nodes.values()) {
    for (const e of n.evidence) {
      const file = e.split(":")[0];
      const m = /^src\/app\/(.+)\/(page\.tsx|route\.ts)$/.exec(file);
      if (!m) continue;
      const route = "/" + m[1].split("/").filter((s) => !/^\(.+\)$/.test(s)).join("/");
      (route.startsWith("/api/") ? n.apis : n.routes).push(route);
    }
    if (n.commercialUnit) {
      for (const k of n.v1Keys) {
        const d = MODULE_MAP.get(k)!;
        n.permissions.push(...(d.surfaces.permissions ?? []));
        if (!n.routes.length) n.routes.push(...(d.surfaces.routes ?? []));
        n.apis.push(...(d.surfaces.apis ?? []), ...(d.surfaces.webhooks ?? []));
      }
    }
    n.routes = [...new Set(n.routes)];
    n.apis = [...new Set(n.apis)];
    n.permissions = [...new Set(n.permissions)];
  }
  // 9. campos derivados, módulos e disponibilidade
  const slugs = new Set<string>();
  for (const n of [...nodes.values()].sort((a, b) => a.code.localeCompare(b.code))) {
    const ms = MODULE_SLUG[n.code.slice(0, 2)] ?? `modulo_${n.code.slice(0, 2)}`;
    n.slug = n.level === "module" ? ms : `${ms}.${slugify(n.name)}`;
    if (slugs.has(n.slug)) n.slug = `${n.slug}_${n.code.replace(/\./g, "_")}`;
    slugs.add(n.slug);
    n.technicalName = n.slug.replace(/\./g, "__");
    if (n.level === "module") {
      const kids = [...nodes.values()].filter((k) => k.parent === n.code);
      const impl = kids.filter((k) => ["OP", "PARC", "FALHA"].includes(k.devStatus));
      n.devStatus = !impl.length ? (kids.some((k) => k.devStatus === "EXT") ? "EXT" : "NAO") : impl.length === kids.length && impl.every((k) => k.devStatus === "OP") ? "OP" : "PARC";
      n.commercialClass = ["24", "49"].includes(n.code) ? "CORE" : impl.length ? "MODULO_COMERCIAL" : "RECURSO_FUTURO";
      n.v1Keys = [...new Set(kids.flatMap((k) => k.v1Keys))];
    }
    n.devStatusLabel = DEV_STATUS_LABEL[n.devStatus];
    // só funcionalidade operacional e validada pode ser liberada pelo Interos
    n.availability = n.devStatus === "OP" && n.commercialClass !== "RECURSO_FUTURO" ? "disponivel" : "indisponivel";
    n.technicalClass = ({ CORE: "core", MODULO_COMERCIAL: "commercial", ADD_ON: "addon", INTEGRACAO: "integration", RECURSO_COMPARTILHADO: "shared", PERMISSAO: "permission", RECURSO_FUTURO: "future" } as const)[n.commercialClass];
  }
  const all = [...nodes.values()].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  return { nodes: all, audited, unitOfV1 };
}

export function catalogV2Document() {
  const { nodes, audited, unitOfV1 } = buildCatalogV2();
  const count = (f: (n: Node) => boolean) => nodes.filter(f).length;
  const v1Unmapped = MODULES_CATALOG.filter((m) => (m.classification === "commercial" || m.classification === "optional_function") && m.availability !== "planned" && !unitOfV1.has(m.key)).map((m) => m.key);
  return {
    catalog: "catalogo-modulos-erp-v2",
    catalogVersion: CATALOG_V2_VERSION,
    status: "proposta — aguarda validação do titular antes de substituir o catálogo v1 em runtime",
    product: { code: "ERP", name: "ERP Intercert", slug: "erp_intercert" },
    hierarchy: ["Produto", "Módulo (NN)", "Submódulo (NN.SS)", "Recurso (NN.SS.RR)", "Permissão (perfil)"],
    devStatus: DEV_STATUS_LABEL,
    commercialClasses: {
      CORE: "Essencial ao funcionamento, segurança e integridade; não pode ser desativado",
      MODULO_COMERCIAL: "Contratável independentemente", ADD_ON: "Adicional vinculado a um módulo principal",
      INTEGRACAO: "Conector com serviço externo", RECURSO_COMPARTILHADO: "Usado por vários módulos; proprietário técnico único",
      PERMISSAO: "Ação controlada pelo perfil do usuário (não comercial)", RECURSO_FUTURO: "Planejado ou inexistente; indisponível comercialmente",
    },
    totals: {
      modules: count((n) => n.level === "module"), submodules: count((n) => n.level === "submodule"), resources: count((n) => n.level === "resource"),
      operational: count((n) => n.level !== "module" && n.devStatus === "OP"), partial: count((n) => n.level !== "module" && ["PARC", "FALHA"].includes(n.devStatus)),
      external: count((n) => n.level !== "module" && n.devStatus === "EXT"), future: count((n) => n.level !== "module" && ["NAO", "PLAN", "DEV"].includes(n.devStatus)),
      commercialUnits: count((n) => Boolean(n.commercialUnit)), aliases: count((n) => Boolean(n.aliasOf)), audited: audited.size,
    },
    v1Compatibility: { unitsByV1Key: Object.fromEntries([...unitOfV1.entries()].sort()), v1KeysWithoutV2Unit: v1Unmapped },
    permissions: SPECIAL_ACTIONS.map((a) => ({ key: a.key, label: a.label, classification: "PERMISSAO", units: nodes.filter((n) => n.permissions.includes(a.key) && n.commercialUnit).map((n) => n.code) })),
    items: nodes,
  };
}

function markdown(doc: ReturnType<typeof catalogV2Document>): string {
  const t = doc.totals;
  let md = `# Catálogo de módulos v2 (${doc.catalogVersion})\n\n> Gerado por \`npx tsx scripts/modules/build-catalog-v2.ts\`. ${doc.status}.\n\n`;
  md += `| Módulos | Submódulos | Recursos | Operacionais | Parciais | Dependentes de integração | Futuros | Unidades comerciais | Aliases |\n|---|---|---|---|---|---|---|---|---|\n`;
  md += `| ${t.modules} | ${t.submodules} | ${t.resources} | ${t.operational} | ${t.partial} | ${t.external} | ${t.future} | ${t.commercialUnits} | ${t.aliases} |\n\n`;
  md += `Legenda — Classe: CORE · MOD (módulo comercial) · ADD (add-on) · INT (integração) · COMP (compartilhado) · PERM (permissão) · FUT (futuro). Unidade: **U** = vendida por si; → código = incluída em; ≡ código = alias de.\n`;
  const short: Record<string, string> = { CORE: "CORE", MODULO_COMERCIAL: "MOD", ADD_ON: "ADD", INTEGRACAO: "INT", RECURSO_COMPARTILHADO: "COMP", PERMISSAO: "PERM", RECURSO_FUTURO: "FUT" };
  for (const m of doc.items.filter((n) => n.level === "module")) {
    md += `\n## ${m.code} — ${m.name} · \`${m.slug}\` · ${m.devStatusLabel} · ${short[m.commercialClass]}\n\n| Código | Submódulo / recurso | Slug | Status | Classe | Unidade | Dependências | Chave v1 | Evidência / observação |\n|---|---|---|---|---|---|---|---|---|\n`;
    for (const n of doc.items.filter((x) => x.code.startsWith(m.code + ".")).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))) {
      const unit = n.aliasOf ? `≡ ${n.aliasOf}` : n.commercialUnit ? "**U**" : n.includedIn ? `→ ${n.includedIn}` : "";
      md += `| ${n.code} | ${n.level === "resource" ? "↳ " : ""}${n.name}${n.origin === "auditoria" ? " *(achado na auditoria)*" : ""} | \`${n.slug}\` | ${n.devStatus} | ${short[n.commercialClass]} | ${unit} | ${n.dependencies.required.join(", ")} | ${n.v1Keys.map((k) => `\`${k}\``).join(" ")} | ${[n.evidence.slice(0, 2).map((e) => `\`${e}\``).join(" "), n.notes].filter(Boolean).join(" — ").replace(/\|/g, "/")} |\n`;
    }
  }
  return md;
}

/**
 * Módulo de runtime compacto (src/lib/modules/units-v2.generated.ts): unidades comerciais v2 ↔ chaves v1, aliases,
 * inclusões e o que é vendável. Decisão do titular (26/11/2026): unidade dependente de integração externa (EXT) ou em
 * desenvolvimento só é vendável depois da homologação; parcial é vendável pelo que existe.
 */
export function runtimeUnitsModule(doc: ReturnType<typeof catalogV2Document>): string {
  const units = doc.items.filter((n) => n.commercialUnit).map((n) => ({
    code: n.code, name: n.name, slug: n.slug, v1Key: Object.entries(doc.v1Compatibility.unitsByV1Key).find(([, c]) => c === n.code)?.[0] ?? null,
    devStatus: n.devStatus, sellable: ["OP", "PARC", "FALHA"].includes(n.devStatus), requires: n.dependencies.required,
  }));
  const aliasOf = Object.fromEntries(doc.items.filter((n) => n.aliasOf).map((n) => [n.code, n.aliasOf]));
  const includedIn = Object.fromEntries(doc.items.filter((n) => n.includedIn && !n.aliasOf).map((n) => [n.code, n.includedIn]));
  const known = doc.items.map((n) => n.code);
  return `// GERADO por scripts/modules/build-catalog-v2.ts — não edite. Catálogo ${doc.catalogVersion}.
export const CATALOG_V2_VERSION = ${JSON.stringify(doc.catalogVersion)};
export interface UnitV2 { code: string; name: string; slug: string; v1Key: string | null; devStatus: string; sellable: boolean; requires: string[] }
export const UNITS_V2: UnitV2[] = ${JSON.stringify(units, null, 1)};
export const ALIAS_OF: Record<string, string> = ${JSON.stringify(aliasOf)};
export const INCLUDED_IN: Record<string, string> = ${JSON.stringify(includedIn)};
export const KNOWN_CODES: string[] = ${JSON.stringify(known)};
`;
}

if (require.main === module) {
  const doc = catalogV2Document();
  const unitsFile = path.join(ROOT, "src/lib/modules/units-v2.generated.ts");
  const unitsSrc = runtimeUnitsModule(doc);
  const json = JSON.stringify(doc, null, 2) + "\n";
  const md = markdown(doc);
  const jf = path.join(DIR, "catalogo-modulos-erp-v2.json");
  const mf = path.join(DIR, "catalogo-v2.md");
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(jf, "utf8") !== json || fs.readFileSync(mf, "utf8") !== md || fs.readFileSync(unitsFile, "utf8") !== unitsSrc) {
      console.error("catálogo v2 desatualizado: rode npx tsx scripts/modules/build-catalog-v2.ts");
      process.exit(1);
    }
    console.log("catálogo v2 em dia");
  } else {
    fs.writeFileSync(jf, json);
    fs.writeFileSync(mf, md);
    fs.writeFileSync(unitsFile, unitsSrc);
    console.log(JSON.stringify(doc.totals), "v1 sem unidade v2:", doc.v1Compatibility.v1KeysWithoutV2Unit);
  }
}
