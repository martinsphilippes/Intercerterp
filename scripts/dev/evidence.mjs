// Captura evidências de interface (48 telas + 14 visões) em docs/evidencias/<nome>.png.
// Requer a aplicação rodando (BASE_URL, padrão http://localhost:3000) com a base de demonstração.
// Uso: node scripts/dev/evidence.mjs [filtro-de-nome]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const base = process.env.BASE_URL || "http://localhost:3000";
const out = path.resolve(process.env.OUT_DIR || "docs/evidencias");
const password = process.env.DEMO_PASSWORD || "Intercert@2026";
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror ${page.url()}: ${e.message}`));

async function shot(name, opts = {}) {
  if (only && !only.test(name)) return;
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(opts.wait ?? 300);
  const errText = await page.locator("text=/Unhandled Runtime Error|Application error|This page could not be found/").count();
  if (errText) problems.push(`erro visível em ${name} (${page.url()})`);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: opts.full ?? true });
  console.log("ok", name, page.url().replace(base, ""));
}

async function go(p) {
  const res = await page.goto(base + p, { timeout: 120000 });
  if (res && res.status() >= 400) problems.push(`${p} → HTTP ${res.status()}`);
}

/** Abre a lista e segue o primeiro link cujo caminho casa com o padrão. */
async function firstLink(listPath, re) {
  await go(listPath);
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  const href = hrefs.find((h) => h && re.test(h.split("?")[0]));
  if (!href) {
    problems.push(`sem link ${re} em ${listPath}`);
    return null;
  }
  return href.split("#")[0];
}

// 01 — login (sem sessão)
await go("/login");
await shot("01-login");
await page.fill("#login", process.env.LOGIN || "admin");
await page.fill("#password", password);
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
if (!page.url().includes("selecionar-unidade")) await go("/selecionar-unidade");
await shot("02-selecionar-unidade");
await page.getByText(process.env.BRANCH || "Matriz — Centro").first().click();
await page.waitForURL((u) => !u.pathname.startsWith("/selecionar-unidade"), { timeout: 60000 }).catch(() => {});

await go("/dashboard");
await shot("03-dashboard");

// 04–07 — PDV
await go("/pdv");
await page.waitForLoadState("networkidle").catch(() => {});
const search = page.getByLabel(/Buscar produto por descrição/);
if (await search.count()) {
  await search.fill("camiseta");
  await page.waitForTimeout(1200);
  await shot("05-pdv-busca", { full: false });
  await search.press("Enter");
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await search.fill("tenis");
  await page.waitForTimeout(1200);
  await search.press("Enter");
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
}
await shot("04-pdv", { full: false });
await page.keyboard.press("F4");
await page.waitForTimeout(800);
await shot("06-pdv-cliente", { full: false });
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await page.keyboard.press("F10");
await page.waitForURL((u) => u.pathname.startsWith("/pdv/pagamento"), { timeout: 15000 }).catch(() => problems.push("F10 não abriu o pagamento"));
await shot("07-pagamento", { full: false });

// 08–11 — vendas
const sale = await firstLink("/vendas", /^\/vendas\/(?!devolucoes)[A-Za-z0-9_-]{8,}$/);
await go("/vendas");
await shot("09-vendas");
if (sale) {
  await go(`${sale}/conclusao`);
  await shot("08-conclusao");
  await go(sale);
  await shot("10-venda-detalhe");
  await go(`${sale}/devolucoes`);
  await shot("11-devolucao");
}

// 12–14 — caixa
for (const [name, p] of [["12-caixa-abertura", "/caixa/abertura"], ["13-caixa-movimentos", "/caixa/movimentos"], ["14-caixa-fechamento", "/caixa/fechamento"]]) {
  await go(p);
  await shot(name);
}

// 15–19 — produtos e estoque
await go("/produtos");
await shot("15-produtos");
const product = await firstLink("/produtos", /^\/produtos\/(?!novo|importar|cadastros)[A-Za-z0-9_-]{8,}$/);
if (product) {
  await go(`${product}?tab=variacoes`);
  await shot("16-produto");
  await go(`${product}?tab=fiscal`);
  await shot("v01-produto-fiscal");
  await go(`${product}?tab=precos`);
  await shot("v02-produto-precos");
}
await go("/estoque/movimentos");
await shot("17-movimentos");
const transfer = await firstLink("/estoque/transferencias?filial=all", /^\/estoque\/transferencias\/(?!novo)[A-Za-z0-9_-]{8,}$/);
if (transfer) {
  await go(transfer);
  await shot("18-transferencia");
}
const inventory = await firstLink("/estoque/inventarios?filial=all", /^\/estoque\/inventarios\/[A-Za-z0-9_-]{8,}$/);
if (inventory) {
  await go(inventory);
  await shot("19-inventario");
}

// 20–21 — clientes
await go("/clientes");
await shot("20-clientes");
const customer = await firstLink("/clientes", /^\/clientes\/(?!novo)[A-Za-z0-9_-]{8,}$/);
if (customer) {
  await go(`${customer}/editar`);
  await shot("21-cliente");
}

// 22–25 — financeiro
await go("/financeiro/receber");
await shot("22-receber");
const receivable = await firstLink("/financeiro/receber", /^\/financeiro\/receber\/(?!novo)[A-Za-z0-9_-]{8,}$/);
if (receivable) {
  await go(receivable);
  await shot("v03-receber-titulo");
}
await go("/financeiro/pagar");
await shot("23-pagar");
const payable = await firstLink("/financeiro/pagar", /^\/financeiro\/pagar\/(?!novo)[A-Za-z0-9_-]{8,}$/);
if (payable) {
  await go(payable);
  await shot("v04-baixa-pagamento");
}
await go("/financeiro/fluxo-caixa");
await shot("24-fluxo");
await go("/financeiro/conciliacao");
await shot("25-conciliacao");
await go("/financeiro/conciliacao/importar");
await shot("v05-importar-extrato");

// 26–29 — compras
await go("/fornecedores");
await shot("26-fornecedores");
await go("/compras/pedidos");
await shot("27-pedidos");
await go("/compras/pedidos/novo");
await shot("28-novo-pedido");
const receipt = await firstLink("/compras/recebimentos", /^\/compras\/recebimentos\/(?!novo)[A-Za-z0-9_-]{8,}$/);
if (receipt) await go(receipt);
else await go("/compras/recebimentos");
await shot("29-recebimento");

// 30–35 — fiscal
await go("/fiscal/nfe");
await shot("30-nfe");
const nfe = await firstLink("/fiscal/nfe", /^\/fiscal\/nfe\/(?!nova)[A-Za-z0-9_-]{8,}$/);
if (nfe) {
  await go(nfe);
  await shot("v06-nfe-detalhe");
}
await go("/fiscal/nfe/nova");
await shot("31-nfe-nova");
await go("/fiscal/nfse");
await shot("32-nfse");
await go("/fiscal/nfse/nova");
await shot("v07-nfse-formulario");
await go("/fiscal/nfce");
await shot("33-nfce");
const nfce = await firstLink("/fiscal/nfce", /^\/fiscal\/nfce\/[A-Za-z0-9_-]{8,}$/);
if (nfce) {
  await go(nfce);
  await shot("v08-nfce-detalhe");
}
await go("/fiscal/configuracoes");
await shot("34-config-fiscal");
await go("/fiscal/relatorios");
await shot("35-relatorios-fiscais");

// 36–43 — administração e suporte
await go("/administracao/usuarios");
await shot("36-usuarios");
const role = await firstLink("/administracao/usuarios/perfis", /^\/administracao\/usuarios\/perfis\/(?!novo)[A-Za-z0-9_-]{4,}$/);
if (role) {
  await go(role);
  await shot("v09-perfil-permissoes");
}
await go("/administracao/historico");
await shot("37-historico");
await go("/administracao/empresas");
await shot("38-empresas");
await go("/administracao/terminais");
await shot("39-terminais");
await go("/administracao/integracoes");
await shot("40-integracoes");
const fiscalIntegration = await firstLink("/administracao/integracoes", /^\/administracao\/integracoes\/(fiscal|nfe)[a-z_-]*$/);
if (fiscalIntegration) {
  await go(fiscalIntegration);
  await shot("v10-integracao-fiscal");
}
await go("/administracao/backups");
await shot("41-backups");
await go("/notificacoes");
await shot("42-notificacoes");
await go("/ajuda");
await shot("43-ajuda");

// 44–48 — análise e planejamento
await go("/relatorios/gerenciais");
await shot("44-gerenciais");
const branchReport = await firstLink("/relatorios/gerenciais", /^\/relatorios\/gerenciais\/filial\/[A-Za-z0-9_-]{4,}$/);
if (branchReport) {
  await go(branchReport);
  await shot("v11-gerenciais-filial");
}
await go("/relatorios/curva-abc");
await shot("45-curva-abc");
await go("/compras/reposicao");
await shot("46-reposicao");
const sku = await firstLink("/compras/reposicao", /^\/compras\/reposicao\/[A-Za-z0-9_-]{4,}$/);
if (sku) {
  await go(sku);
  await shot("v12-reposicao-detalhe");
}
await go("/compras/cotacoes");
const quotation = await firstLink("/compras/cotacoes", /^\/compras\/cotacoes\/(?!nova)[A-Za-z0-9_-]{8,}$/);
if (quotation) {
  await go(quotation);
  await shot("47-cotacao");
  await go(`${quotation}?tab=revisao`);
  await shot("v13-cotacao-revisao");
} else {
  await go("/compras/cotacoes");
  await shot("47-cotacao");
}
await go("/compras/aprovacoes");
await shot("48-aprovacoes");
const approval = await firstLink("/compras/aprovacoes", /^\/compras\/aprovacoes\/(?!politica)[A-Za-z0-9_-]{8,}$/);
if (approval) {
  await go(approval);
  await shot("v14-aprovacao-analise");
}

await browser.close();
if (problems.length) {
  console.log("\nPROBLEMAS:");
  for (const p of problems) console.log(" -", p);
  process.exitCode = 1;
}
