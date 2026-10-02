import OpenCC from "opencc-js";
import { modelCatalog } from "../bootstrap/route";
import { copilotAuth } from "../../lib/copilot";

export const runtime = "edge";

const toTaiwanese = OpenCC.Converter({ from: "cn", to: "twp" });

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function modelError(message: string) {
  if (/401|unauthorized|invalid.*key|authentication/i.test(message)) return "模型授權失敗，請檢查登入狀態或 API Key。";
  if (/403|forbidden|permission/i.test(message)) return "這個帳號沒有使用所選模型的權限，請換個模型。";
  if (/429|rate.?limit|quota|credit|insufficient/i.test(message)) return "模型額度不足或請求太頻繁，請稍後再試。";
  if (/404|model.*(not found|unsupported|unavailable)/i.test(message)) return "找不到所選模型，請到模型設定更換模型。";
  return "模型服務暫時無法回應，請稍後再試。";
}

function answerResponse(answer: string) {
  const [first, ...rest] = answer.replace(/^```[\s\S]*?\n|```$/g, "").split(/\r?\n/).filter(Boolean);
  if (!first) return error("模型沒有回傳猜測，請再試一次", 502);
  return Response.json({ guess: toTaiwanese(first.replace(/^(答案|我猜|猜測|猜测)[：:]\s*/, "")).slice(0, 80), detail: toTaiwanese(rest.join(" ")).slice(0, 160) }, { headers: { "Cache-Control": "no-store" } });
}

function customEndpoint(baseUrl: string) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port && url.port !== "443") throw new Error("invalid endpoint");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".chatgpt.site") || /^\d+(\.\d+){3}$/.test(host) || host.includes(":")) throw new Error("invalid endpoint");
  url.pathname = `${url.pathname.replace(/\/$/, "")}/chat/completions`;
  return url;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return error("請求來源不符", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return error("請傳送 JSON 資料", 415);
  if (Number(request.headers.get("content-length") || 0) > 5_000_000) return error("圖片太大，請清空畫布後再試一次", 413);
  let payload: { providerId?: string; modelId?: string; image?: string; credential?: { type?: string; key?: string; token?: string; baseUrl?: string } };
  try {
    const raw = await request.text();
    if (raw.length > 5_000_000) return error("圖片太大，請清空畫布後再試一次", 413);
    payload = JSON.parse(raw);
  } catch { return error("JSON 格式錯誤", 400); }

  const { providerId, modelId, image, credential } = payload;
  if (typeof image !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) return error("畫布圖片格式錯誤", 400);
  if (providerId === "custom") {
    if (credential?.type !== "custom" || typeof credential.baseUrl !== "string" || credential.baseUrl.length > 500 || !modelId || modelId.length > 120) return error("請先設定自訂介面的網址與模型", 400);
    let endpoint: URL;
    try { endpoint = customEndpoint(credential.baseUrl); }
    catch { return error("請輸入公開可連線的 HTTPS API 基底網址", 400); }
    if (credential.key && credential.key.length > 2048) return error("API Key 格式錯誤", 400);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(credential.key ? { Authorization: `Bearer ${credential.key}` } : {}) },
        body: JSON.stringify({ model: modelId, messages: [
          { role: "system", content: "你正在玩你畫我猜。請用臺灣慣用的繁體中文，第一行簡短猜答案，第二行可說明理由。" },
          { role: "user", content: [{ type: "text", text: "你覺得我畫的是什麼？" }, { type: "image_url", image_url: { url: image } }] },
        ] }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) return error(modelError(String(response.status)), 502);
      const data = await response.json() as { choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[] };
      const content = data.choices?.[0]?.message?.content;
      const answer = typeof content === "string" ? content : Array.isArray(content) ? content.filter(part => part.type === "text").map(part => part.text || "").join("\n") : "";
      return answerResponse(answer.trim());
    } catch { return error("自訂介面無法連線，請檢查 HTTPS 網址、模型名稱與服務狀態。", 502); }
  }

  const models = modelCatalog();
  const model = providerId && modelId ? models.getModel(providerId, modelId) : null;
  if (!model?.input?.includes("image")) return error("請選擇支援圖片辨識的模型", 400);

  let apiKey: string;
  let requestModel = model;
  try {
    if (credential?.type === "api_key") {
      if (!["openai", "anthropic", "google", "openrouter"].includes(providerId || "") || !credential.key?.trim() || credential.key.length > 2048) return error("請輸入有效的 API Key", 401);
      apiKey = credential.key.trim();
    } else if (providerId === "github-copilot") {
      if (credential?.type !== "copilot" || !credential.token || credential.token.length > 2048) return error("請先登入 GitHub Copilot", 401);
      const auth = await copilotAuth(credential.token);
      apiKey = auth.apiKey;
      requestModel = { ...model, baseUrl: auth.baseUrl };
    } else if (providerId === "openrouter") {
      if (credential?.type !== "openrouter" || !credential.key?.trim() || credential.key.length > 2048) return error("請先登入 OpenRouter", 401);
      apiKey = credential.key.trim();
    } else return error("請先完成模型連線", 401);

    const response = await models.complete(requestModel, {
      systemPrompt: "你正在玩你畫我猜。只根據圖片猜測畫中的主要物品或場景，不要猜題目來源。請使用臺灣慣用的繁體中文回答。第一行只寫一個最可能的簡短答案，第二行可以輕鬆說明理由。即使不確定，也要給出一個猜測。不要使用 Markdown 格式。",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "你覺得我畫的是什麼？請大膽猜猜看。" },
          { type: "image", data: image.slice("data:image/png;base64,".length), mimeType: "image/png" },
        ],
        timestamp: Date.now(),
      }],
    }, { apiKey });
    if (response.stopReason === "error") return error(modelError(response.errorMessage || ""), 502);
    const answer = response.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
    return answerResponse(answer);
  } catch (cause) {
    return error(modelError(cause instanceof Error ? cause.message : ""), 502);
  }
}
