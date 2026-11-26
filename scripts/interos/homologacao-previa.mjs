/**
 * Homologação multiempresa na prévia publicada (ambiente real: Vercel + Neon), de ponta a ponta:
 *   1. interface de serviço: credenciais, escopos e erros;
 *   2. migração multiempresa: simular → aplicar, com o retrato antes/depois (valores iguais);
 *   3. duas empresas fictícias provisionadas pelo Interos (A e B), convites aceitos pela tela, primeiro login;
 *   4. dados próprios de cada uma, cadastrados pela tela;
 *   5. tentativas de acesso cruzado (tela, APIs, busca, exportação, arquivos, troca de empresa, Torre, provisionamento);
 *   6. suspensão em somente leitura e em bloqueio, e reativação.
 * Segredos só por arquivo (nunca na linha de comando nem na saída):
 *   BASE=https://… PROV_TOKEN_FILE=… TORRE_TOKEN_FILE=… SETUP_TOKEN_FILE=… OUT=pasta node scripts/interos/homologacao-previa.mjs
 * A evidência (OUT/homologacao.json + capturas) não contém tokens, senhas nem links de convite.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "@playwright/test";

const BASE = (process.env.BASE || "").replace(/\/$/, "");
const OUT = process.env.OUT || "homologacao-previa";
if (!BASE) throw new Error("Defina BASE");
const read = (env) => fs.readFileSync(process.env[env], "utf8").trim();
const PROV = read("PROV_TOKEN_FILE");
const TORRE = read("TORRE_TOKEN_FILE");
const SETUP = read("SETUP_TOKEN_FILE");
fs.mkdirSync(OUT, { recursive: true });

const RUN = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
const PASSWORD = `Hm#${crypto.randomBytes(9).toString("base64url")}9a`;
const evidence = { base: BASE, run: RUN, iniciadoEm: new Date().toISOString(), etapas: [], verificacoes: [] };
let failures = 0;

function check(nome, ok, detalhe = null) {
  evidence.verificacoes.push({ nome, ok: Boolean(ok), detalhe });
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FALHA"} ${nome}${detalhe && !ok ? ` — ${JSON.stringify(detalhe).slice(0, 300)}` : ""}`);
}
const save = () => fs.writeFileSync(path.join(OUT, "homologacao.json"), JSON.stringify(evidence, null, 2));

async function api(method, p, { auth = PROV, body, key, headers = {} } = {}) {
  const h = { "x-request-id": `homolog-${RUN}-${crypto.randomBytes(3).toString("hex")}`, ...headers };
  if (auth) h.authorization = `Bearer ${auth}`;
  if (key) h["idempotency-key"] = key;
  if (body !== undefined) h["content-type"] = "application/json";
  const r = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* texto */
  }
  return { status: r.status, json, text, headers: r.headers };
}
const svc = (method, p, o) => api(method, `/api/interos/v1${p}`, o);
const redactInvite = (v) => JSON.parse(JSON.stringify(v ?? null).replace(/\/convite\/[0-9a-f]{20,}/g, "/convite/<token>"));

// ── 1. interface de serviço ─────────────────────────────────────────────────────────────────────────────────────
{
  const st = await svc("GET", "/status");
  check("status com a credencial de provisionamento", st.status === 200 && st.json?.cliente?.escopos?.includes("provisionamento:escrita"), st.json);
  const stT = await svc("GET", "/status", { auth: TORRE });
  check("status com a credencial da Torre", stT.status === 200 && stT.json?.cliente?.escopos?.every((e) => e.startsWith("torre:")), stT.json);
  const no = await svc("GET", "/status", { auth: null });
  check("sem credencial → 401 nao_autenticado", no.status === 401 && no.json?.erro?.codigo === "nao_autenticado");
  const bad = await svc("GET", "/status", { auth: "interos-prov-homolog.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" });
  check("segredo errado → 401 (mesma resposta)", bad.status === 401 && bad.json?.erro?.codigo === "nao_autenticado");
  const cross = await svc("POST", "/empresas", { auth: TORRE, key: `torre-tenta-${RUN}`, body: {} });
  check("credencial da Torre não provisiona → 403", cross.status === 403 && cross.json?.erro?.codigo === "sem_permissao");
  const crossT = await svc("GET", `/empresas/qualquer/torre/resumo?de=2026-11-01&ate=2026-11-02`, { auth: PROV });
  check("credencial de provisionamento não lê a Torre → 403", crossT.status === 403, crossT.json);
  const prod = await fetch("https://intercerterp.vercel.app/api/interos/v1/status", { headers: { authorization: "Bearer interos-prov-homolog.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" } });
  check("produção sem credenciais → 503 servico_nao_configurado (ou ainda sem a rota)", prod.status === 503 || prod.status === 404, { status: prod.status });
  evidence.etapas.push({ etapa: "interface de serviço", status: st.json?.versao ?? null });
  save();
}

