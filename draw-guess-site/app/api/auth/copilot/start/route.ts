export const runtime = "edge";

// Public OAuth client ID used by pi-ai's GitHub Copilot device-code flow.
const CLIENT_ID = "Iv1.b507a08c87ecfe98";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "請求來源不符" }, { status: 403 });
  try {
    const response = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "GitHubCopilotChat/0.35.0" },
      body: new URLSearchParams({ client_id: CLIENT_ID, scope: "read:user" }),
    });
    if (!response.ok) throw new Error("GitHub unavailable");
    const data = await response.json() as { device_code?: string; user_code?: string; verification_uri?: string; interval?: number; expires_in?: number };
    if (!data.device_code || !data.user_code || data.verification_uri !== "https://github.com/login/device" || !data.expires_in) throw new Error("Invalid device code");
    return Response.json({ deviceCode: data.device_code, userCode: data.user_code, verificationUri: data.verification_uri, interval: Math.max(5, data.interval || 5), expiresIn: data.expires_in }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "無法啟動 GitHub 授權，請稍後再試。" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
