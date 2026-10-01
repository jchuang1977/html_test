import http from "node:http";
import { readFile, mkdir, writeFile, rename, chmod } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { githubCopilotProvider } from "@earendil-works/pi-ai/providers/github-copilot";
import OpenCC from "opencc-js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const dataRoot = join(root, ".data");
const authFile = join(dataRoot, "credentials.json");
const deviceFile = join(dataRoot, "device-id");
const port = Number(process.env.PORT || 4174);
const sessions = new Map();
const toTaiwanese = OpenCC.Converter({ from: "cn", to: "twp" });

async function readCredentials() {
  try { return JSON.parse(await readFile(authFile, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return {}; throw error; }
}

async function saveCredentials(data) {
  await mkdir(dataRoot, { recursive: true });
  const temp = `${authFile}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await chmod(temp, 0o600).catch(() => {});
  await rename(temp, authFile);
}

let pendingWrite = Promise.resolve();
function serialized(task) {
  const result = pendingWrite.then(task);
  pendingWrite = result.catch(() => {});
  return result;
}

const credentials = {
  async read(providerId) { return (await readCredentials())[providerId]; },
  async list() {
    return Object.entries(await readCredentials()).map(([providerId, value]) => ({ providerId, type: value.type }));
  },
  modify(providerId, fn) {
    return serialized(async () => {
      const data = await readCredentials();
      const next = await fn(data[providerId]);
      if (next !== undefined) {
        data[providerId] = next;
        await saveCredentials(data);
      }
      return data[providerId];
    });
  },
  delete(providerId) {
    return serialized(async () => {
      const data = await readCredentials();
      delete data[providerId];
      await saveCredentials(data);
    });
  },
};

const models = createModels({ credentials });
for (const factory of [openaiProvider, anthropicProvider, googleProvider, openrouterProvider, githubCopilotProvider]) {
  models.setProvider(factory());
}

async function getDeviceId() {
  try { return (await readFile(deviceFile, "utf8")).trim(); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(dataRoot, { recursive: true });
    const id = randomUUID();
    await writeFile(deviceFile, id, { flag: "wx", mode: 0o600 }).catch(error => {
      if (error.code !== "EEXIST") throw error;
    });
    return (await readFile(deviceFile, "utf8")).trim();
  }
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(data));
}

async function body(req, limit = 5_000_000) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw Object.assign(new Error("請傳送 JSON 資料"), { status: 415 });
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("圖片太大，請清空畫布後再試一次"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("JSON 格式錯誤"), { status: 400 }); }
}

function providerOrThrow(id) {
  const provider = models.getProvider(id);
  if (!provider) throw Object.assign(new Error("不支援這個模型供應商"), { status: 400 });
  return provider;
}

function localizedAuthEvent(event) {
  if (event.type === "info") return {
    type: "info",
    message: /could not listen/i.test(event.message) ? "無法啟動本機授權回呼；請完成登入後，貼上瀏覽器最後的轉址網址。" : "請依照供應商網站的步驟完成授權。",
    links: event.links?.map(link => ({ url: link.url, label: "查看相關說明" })),
  };
  if (event.type === "progress") return { type: "progress", message: /enabling models/i.test(event.message) ? "正在啟用模型，請稍候…" : "正在處理授權，請稍候…" };
  if (event.type === "auth_url") return { type: "auth_url", url: event.url, instructions: "請在瀏覽器完成登入。" };
  return event;
}

function localizedAuthPrompt(prompt) {
  const message = prompt.type === "manual_code" ? "請先在瀏覽器完成登入；若沒有自動返回，請貼上最後的轉址網址或授權碼。"
    : /enterprise/i.test(prompt.message) ? "若使用 GitHub Enterprise，請輸入網址；一般 GitHub 帳號請留空。"
    : prompt.type === "select" ? "請選擇登入選項。"
    : prompt.type === "secret" ? "請輸入授權所需的密碼或代碼。"
    : "請輸入授權資訊。";
  return { type: prompt.type, message, options: prompt.options?.map(option => ({ id: option.id, label: toTaiwanese(option.label) })) };
}

function localizedAuthError(error) {
  const message = error?.message || "";
  if (/cancel|abort/i.test(message)) return "登入已取消，請重新開始。";
  if (/expired|timeout/i.test(message)) return "授權已逾時，請重新登入。";
  if (/state mismatch|invalid.*code|missing authorization code/i.test(message)) return "授權碼無效，請重新登入。";
  return "登入失敗，請檢查供應商帳號後再試一次。";
}

function localizedModelError(message) {
  if (/401|unauthorized|invalid.*key|authentication/i.test(message || "")) return "模型驗證失敗，請檢查帳號或 API 金鑰。";
  if (/429|rate.?limit|quota|credit|insufficient/i.test(message || "")) return "模型額度不足或請求太頻繁，請稍後再試。";
  if (/404|model.*(not found|unsupported|unavailable)/i.test(message || "")) return "找不到所選模型，請到模型設定更換模型。";
  return "模型服務暫時無法回應，請稍後再試。";
}

function publicSession(session) {
  return {
    id: session.id,
    state: session.state,
    provider: session.provider,
    events: session.events,
    prompt: session.prompt && localizedAuthPrompt(session.prompt),
    error: session.error,
  };
}

async function startOAuth(providerId) {
  const provider = providerOrThrow(providerId);
  if (!provider.auth?.oauth) throw Object.assign(new Error("此服務不支援訂閱帳號登入"), { status: 400 });
  for (const existing of sessions.values()) {
    if (existing.provider === providerId && existing.state === "pending") {
      throw Object.assign(new Error("此服務已有正在進行的登入程序"), { status: 409 });
    }
  }
  const session = { id: randomUUID(), provider: providerId, state: "pending", events: [], prompt: null, error: null, createdAt: Date.now() };
  sessions.set(session.id, session);
  models.login(providerId, "oauth", {
    notify(event) { session.events.push(localizedAuthEvent(event)); },
    prompt(prompt) {
      return new Promise((resolvePrompt, rejectPrompt) => {
        session.prompt = { ...prompt, resolve: resolvePrompt, reject: rejectPrompt };
        prompt.signal?.addEventListener("abort", () => {
          if (session.prompt?.resolve === resolvePrompt) session.prompt = null;
          rejectPrompt(new Error("已透過瀏覽器完成授權"));
        }, { once: true });
      });
    },
  }, { getDeviceId: () => deviceId }).then(() => {
    session.state = "done";
    session.prompt = null;
  }).catch(error => {
    session.state = "error";
    console.error("OAuth login failed:", error);
    session.error = localizedAuthError(error);
    session.prompt = null;
  });
  return session;
}

const deviceId = await getDeviceId();

async function bootstrap() {
  const statuses = await Promise.all(models.getProviders().map(async provider => {
    const vision = models.getModels(provider.id).filter(model => model.input?.includes("image"));
    let auth = null;
    try { auth = await models.checkAuth(provider.id); }
    catch { /* An expired login is shown as disconnected until refreshed. */ }
    const stored = !!(await credentials.read(provider.id));
    return {
      id: provider.id,
      name: provider.name,
      oauth: provider.auth?.oauth ? {
        label: ({ openai: "使用 ChatGPT 訂閱帳號登入", anthropic: "使用 Claude 訂閱帳號登入", "github-copilot": "使用 GitHub Copilot 訂閱帳號登入", openrouter: "使用 OpenRouter 帳號授權" })[provider.id] || "使用訂閱帳號登入",
        subscription: !!provider.auth.oauth.isSubscription,
      } : null,
      apiKey: !!provider.auth?.apiKey,
      connected: !!auth,
      stored,
      authType: auth?.type || null,
      models: vision.map(model => ({ id: model.id, name: model.name || model.id })),
    };
  }));
  return { providers: statuses.filter(provider => provider.models.length) };
}

async function guess({ providerId, modelId, image }) {
  providerOrThrow(providerId);
  const model = models.getModel(providerId, modelId);
  if (!model || !model.input?.includes("image")) throw Object.assign(new Error("請選擇支援圖片辨識的模型"), { status: 400 });
  if (typeof image !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) {
    throw Object.assign(new Error("畫布圖片格式錯誤"), { status: 400 });
  }
  let authorized;
  try { authorized = await models.checkAuth(providerId); }
  catch { throw Object.assign(new Error("帳號授權已失效，請到模型設定重新連線"), { status: 401 }); }
  if (!authorized) throw Object.assign(new Error("請先到模型設定連接帳號"), { status: 401 });
  let response;
  try { response = await models.complete(model, {
    systemPrompt: "你正在玩你畫我猜。只根據圖片猜測畫中的主要物品或場景，不要猜題目來源。請使用臺灣慣用的繁體中文回答。第一行只寫一個最可能的簡短答案，第二行可以輕鬆說明理由。即使不確定，也要給出一個猜測。不要使用 Markdown 格式。",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "你覺得我畫的是什麼？請大膽猜猜看。" },
        { type: "image", data: image.slice("data:image/png;base64,".length), mimeType: "image/png" },
      ],
      timestamp: Date.now(),
    }],
  }); }
  catch (error) { throw Object.assign(new Error(localizedModelError(error.message)), { status: 502 }); }
  if (response.stopReason === "error") throw Object.assign(new Error(localizedModelError(response.errorMessage)), { status: 502 });
  const answer = response.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
  if (!answer) throw Object.assign(new Error("模型沒有回傳猜測，請再試一次"), { status: 502 });
  const [first, ...rest] = answer.replace(/^```[\s\S]*?\n|```$/g, "").split(/\r?\n/).filter(Boolean);
  return { guess: toTaiwanese(first.replace(/^(答案|我猜|猜測|猜测)[：:]\s*/, "")).slice(0, 80), detail: toTaiwanese(rest.join(" ")).slice(0, 160) };
}

async function serveStatic(pathname, res) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = resolve(publicRoot, relative);
  if (!file.startsWith(publicRoot + sep)) return send(res, 403, { error: "禁止存取" });
  const type = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" }[extname(file)] || "application/octet-stream";
  try {
    const content = await readFile(file);
    res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
    res.end(content);
  } catch { send(res, 404, { error: "找不到頁面" }); }
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || "";
    if (!/^((127\.0\.0\.1)|(localhost))(\:\d+)?$/.test(host)) return send(res, 403, { error: "僅允許從本機存取" });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return send(res, 403, { error: "請求來源不符" });
    const pathname = new URL(req.url, `http://${host}`).pathname;
    if (req.method === "GET" && pathname === "/api/bootstrap") return send(res, 200, await bootstrap());
    if (req.method === "POST" && pathname === "/api/auth/key") {
      const { providerId, key } = await body(req, 4096);
      const provider = providerOrThrow(providerId);
      if (!provider.auth?.apiKey || typeof key !== "string" || !key.trim() || key.length > 2048) throw Object.assign(new Error("請輸入有效的 API 金鑰"), { status: 400 });
      await credentials.modify(providerId, async () => ({ type: "api_key", key: key.trim() }));
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && pathname === "/api/auth/oauth") {
      const { providerId } = await body(req, 4096);
      return send(res, 200, publicSession(await startOAuth(providerId)));
    }
    const sessionMatch = pathname.match(/^\/api\/auth\/session\/([0-9a-f-]+)(\/reply)?$/);
    if (sessionMatch) {
      const session = sessions.get(sessionMatch[1]);
      if (!session) return send(res, 404, { error: "登入程序已過期，請重新開始" });
      if (req.method === "GET" && !sessionMatch[2]) return send(res, 200, publicSession(session));
      if (req.method === "POST" && sessionMatch[2]) {
        const { value } = await body(req, 4096);
        if (!session.prompt || typeof value !== "string" || (!value.trim() && session.prompt.type !== "text")) throw Object.assign(new Error("請填寫授權資訊"), { status: 400 });
        session.prompt.resolve(value.trim());
        session.prompt = null;
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === "POST" && pathname === "/api/auth/logout") {
      const { providerId } = await body(req, 4096);
      providerOrThrow(providerId);
      await models.logout(providerId);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && pathname === "/api/guess") return send(res, 200, await guess(await body(req)));
    if (req.method === "GET" && !pathname.startsWith("/api/")) return serveStatic(pathname, res);
    send(res, 404, { error: "找不到此 API" });
  } catch (error) {
    console.error(error);
    send(res, error.status || 500, { error: error.status ? error.message : "伺服器發生錯誤" });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`你畫我猜已啟動：http://127.0.0.1:${port}`));