// ── 2. migração multiempresa ────────────────────────────────────────────────────────────────────────────────────
for (const modo of ["simular", "aplicar"]) {
  const t0 = Date.now();
  const r = await api("GET", `/api/setup/run?step=multiempresa&modo=${modo}&detalhe=1`, { auth: null, headers: { "x-setup-token": SETUP } });
  const rep = r.json?.detalhe ?? null;
  const resumo = r.json ? { ...r.json, detalhe: undefined } : { status: r.status, texto: r.text.slice(0, 300) };
  evidence.etapas.push({ etapa: `migração (${modo})`, ms: Date.now() - t0, resumo });
  if (rep) fs.writeFileSync(path.join(OUT, `migracao-${modo}.json`), JSON.stringify(rep, null, 2));
  check(`migração ${modo}: conferência antes/depois sem diferença`, r.status === 200 && r.json?.conferencia?.ok === true, resumo);
}
save();

// ── 3. duas empresas fictícias pelo Interos ─────────────────────────────────────────────────────────────────────
function cnpj(root8) {
  const c = `${root8}0001`.split("").map(Number);
  const dv = (len) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = w.reduce((a, x, i) => a + c[i] * x, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  c.push(dv(12));
  c.push(dv(13));
  return c.join("");
}
const root = () => String(10000000 + (crypto.randomBytes(4).readUInt32BE(0) % 89999999));
const tenants = {};
for (const [k, nome, modulos] of [
  ["A", "Aurora Utilidades", ["pdv", "vendas", "estoque", "compras", "financeiro", "fiscal", "relatorios"]],
  ["B", "Boreal Papelaria", ["pdv", "vendas", "estoque", "financeiro"]],
]) {
  const email = `admin.${k.toLowerCase()}.${RUN}@homologacao.example`;
  const body = {
    contaInterosId: `homolog-${k.toLowerCase()}-${RUN}`,
    empresa: { tipo: "varejo", razaoSocial: `${nome} Ltda (homologação ${RUN})`, nomeFantasia: `${nome} ${RUN}`, cnpj: cnpj(root()), regimeTributario: "simples", endereco: { cep: "01310100", logradouro: "Avenida Paulista", numero: k === "A" ? "100" : "200", bairro: "Bela Vista", municipio: "São Paulo", codigoMunicipioIbge: "3550308", uf: "SP" } },
    unidadeInicial: { nome: `${nome} — Matriz`, codigo: "01" },
    modulos,
    administrador: { nome: `Admin ${k} (homologação)`, email },
    entregaConvite: "interos",
    contrato: { referencia: `HML-${RUN}-${k}`, plano: "homologacao" },
  };
  const key = `homolog-criar-${k}-${RUN}`;
  const r = await svc("POST", "/empresas", { key, body });
  check(`empresa ${k} criada pelo Interos → 201`, r.status === 201 && r.json?.empresa?.implantacao?.estado === "concluida", redactInvite(r.json));
  const again = await svc("POST", "/empresas", { key, body });
  check(`empresa ${k}: reenvio com a mesma chave devolve a resposta original sem o link`, again.status === 201 && again.headers.get("idempotent-replayed") === "true" && again.json?.convite?.link === null);
  const other = await svc("POST", "/empresas", { key: `${key}-2`, body });
  check(`empresa ${k}: reenvio com outra chave não duplica (200)`, other.status === 200 && other.json?.empresa?.idEmpresa === r.json?.empresa?.idEmpresa);
  tenants[k] = { nome, email, idEmpresa: r.json?.empresa?.idEmpresa, idUnidade: r.json?.empresa?.unidades?.[0]?.idUnidade, link: r.json?.convite?.link, conta: body.contaInterosId };
  evidence.etapas.push({ etapa: `provisionamento ${k}`, idEmpresa: tenants[k].idEmpresa, contaInterosId: body.contaInterosId, modulos, resposta: redactInvite(r.json) });
}
save();

// ── navegador ───────────────────────────────────────────────────────────────────────────────────────────────────
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch(proxy ? { proxy: { server: proxy } } : {}).catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
async function newSession() {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  return { ctx, page: await ctx.newPage() };
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 70, fullPage: false }).catch(() => undefined);
}
/** Entra com e-mail e senha; devolve null (entrou) ou o texto da tela de login (recusado). */
async function login(page, loginValue, password) {
  await page.goto(`${BASE}/login`);
  await page.fill("#login", loginValue);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  const entered = await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 }).then(() => true, () => false);
  if (!entered) return (await page.locator("form").first().innerText().catch(() => "")).slice(0, 300) || "não saiu da tela de login";
  if (page.url().includes("selecionar-unidade")) {
    await page.locator("button, a").filter({ hasText: /Matriz/ }).first().click();
    await page.waitForURL((u) => !u.pathname.includes("selecionar-unidade"), { timeout: 60000 }).catch(() => undefined);
  }
  return null;
}
/** status HTTP e conteúdo de uma URL com a sessão do navegador */
async function fetchAs(ctx, p) {
  const r = await ctx.request.get(`${BASE}${p}`, { maxRedirects: 0 }).catch((e) => ({ status: () => 0, text: async () => String(e) }));
  return { status: r.status(), text: await r.text().catch(() => ""), location: r.headers?.()["location"] ?? null };
}

