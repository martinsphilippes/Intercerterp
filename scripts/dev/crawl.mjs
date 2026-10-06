/**
 * Rastreador de navegação: faz login, percorre os links internos (BFS) e registra status HTTP,
 * erros de página, erros de console e telas de erro/404. Uso:
 *   BASE=http://localhost:3000 LOGIN=admin OUT=/tmp/crawl.json node scripts/dev/crawl.mjs
 */
import { chromium } from "@playwright/test";
import fs from "node:fs";

const base = process.env.BASE || "http://localhost:3000";
const perPattern = Number(process.env.PER_PATTERN || 2);
const maxPages = Number(process.env.MAX_PAGES || 500);
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: process.env.TZ_ID || "America/Sao_Paulo" });
const page = await ctx.newPage();
let pageErrors = [];
let consoleErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 300)));

await page.goto(base + "/login");
await page.fill("#login", process.env.LOGIN || "admin");
await page.fill("#password", process.env.PASSWORD || "Intercert@2026");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90000 });
if (page.url().includes("selecionar-unidade")) {
  await page.getByText(process.env.BRANCH || "Matriz — Centro").click();
  await page.waitForURL((u) => u.pathname.startsWith("/dashboard"), { timeout: 90000 });
}

const skip = (p) => /^\/(api\/export|api\/files|api\/jobs|api\/unit|login|recuperar|redefinir|convite|primeiro-acesso|suporte$)/.test(p) || p.includes("/download") || p.includes("print=1");
const pattern = (p) =>
  p
    .split("?")[0]
    .split("/")
    .map((seg) => (/^[a-f0-9]{16,40}$/i.test(seg) || /^\d+$/.test(seg) ? "[id]" : seg))
    .join("/");

const queue = ["/dashboard"];
const seen = new Set(queue);
const perPat = new Map();
const results = [];
while (queue.length && results.length < maxPages) {
  const path = queue.shift();
  const pat = pattern(path);
  const n = perPat.get(pat) ?? 0;
  if (n >= perPattern) continue;
  perPat.set(pat, n + 1);
  pageErrors = [];
  consoleErrors = [];
  const t0 = Date.now();
  let status = 0;
  try {
    const res = await page.goto(base + path, { timeout: 120000, waitUntil: "domcontentloaded" });
    status = res?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  } catch (e) {
    results.push({ path, pattern: pat, status: -1, error: String(e.message).slice(0, 200) });
    continue;
  }
  const body = await page.locator("body").innerText().catch(() => "");
  const errorScreen = /Application error|Unhandled Runtime Error|This page could not be found|Erro inesperado|404/.test(body.slice(0, 3000));
  results.push({ path, pattern: pat, status, ms: Date.now() - t0, errorScreen, pageErrors: [...pageErrors], consoleErrors: [...new Set(consoleErrors)].slice(0, 5), final: new URL(page.url()).pathname });
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  for (const h of hrefs) {
    if (!h || !h.startsWith("/") || h.startsWith("//")) continue;
    const clean = h.split("#")[0];
    if (skip(clean) || seen.has(clean)) continue;
    seen.add(clean);
    queue.push(clean);
  }
  process.stdout.write(`${status} ${errorScreen ? "ERR " : ""}${pageErrors.length ? "PE " : ""}${path}\n`);
}
fs.writeFileSync(process.env.OUT || "/tmp/crawl.json", JSON.stringify({ base, at: new Date().toISOString(), pages: results.length, patterns: perPat.size, results }, null, 2));
const bad = results.filter((r) => r.status !== 200 || r.errorScreen || r.pageErrors?.length);
console.log(`\nPáginas: ${results.length} · padrões de rota: ${perPat.size} · com problema: ${bad.length}`);
for (const b of bad) console.log("PROBLEMA", b.status, b.path, b.errorScreen ? "[tela de erro]" : "", (b.pageErrors || []).join(" | ").slice(0, 200), b.error ?? "");
await browser.close();
