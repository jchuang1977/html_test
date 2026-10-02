export const runtime = "edge";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "請求來源不符" }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "請傳送 JSON 資料" }, { status: 415 });

  let code: string;
  let verifier: string;
  try {
    const raw = await request.text();
    if (raw.length > 4096) throw new Error("Too large");
    const body = JSON.parse(raw) as { code?: unknown; verifier?: unknown };
    code = typeof body.code === "string" ? body.code : "";
    verifier = typeof body.verifier === "string" ? body.verifier : "";
    if (!/^[A-Za-z0-9._~-]{8,2048}$/.test(code) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) throw new Error("Invalid code");
  } catch {
    return Response.json({ error: "授權資訊不正確，請重新登入 OpenRouter。" }, { status: 400 });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return Response.json({ error: response.status === 403 ? "授權碼已失效，請重新登入 OpenRouter。" : "OpenRouter 授權失敗，請稍後再試。" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    const data = await response.json() as { key?: string };
    if (!data.key || data.key.length > 2048) throw new Error("Missing credential");
    return Response.json({ key: data.key }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "無法完成 OpenRouter 授權，請稍後再試。" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