// ── 3b. convites aceitos pela tela e primeiro login ─────────────────────────────────────────────────────────────
for (const k of ["A", "B"]) {
  const t = tenants[k];
  const { ctx, page } = await newSession();
  await page.goto(t.link);
  await page.fill('input[name="password"]', PASSWORD);
  await page.fill('input[name="confirm"]', PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 90000 }).catch(() => undefined);
  check(`convite ${k} aceito pela tela (volta ao login)`, page.url().includes("/login"), { url: page.url().replace(/\/convite\/.*/, "/convite/<token>") });
  const reuse = await (await newSession()).page;
  await reuse.goto(t.link);
  const reused = await reuse.locator("body").innerText();
  await reuse.fill('input[name="password"]', PASSWORD).catch(() => undefined);
  await reuse.fill('input[name="confirm"]', PASSWORD).catch(() => undefined);
  await reuse.click("button[type=submit]").catch(() => undefined);
  await reuse.waitForTimeout(3000);
  // o mesmo link de novo: a ativação é recusada (fica na página do convite, sem voltar ao login)
  check(`convite ${k} é de uso único (o mesmo link não ativa de novo)`, !reuse.url().includes("/login"), { trecho: reused.slice(0, 160), depois: (await reuse.locator("body").innerText()).slice(0, 160) });
  const refused = await login(page, t.email, PASSWORD);
  check(`administrador ${k} entra no ERP`, !refused && !page.url().includes("/login"), { url: page.url(), tela: refused });
  await shot(page, `01-painel-empresa-${k}`);
  t.ctx = ctx;
  t.page = page;
}

// ── 4. dados próprios pela tela ─────────────────────────────────────────────────────────────────────────────────
for (const k of ["A", "B"]) {
  const t = tenants[k];
  const { page } = t;
  await page.goto(`${BASE}/clientes/novo`);
  t.cliente = `Cliente Exclusivo ${k} ${RUN}`;
  await page.fill('input[name="name"]', t.cliente);
  await page.locator("button[type=submit]").first().click();
  await page.waitForURL((u) => /\/clientes\/[A-Za-z0-9]{8,}$/.test(u.pathname), { timeout: 60000 }).catch(() => undefined);
  const m = /\/clientes\/([A-Za-z0-9]{8,})$/.exec(new URL(page.url()).pathname);
  t.idCliente = m?.[1] ?? null;
  check(`empresa ${k}: cliente próprio cadastrado pela tela`, Boolean(t.idCliente), { url: page.url() });
  await shot(page, `02-cliente-empresa-${k}`);
}
save();

