async function finishLogin() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const state = params.get("state");
  const providerError = params.get("error");
  history.replaceState(null, "", location.pathname);

  let pending;
  try { pending = JSON.parse(sessionStorage.getItem("draw-guess-openrouter-pending") || "null"); }
  catch { pending = null; }
  sessionStorage.removeItem("draw-guess-openrouter-pending");

  try {
    if (providerError) throw new Error("你尚未完成 OpenRouter 授權。");
    if (!pending || !code || state !== pending.state || Date.now() - pending.startedAt > 10 * 60 * 1000) {
      throw new Error("授權程序已過期，請重新登入 OpenRouter。");
    }
    const response = await fetch("/api/auth/openrouter/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, verifier: pending.verifier }),
    });
    const result = await response.json();
    if (!response.ok || !result.key) throw new Error(result.error || "無法完成 OpenRouter 授權。");
    let credentials = {};
    try { credentials = JSON.parse(sessionStorage.getItem("draw-guess-credentials") || "{}"); }
    catch { /* Start with a clean credential set. */ }
    sessionStorage.setItem("draw-guess-credentials", JSON.stringify({
      "github-copilot": credentials?.["github-copilot"]?.type === "copilot" ? credentials["github-copilot"] : undefined,
      openrouter: { type: "openrouter", key: result.key },
    }));
    location.replace("/game?auth=openrouter-connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法完成 OpenRouter 授權。";
    document.getElementById("status").textContent = message;
    sessionStorage.setItem("draw-guess-auth-error", message);
    setTimeout(() => location.replace("/game?auth=openrouter-error"), 2500);
  }
}

finishLogin();
