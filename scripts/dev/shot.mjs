import { chromium } from "@playwright/test";
const [,, ...pages] = process.argv;
const base = "http://localhost:3000";
const browser = await chromium.launch().catch(async () => chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }));
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.goto(base + "/login");
await page.fill("#login", process.env.LOGIN || "admin");
await page.fill("#password", "Intercert@2026");
await page.click("button[type=submit]");
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
console.log("after login:", page.url());
if (page.url().includes("selecionar-unidade")) {
  await page.getByText(process.env.BRANCH || "Matriz — Centro").click();
  await page.waitForURL((u) => u.pathname.startsWith("/dashboard"), { timeout: 60000 });
}
for (const p of pages) {
  const t0 = Date.now();
  const res = await page.goto(base + p, { timeout: 120000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  const name = p.replace(/[^a-z0-9]+/gi, "_") || "root";
  await page.screenshot({ path: `${process.env.SHOTS_DIR || "/tmp"}/${name}.png`, fullPage: true });
  const errs = await page.locator("text=/Unhandled Runtime Error|Application error|Error:/").count();
  console.log(p, res?.status(), `${Date.now() - t0}ms`, errs ? "ERRTEXT" : "");
}
await browser.close();