// ── 5. ids de outra empresa (demonstração) pelo acesso rápido ───────────────────────────────────────────────────
const demo = {};
{
  const { ctx, page } = await newSession();
  await page.goto(`${BASE}/login`);
  await page.click('button[aria-label^="Entrar como Administração"]').catch(async () => page.locator('button[aria-label^="Entrar como"]').first().click());
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90000 });
  if (page.url().includes("selecionar-unidade")) {
    await page.locator("button, a").filter({ hasText: /Matriz/ }).first().click();
    await page.waitForURL((u) => !u.pathname.includes("selecionar-unidade"), { timeout: 90000 });
  }
  const firstId = async (listPath, re) => {
    await page.goto(`${BASE}${listPath}`);
    const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const hit = hrefs.find((h) => h && re.test(h));
    return hit ? re.exec(hit)[1] : null;
  };
  demo.cliente = await firstId("/clientes", /^\/clientes\/([A-Za-z0-9]{12,})$/);
  demo.produto = await firstId("/produtos", /^\/produtos\/([A-Za-z0-9]{12,})$/);
  demo.venda = await firstId("/vendas", /^\/vendas\/([A-Za-z0-9]{12,})$/);
  demo.fornecedor = await firstId("/fornecedores", /^\/fornecedores\/([A-Za-z0-9]{12,})$/);
  demo.empresa = await firstId("/administracao/empresas", /^\/administracao\/empresas\/([A-Za-z0-9]{12,})$/);
  await page.goto(`${BASE}/fiscal`);
  const fileHrefs = await page.locator("a[href*='/api/files/']").evaluateAll((as) => as.map((a) => a.getAttribute("href"))).catch(() => []);
  demo.arquivo = fileHrefs.map((h) => /\/api\/files\/([A-Za-z0-9]+)/.exec(h)?.[1]).find(Boolean) ?? null;
  if (!demo.arquivo && demo.venda) {
    await page.goto(`${BASE}/vendas/${demo.venda}`);
    const h2 = await page.locator("a[href*='/api/files/']").evaluateAll((as) => as.map((a) => a.getAttribute("href"))).catch(() => []);
    demo.arquivo = h2.map((h) => /\/api\/files\/([A-Za-z0-9]+)/.exec(h)?.[1]).find(Boolean) ?? null;
  }
  const h1 = async (p) => {
    await page.goto(`${BASE}${p}`);
    return ((await page.locator("h1").first().innerText().catch(() => "")) || "").trim() || null;
  };
  demo.nomeCliente = demo.cliente ? await h1(`/clientes/${demo.cliente}`) : null;
  demo.nomeProduto = demo.produto ? await h1(`/produtos/${demo.produto}`) : null;
  demo.nomeFornecedor = demo.fornecedor ? await h1(`/fornecedores/${demo.fornecedor}`) : null;
  demo.tituloVenda = demo.venda ? await h1(`/vendas/${demo.venda}`) : null;
  demo.ctx = ctx;
  evidence.etapas.push({ etapa: "ids da empresa de demonstração (outra empresa)", ids: { ...demo, ctx: undefined } });
  check("ids da demonstração coletados para as tentativas cruzadas", Boolean(demo.cliente && demo.produto && demo.venda), { ...demo, ctx: undefined });
}
save();

