import { copilotAuth } from "../../../../lib/copilot";
import { modelCatalog } from "../../../bootstrap/route";

export const runtime = "edge";

const CLIENT_ID = "Iv1.b507a08c87ecfe98";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "請求來源不符" }, { status: 403 });
  let deviceCode: string;
  try {
    const body = await request.json() as { deviceCode?: string };
    deviceCode = body.deviceCode || "";
    if (!/^[a-zA-Z0-9_-]{10,200}$/.test(deviceCode)) throw new Error("Invalid device code");
  } catch { return Response.json({ error: "授權資訊不正確，請重新登入。" }, { status: 400 }); }

  try {
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "GitHubCopilotChat/0.35.0" },
      body: new URLSearchParams({ client_id: CLIENT_ID, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
    });
    if (!response.ok) throw new Error("GitHub unavailable");
    const data = await response.json() as { access_token?: string; error?: string; interval?: number };
    if (data.access_token) {
      const auth = await copilotAuth(data.access_token);
      const catalogResponse = await fetch(`${auth.baseUrl}/models`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${auth.apiKey}`, "User-Agent": "GitHubCopilotChat/0.35.0", "Editor-Version": "vscode/1.107.0", "Editor-Plugin-Version": "copilot-chat/0.35.0", "Copilot-Integration-Id": "vscode-chat", "X-GitHub-Api-Version": "2026-06-01" },
      });
      if (!catalogResponse.ok) throw new Error("Copilot models unavailable");
      const catalog = await catalogResponse.json() as { data?: Array<{ id?: string; model_picker_enabled?: boolean; policy?: { state?: string } }> };
      const entries = Array.isArray(catalog.data) ? catalog.data : [];
      const pickerIds = entries.filter(item => item.model_picker_enabled && item.policy?.state !== "disabled").map(item => item.id).filter((id): id is string => typeof id === "string");
      const available = pickerIds.length ? pickerIds : entries.filter(item => item.policy?.state === "enabled").map(item => item.id).filter((id): id is string => typeof id === "string");
      const supported = new Set(modelCatalog().getModels("github-copilot").filter(model => model.input?.includes("image")).map(model => model.id));
      const modelIds = available.filter(id => supported.has(id));
      if (!modelIds.length) return Response.json({ state: "error", error: "此 GitHub 帳號目前沒有可用的 Copilot 模型。" }, { headers: { "Cache-Control": "no-store" } });
      return Response.json({ state: "done", token: data.access_token, modelIds }, { headers: { "Cache-Control": "no-store" } });
    }
    if (data.error === "authorization_pending") return Response.json({ state: "pending" }, { headers: { "Cache-Control": "no-store" } });
    if (data.error === "slow_down") return Response.json({ state: "pending", interval: Math.max(10, data.interval || 10) }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ state: "error", error: data.error === "expired_token" ? "授權已逾時，請重新登入。" : "GitHub 授權未完成，請重新登入。" }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    const message = cause instanceof Error && /401|403/.test(cause.message) ? "這個 GitHub 帳號無法使用 Copilot，請確認訂閱權限。" : "無法確認 GitHub 授權，請稍後再試。";
    return Response.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
