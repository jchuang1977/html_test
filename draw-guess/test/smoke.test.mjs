import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { chromium } from "playwright-core";

async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function ready(url) {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("本機服務未能及時啟動");
}

test("draw, undo, guess and start another round", async t => {
  const browserPath = process.env.BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  try { await access(browserPath); }
  catch { return t.skip("未安裝 Edge；可透過 BROWSER_PATH 指定 Chromium 瀏覽器"); }

  const port = await unusedPort();
  const server = spawn(process.execPath, ["server.mjs"], { cwd: new URL("..", import.meta.url), env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
  t.after(() => server.kill());
  const url = `http://127.0.0.1:${port}`;
  await ready(`${url}/api/bootstrap`);
  const catalog = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.ok(catalog.providers.some(provider => provider.id === "openai" && provider.models.some(model => model.id === "gpt-4o-mini")));
  assert.equal(catalog.providers.find(provider => provider.id === "openai").oauth.label, "使用 ChatGPT 訂閱帳號登入");
  const invalidImage = await fetch(`${url}/api/guess`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId: "openai", modelId: "gpt-4o-mini", image: "not-an-image" }) });
  assert.equal(invalidImage.status, 400);

  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const fixture = { providers: [{ id: "openai", name: "OpenAI", oauth: { label: "使用 ChatGPT 訂閱帳號登入", subscription: true }, apiKey: true, connected: true, stored: true, authType: "oauth", models: [{ id: "gpt-4o-mini", name: "GPT-4o mini" }, { id: "gpt-4o", name: "GPT-4o" }] }] };
  await page.route("**/api/bootstrap", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) }));
  await page.route("**/api/guess", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ guess: "小貓", detail: "我看到尖尖的耳朵。" }) }));
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-TW");
  assert.match(await page.locator("#page-title").textContent(), /你畫的.*AI 猜得出來嗎/);
  await page.locator("#active-model").getByText("OpenAI / GPT-4o mini").waitFor();
  await page.screenshot({ path: ".data/desktop-preview.png", fullPage: true });
  await page.locator("#open-settings").click();
  assert.equal(await page.locator("#oauth-button").textContent(), "使用 ChatGPT 訂閱帳號登入 ↗");
  await page.screenshot({ path: ".data/settings-preview.png", fullPage: true });
  assert.equal(await page.locator("#provider-select").inputValue(), "openai");
  await page.locator("#model-search").fill("gpt-4o-mini");
  assert.equal(await page.locator("#model-select option").count(), 1);
  await page.locator("#done-settings").click();

  const canvas = page.locator("#draw-canvas");
  const before = await canvas.evaluate(element => element.toDataURL());
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 210, { steps: 12 });
  await page.mouse.up();
  const after = await canvas.evaluate(element => element.toDataURL());
  assert.notEqual(after, before);
  await page.locator("#undo").click();
  assert.equal(await canvas.evaluate(element => element.toDataURL()), before);
  await page.locator("#redo").click();
  assert.equal(await canvas.evaluate(element => element.toDataURL()), after);
  await page.locator("#guess-button").click();
  await page.locator("#ai-message").getByText("小貓").waitFor();
  assert.equal(await page.locator("#guess-count").textContent(), "01");
  await page.locator("#mark-correct").click();
  assert.equal(await page.locator("#win-count").textContent(), "01");
  await page.locator("#guess-button").click();
  assert.equal(await canvas.evaluate(element => element.toDataURL()), before);
  assert.deepEqual(errors, []);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: ".data/mobile-preview.png", fullPage: true });
});