// ── 6. tentativas de acesso cruzado ─────────────────────────────────────────────────────────────────────────────
// bloqueado = página de "não encontrado" (com carregamento progressivo, o Next responde 200 e envia a página de erro),
// 404, ou redirecionamento para sem-permissão — e NENHUM dado identificador do registro da outra empresa na resposta
const NOT_FOUND_MARK = "Página ou registro não encontrado";
const notFound = (r) => r.status === 404 || (r.status >= 300 && r.status < 400 && /sem-permissao|login/.test(r.location ?? "")) || r.text.includes(NOT_FOUND_MARK) || /Sem permissão|sem-permissao/.test(r.text);
for (const [k, other] of [["A", "B"], ["B", "A"]]) {
  const t = tenants[k];
  const o = tenants[other];
  const tries = [
    [`tela: cliente da empresa ${other}`, `/clientes/${o.idCliente}`, o.cliente],
    ["tela: cliente da demonstração", `/clientes/${demo.cliente}`, demo.nomeCliente],
    ["tela: produto da demonstração", `/produtos/${demo.produto}`, demo.nomeProduto],
    ["tela: venda da demonstração", `/vendas/${demo.venda}`, demo.tituloVenda],
    ["tela: fornecedor da demonstração", `/fornecedores/${demo.fornecedor}`, demo.nomeFornecedor],
    ["tela: editar cliente da demonstração", `/clientes/${demo.cliente}/editar`, demo.nomeCliente],
  ];
  for (const [nome, p, leak] of tries) {
    if (p.includes("/null")) continue;
    const r = await fetchAs(t.ctx, p);
    const leaked = Boolean(leak && r.text.includes(leak));
    check(`${k} → ${nome}: bloqueado, sem vazar dados`, notFound(r) && !leaked, { status: r.status, location: r.location, paginaNaoEncontrado: r.text.includes(NOT_FOUND_MARK), vazou: leaked });
  }
  if (demo.arquivo) {
    const f = await fetchAs(t.ctx, `/api/files/${demo.arquivo}`);
    check(`${k} → arquivo da demonstração: 404`, f.status === 404, { status: f.status });
  }
  // lista e exportação só com os próprios dados
  const lista = await fetchAs(t.ctx, `/clientes?q=${encodeURIComponent("Cliente Exclusivo")}`);
  check(`${k} → lista de clientes: só o próprio`, lista.text.includes(t.cliente) && !lista.text.includes(o.cliente), { status: lista.status });
  const exp = await fetchAs(t.ctx, `/api/export/customers`);
  check(`${k} → exportação de clientes: só o próprio`, exp.status === 200 && exp.text.includes(t.cliente) && !exp.text.includes(o.cliente), { status: exp.status, linhas: exp.text.split("\n").length - 1 });
  const busca = await fetchAs(t.ctx, `/api/search?q=${encodeURIComponent(demo.nomeProduto ?? "Camiseta")}`);
  check(`${k} → busca global: nada de outra empresa`, busca.status === 200 && !(demo.nomeProduto && busca.text.includes(demo.nomeProduto)), { status: busca.status, trecho: busca.text.slice(0, 160) });
  const buscaO = await fetchAs(t.ctx, `/api/search?q=${encodeURIComponent(o.cliente)}`);
  check(`${k} → busca pelo cliente de ${other}: nada`, !buscaO.text.includes(o.cliente), { status: buscaO.status });
  const sw = await fetchAs(t.ctx, `/api/unit?c=${o.idEmpresa}&b=${o.idUnidade}`);
  const after = await fetchAs(t.ctx, `/clientes?q=${encodeURIComponent("Cliente Exclusivo")}`);
  check(`${k} → troca para a empresa ${other}: recusada (continua na própria)`, after.text.includes(t.cliente) && !after.text.includes(o.cliente), { status: sw.status, location: sw.location });
  const rel = await fetchAs(t.ctx, `/relatorios`);
  check(`${k} → relatórios: sem dados de outra empresa`, rel.status === 200 && !(demo.nomeProduto && rel.text.includes(demo.nomeProduto)), { status: rel.status });
}
save();

// Torre e provisionamento: cada empresa só com os próprios números
for (const k of ["A", "B"]) {
  const t = tenants[k];
  const r = await svc("GET", `/empresas/${t.idEmpresa}/torre/resumo?de=2026-11-01&ate=2026-11-30`, { auth: TORRE });
  check(`Torre ${k}: resumo só da própria empresa (sem as vendas da demonstração)`, r.status === 200 && r.json?.meta?.idEmpresa === t.idEmpresa && r.json?.vendas?.quantidadeVendas === 0, { status: r.status, vendas: r.json?.vendas?.quantidadeVendas });
  const ad = await svc("GET", `/empresas/${t.idEmpresa}/torre/adocao`, { auth: TORRE });
  check(`Torre ${k}: adoção com o próprio administrador ativo`, ad.status === 200 && ad.json?.usuarios?.ativos === 1, ad.json?.usuarios);
  const uo = await svc("GET", `/empresas/${t.idEmpresa}/torre/skus?de=2026-11-01&ate=2026-11-30&idUnidade=${tenants[k === "A" ? "B" : "A"].idUnidade}`, { auth: TORRE });
  check(`Torre ${k}: unidade de outra empresa no filtro → 422`, uo.status === 422, uo.json?.erro);
}
const lst = await svc("GET", `/empresas?limite=100`);
const ids = (lst.json?.itens ?? []).map((e) => e.idEmpresa);
check("provisionamento: lista só empresas vinculadas (A e B presentes; nenhuma da demonstração)", ids.includes(tenants.A.idEmpresa) && ids.includes(tenants.B.idEmpresa) && (lst.json?.itens ?? []).every((e) => e.contaInterosId), { total: ids.length });
const demoCompany = await svc("GET", `/empresas/${demo.empresa ?? "0".repeat(32)}`);
check("provisionamento: empresa existente mas não vinculada (demonstração) não existe para o Interos (404)", Boolean(demo.empresa) && demoCompany.status === 404, { idEmpresa: demo.empresa, status: demoCompany.status });
const demoTorre = await svc("GET", `/empresas/${demo.empresa ?? "0".repeat(32)}/torre/resumo?de=2026-11-01&ate=2026-11-30`, { auth: TORRE });
check("Torre: empresa não vinculada (demonstração) → 404", demoTorre.status === 404, { status: demoTorre.status });
save();

// ── 7. suspensão e reativação ───────────────────────────────────────────────────────────────────────────────────
{
  const B = tenants.B;
  const s1 = await svc("POST", `/empresas/${B.idEmpresa}/suspender`, { key: `homolog-susp-ro-${RUN}`, body: { modo: "somente_leitura", motivo: "Homologação: somente leitura" } });
  check("B suspensa em somente leitura", s1.status === 200 && s1.json?.empresa?.suspensao?.modo === "somente_leitura");
  const ro = await fetchAs(B.ctx, `/clientes?q=${encodeURIComponent("Cliente Exclusivo")}`);
  check("B em somente leitura: consulta continua", ro.status === 200 && ro.text.includes(B.cliente), { status: ro.status });
  await B.page.goto(`${BASE}/clientes/novo`);
  await B.page.fill('input[name="name"]', `Cliente bloqueado ${RUN}`);
  await B.page.locator("button[type=submit]").first().click();
  await B.page.waitForTimeout(4000);
  const msg = await B.page.locator("body").innerText();
  check("B em somente leitura: gravação recusada", !/\/clientes\/[A-Za-z0-9]{8,}$/.test(new URL(B.page.url()).pathname) && /somente leitura|suspens/i.test(msg), { url: B.page.url(), trecho: msg.match(/.{0,80}(somente leitura|suspens).{0,80}/i)?.[0] ?? null });
  await shot(B.page, "03-empresa-B-somente-leitura");
  const s2 = await svc("POST", `/empresas/${B.idEmpresa}/suspender`, { key: `homolog-susp-bl-${RUN}`, body: { modo: "bloqueio", motivo: "Homologação: bloqueio" } });
  check("B suspensa em bloqueio", s2.status === 200 && s2.json?.empresa?.suspensao?.modo === "bloqueio");
  const bl = await fetchAs(B.ctx, `/clientes`);
  check("B em bloqueio: a sessão aberta perde o acesso", bl.status !== 200 || !bl.text.includes(B.cliente), { status: bl.status, location: bl.location });
  const { page: p2 } = await newSession();
  await p2.goto(`${BASE}/login`);
  await p2.fill("#login", B.email);
  await p2.fill("#password", PASSWORD);
  await p2.click("button[type=submit]");
  await p2.waitForTimeout(5000);
  check("B em bloqueio: novo login não entra na empresa", p2.url().includes("/login") || p2.url().includes("selecionar-unidade"), { url: p2.url() });
  await shot(p2, "04-empresa-B-bloqueio-login");
  const ra = await svc("POST", `/empresas/${B.idEmpresa}/reativar`, { key: `homolog-reat-${RUN}`, body: { motivo: "Homologação concluída" } });
  check("B reativada, com o histórico das suspensões", ra.status === 200 && ra.json?.empresa?.situacao === "ativa" && (ra.json?.empresa?.historicoSituacao ?? []).length >= 3, ra.json?.empresa?.historicoSituacao);
  const { page: p3 } = await newSession();
  const refused = await login(p3, B.email, PASSWORD);
  check("B reativada: o administrador entra de novo, na hora", !refused && !p3.url().includes("/login"), { url: p3.url(), tela: refused });
  const back = await svc("GET", `/empresas/${B.idEmpresa}`);
  check("B reativada: tarefas liberadas e histórico preservado na consulta", back.status === 200 && back.json?.empresa?.situacao === "ativa", { situacao: back.json?.empresa?.situacao });
}

evidence.terminadoEm = new Date().toISOString();
evidence.resultado = { verificacoes: evidence.verificacoes.length, falhas: failures };
evidence.empresas = Object.fromEntries(Object.entries(tenants).map(([k, t]) => [k, { idEmpresa: t.idEmpresa, contaInterosId: t.conta, idUnidade: t.idUnidade, idCliente: t.idCliente }]));
save();
await browser.close();
console.log(`\n${evidence.verificacoes.length} verificações, ${failures} falha(s). Evidência: ${path.join(OUT, "homologacao.json")}`);
process.exit(failures ? 1 : 0);
