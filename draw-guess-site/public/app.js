const $ = id => document.getElementById(id);
const canvas = $("draw-canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const words = ["小貓", "冰淇淋", "雨傘", "腳踏車", "火箭", "烏龜", "漢堡", "向日葵", "咖啡杯", "眼鏡", "小船", "蘋果", "蝴蝶", "恐龍", "熱氣球", "雪人", "吉他", "西瓜", "城堡", "章魚", "機器人", "月亮", "小狗", "蘑菇"];

let providers = [];
let selectedProvider = "";
let selectedModel = "";
let connectionMode = "subscription";
let tool = "pen";
let color = "#242d38";
let brushSize = 8;
let drawing = false;
let hasDrawing = false;
let history = [];
let historyIndex = 0;
let challenge = "";
let guesses = 0;
let wins = 0;
let roundScored = false;
let roundFinished = false;
let activeSessionId = null;
let pollingTimer = null;
let toastTimer = null;
let oauthInterval = 5000;

function readCredentials() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("draw-guess-credentials") || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  }
  catch { return {}; }
}

function saveCredential(providerId, credential) {
  const all = readCredentials();
  if (credential) all[providerId] = credential;
  else delete all[providerId];
  sessionStorage.setItem("draw-guess-credentials", JSON.stringify(all));
}

function toast(message) {
  const box = $("toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.hidden = true, 3600);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "請求失敗");
  return data;
}

function post(path, data) { return api(path, { method: "POST", body: JSON.stringify(data) }); }

function credentialKey() { return connectionMode === "api_key" ? `api:${selectedProvider}` : connectionMode === "custom" ? "custom" : selectedProvider; }
function activeCredential() { return readCredentials()[credentialKey()]; }
function modeProviders() {
  const order = connectionMode === "subscription" ? ["openrouter", "github-copilot", "openai-codex"] : ["openai", "anthropic", "google", "openrouter"];
  return order.map(id => providers.find(provider => provider.id === id)).filter(Boolean);
}
function currentProvider() {
  if (connectionMode === "custom") {
    const credential = activeCredential();
    return { id: "custom", name: "自訂介面", models: credential?.model ? [{ id: credential.model, name: credential.model }] : [], connected: !!credential?.baseUrl && !!credential?.model, stored: !!credential };
  }
  const provider = modeProviders().find(p => p.id === selectedProvider);
  return provider ? { ...provider, connected: !!activeCredential(), stored: !!activeCredential() } : null;
}
function currentModel() { return currentProvider()?.models.find(m => m.id === selectedModel); }

function persistSelection() {
  localStorage.setItem("draw-guess-selection", JSON.stringify({ mode: connectionMode, provider: selectedProvider, model: selectedModel }));
}

function loadSelection() {
  try { return JSON.parse(localStorage.getItem("draw-guess-selection") || "{}"); }
  catch { return {}; }
}

async function refreshBootstrap(keepSelection = true) {
  const data = await api("/api/bootstrap");
  const credentials = readCredentials();
  providers = data.providers.map(provider => {
    const credential = credentials[provider.id];
    const accountModels = provider.id === "github-copilot" && credential?.modelIds ? provider.models.filter(model => credential.modelIds.includes(model.id)) : provider.models;
    return { ...provider, models: accountModels };
  });
  const saved = loadSelection();
  if (!keepSelection && ["subscription", "api_key", "custom"].includes(saved.mode)) connectionMode = saved.mode;
  const wanted = keepSelection ? selectedProvider || saved.provider : saved.provider;
  selectedProvider = connectionMode === "custom" ? "custom" : modeProviders().find(p => p.id === wanted)?.id || modeProviders().find(p => credentials[connectionMode === "api_key" ? `api:${p.id}` : p.id])?.id || modeProviders()[0]?.id || "";
  const provider = currentProvider();
  const modelWanted = keepSelection ? selectedModel || saved.model : saved.model;
  selectedModel = provider?.models.find(m => m.id === modelWanted)?.id || provider?.models.find(m => /gpt-4o-mini|gemini-2\.5-flash|claude-sonnet/i.test(m.id))?.id || provider?.models[0]?.id || "";
  persistSelection();
  renderSettings();
  renderModelLine();
}

function renderModelLine() {
  const provider = currentProvider();
  const model = currentModel();
  $("active-model").textContent = provider && model ? `${provider.name} / ${model.name}` : "尚未選擇模型";
  $("connection-dot").classList.toggle("connected", !!provider?.connected);
  $("open-settings").classList.toggle("connected", !!provider?.connected);
  document.querySelector(".model-line-dot").classList.toggle("connected", !!provider?.connected);
}

function renderSettings() {
  for (const tab of document.querySelectorAll(".connection-tab")) tab.setAttribute("aria-selected", String(tab.dataset.mode === connectionMode));
  for (const mode of ["subscription", "api_key", "custom"]) $(`panel-${mode.replace("_", "-")}`).hidden = mode !== connectionMode;
  $("model-fields").hidden = connectionMode === "custom";
  const providerSelect = $("provider-select");
  providerSelect.replaceChildren();
  for (const provider of modeProviders()) {
    const stored = readCredentials()[connectionMode === "api_key" ? `api:${provider.id}` : provider.id];
    const option = new Option(`${provider.name}${stored ? " · 已連線" : ""}`, provider.id);
    providerSelect.add(option);
  }
  providerSelect.value = selectedProvider;
  const provider = currentProvider();
  const search = $("model-search").value.trim().toLowerCase();
  const modelSelect = $("model-select");
  modelSelect.replaceChildren();
  for (const model of provider?.models || []) {
    if (search && !`${model.name} ${model.id}`.toLowerCase().includes(search)) continue;
    modelSelect.add(new Option(model.name === model.id ? model.id : `${model.name} · ${model.id}`, model.id));
  }
  if ([...modelSelect.options].some(option => option.value === selectedModel)) modelSelect.value = selectedModel;
  else modelSelect.selectedIndex = -1;
  const status = $("auth-status");
  status.textContent = provider?.connected ? `✓ ${provider.name} 已連線，可以開始猜畫了。` : connectionMode === "custom" ? "請填入自訂介面設定。" : connectionMode === "api_key" ? "請輸入此供應商的 API Key。" : selectedProvider === "openai-codex" ? "OpenAI 訂閱登入需要本站專用的 OAuth client ID，目前尚未開通。" : `請登入 ${provider?.name || "模型供應商"} 帳號。`;
  status.className = `auth-status ${provider?.connected ? "connected" : "unconnected"}`;
  $("oauth-section").hidden = connectionMode !== "subscription" || !provider?.oauth;
  $("disconnect").hidden = !provider?.stored;
  if (connectionMode === "custom") {
    const saved = activeCredential();
    $("custom-url").value = saved?.baseUrl || "";
    $("custom-model").value = saved?.model || "";
    $("custom-key").value = "";
  }
  if (provider?.oauth && connectionMode === "subscription") {
    $("oauth-section").querySelector(".recommended").hidden = !provider.oauth.subscription;
    $("oauth-description").textContent = provider.id === "openai-codex"
      ? "OpenAI 官方要求公開網站先取得專屬 OAuth client ID 並登記回呼網址。本站尚未取得，暫時無法使用訂閱登入；你仍可切換到 API Key 分頁使用 OpenAI。"
      : provider.id === "github-copilot"
      ? "前往 GitHub 登入並輸入裝置代碼；帳號需有 GitHub Copilot 使用權限。"
      : "前往 OpenRouter 登入，授權後會自動回到畫板。模型使用量會計入你的 OpenRouter 帳號。";
    $("oauth-button").textContent = `${provider.oauth.label} ↗`;
  }
}

function openSettings() {
  $("settings-modal").hidden = false;
  document.body.style.overflow = "hidden";
  $("close-settings").focus();
}
function closeSettings() {
  $("settings-modal").hidden = true;
  document.body.style.overflow = "";
  $("open-settings").focus();
}

function setBubble(kicker, message, detail = "") {
  $("ai-bubble").querySelector(".bubble-kicker").textContent = kicker;
  $("ai-message").textContent = message;
  $("ai-detail").textContent = detail;
}

function resetCanvas() {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  hasDrawing = false;
  history = [{ pixels: ctx.getImageData(0, 0, canvas.width, canvas.height), empty: true }];
  historyIndex = 0;
  updateHistoryButtons();
}

function snapshot() {
  history = history.slice(0, historyIndex + 1);
  history.push({ pixels: ctx.getImageData(0, 0, canvas.width, canvas.height), empty: !hasDrawing });
  if (history.length > 18) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $("undo").disabled = historyIndex <= 0;
  $("redo").disabled = historyIndex >= history.length - 1;
}

function restoreHistory(index) {
  historyIndex = index;
  ctx.putImageData(history[index].pixels, 0, 0);
  hasDrawing = !history[index].empty;
  updateHistoryButtons();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
}

function beginDraw(event) {
  if (event.button !== undefined && event.button !== 0) return;
  drawing = true;
  canvas.setPointerCapture(event.pointerId);
  const point = canvasPoint(event);
  ctx.strokeStyle = tool === "eraser" ? "#ffffff" : color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = tool === "eraser" ? brushSize * 3 : brushSize;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  hasDrawing = true;
}

function continueDraw(event) {
  if (!drawing) return;
  const point = canvasPoint(event);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function endDraw() {
  if (!drawing) return;
  drawing = false;
  ctx.closePath();
  snapshot();
}

function setTool(next) {
  tool = next;
  for (const [name, id] of [["pen", "pen-tool"], ["eraser", "eraser-tool"]]) {
    $(id).classList.toggle("active", name === next);
    $(id).setAttribute("aria-pressed", String(name === next));
  }
}

function updateScore() {
  $("guess-count").textContent = String(guesses).padStart(2, "0");
  $("win-count").textContent = String(wins).padStart(2, "0");
}

function newRound(free = false) {
  if (free) challenge = "";
  else {
    const candidates = words.filter(word => word !== challenge);
    challenge = candidates[Math.floor(Math.random() * candidates.length)];
  }
  $("challenge-word").textContent = challenge || "自由創作";
  resetCanvas();
  roundScored = false;
  roundFinished = false;
  $("judge-actions").hidden = true;
  $("guess-button").querySelector("span").textContent = "讓 AI 猜猜看";
  setBubble("AI 準備好了", "畫好了嗎？按下面的按鈕，讓我猜猜看！", "我只看得到畫布，不會偷看題目。");
}

async function requestGuess() {
  if (roundFinished) return newRound();
  if (!hasDrawing) return toast("先在畫布上畫幾筆吧");
  const provider = currentProvider();
  if (!provider?.connected || !selectedModel) {
    toast("請先選擇並連線圖片辨識模型");
    return openSettings();
  }
  const button = $("guess-button");
  button.disabled = true;
  button.querySelector("span").textContent = "正在仔細看你的畫…";
  $("judge-actions").hidden = true;
  setBubble("正在猜畫", "嗯……讓我仔細看看你畫了什麼。", "通常幾秒鐘就好，稍等我一下。");
  try {
    const result = await post("/api/guess", { providerId: selectedProvider, modelId: selectedModel, image: canvas.toDataURL("image/png"), credential: activeCredential() });
    guesses += 1;
    updateScore();
    setBubble("我猜是……", result.guess, result.detail || "這次猜得對嗎？由你來決定！");
    $("judge-actions").hidden = false;
    button.querySelector("span").textContent = "再猜一次";
  } catch (error) {
    setBubble("遇到一點狀況", "這次沒猜出來。", error.message);
    button.querySelector("span").textContent = "再試一次";
    toast(error.message);
  } finally { button.disabled = false; }
}

function addText(parent, tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  parent.append(element);
  return element;
}

function safeLink(parent, url, label) {
  if (!/^https?:\/\//i.test(url)) return;
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  parent.append(link);
}

function renderOAuthSession(session) {
  const flow = $("oauth-flow");
  flow.hidden = false;
  flow.querySelector(".flow-title").lastChild.textContent = session.state === "done" ? " 授權完成" : session.state === "error" ? " 授權未完成" : " 授權進行中";
  const container = $("oauth-events");
  container.replaceChildren();
  for (const event of session.events) {
    const line = document.createElement("p");
    if (event.type === "auth_url") {
      addText(line, "span", "請前往供應商網站完成授權： ");
      safeLink(line, event.url, "開啟授權頁面 ↗");
    } else if (event.type === "device_code") {
      addText(line, "span", "裝置代碼： ");
      addText(line, "code", event.userCode);
      addText(line, "span", "　");
      safeLink(line, event.verificationUri, "開啟驗證頁面 ↗");
    } else {
      addText(line, "span", event.message || "");
      for (const link of event.links || []) {
        addText(line, "span", "　");
        safeLink(line, link.url, "查看說明 ↗");
      }
    }
    container.append(line);
  }
  if (session.error) addText(container, "p", `發生錯誤：${session.error}`);
}

async function pollOAuth() {
  if (!activeSessionId) return;
  clearTimeout(pollingTimer);
  try {
    const session = await post("/api/auth/copilot/poll", { deviceCode: activeSessionId });
    if (session.state === "pending") {
      oauthInterval = Math.max(oauthInterval, (session.interval || 5) * 1000);
      pollingTimer = setTimeout(pollOAuth, oauthInterval);
    } else {
      activeSessionId = null;
      if (session.state === "done" && session.token) saveCredential("github-copilot", { type: "copilot", token: session.token, modelIds: session.modelIds });
      await refreshBootstrap();
      if (session.state === "done") toast("帳號已連線，可以開始猜畫了");
      else toast(session.error || "授權未完成");
    }
  } catch (error) {
    activeSessionId = null;
    toast(error.message);
  }
}

async function startOAuth() {
  if (selectedProvider === "openai-codex") {
    window.open("https://developers.openai.com/siwc/request-client-id", "_blank", "noopener,noreferrer");
    return;
  }
  if (selectedProvider === "openrouter") return startOpenRouterLogin();
  const loginWindow = window.open("about:blank", "_blank");
  try {
    $("oauth-button").disabled = true;
    const result = await post("/api/auth/copilot/start", {});
    if (loginWindow) {
      loginWindow.opener = null;
      loginWindow.location.replace(result.verificationUri);
    }
    activeSessionId = result.deviceCode;
    oauthInterval = result.interval * 1000;
    renderOAuthSession({ state: "pending", events: [{ type: "device_code", userCode: result.userCode, verificationUri: result.verificationUri }] });
    pollingTimer = setTimeout(pollOAuth, oauthInterval);
  } catch (error) { loginWindow?.close(); toast(error.message); }
  finally { $("oauth-button").disabled = false; }
}

function saveRoundForRedirect() {
  try {
    sessionStorage.setItem("draw-guess-round-before-login", JSON.stringify({
      challenge, guesses, wins, roundScored, roundFinished, hasDrawing,
      image: hasDrawing ? canvas.toDataURL("image/png") : null,
    }));
  } catch { /* The login can proceed even when browser storage is full. */ }
}

function restoreRoundAfterRedirect() {
  let saved;
  try { saved = JSON.parse(sessionStorage.getItem("draw-guess-round-before-login") || "null"); }
  catch { saved = null; }
  sessionStorage.removeItem("draw-guess-round-before-login");
  if (!saved) return;
  challenge = typeof saved.challenge === "string" ? saved.challenge : challenge;
  $("challenge-word").textContent = challenge || "自由創作";
  guesses = Number(saved.guesses) || 0;
  wins = Number(saved.wins) || 0;
  roundScored = !!saved.roundScored;
  roundFinished = !!saved.roundFinished;
  updateScore();
  if (roundFinished) $("guess-button").querySelector("span").textContent = "開始下一回合";
  if (saved.hasDrawing && saved.image) {
    const image = new Image();
    image.onload = () => { ctx.drawImage(image, 0, 0, canvas.width, canvas.height); hasDrawing = true; snapshot(); };
    image.src = saved.image;
  }
}

async function startOpenRouterLogin() {
  try {
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const verifier = btoa(String.fromCharCode(...verifierBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const state = crypto.randomUUID();
    const callback = new URL("/openrouter-callback", location.origin);
    callback.searchParams.set("state", state);
    const authorize = new URL("https://openrouter.ai/auth");
    authorize.searchParams.set("callback_url", callback.toString());
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("key_label", "畫點什麼");
    saveRoundForRedirect();
    sessionStorage.setItem("draw-guess-openrouter-pending", JSON.stringify({ state, verifier, startedAt: Date.now() }));
    location.assign(authorize.toString());
  } catch {
    toast("無法開始 OpenRouter 登入，請確認瀏覽器允許儲存網站資料。");
  }
}

function showAuthReturn() {
  const auth = new URLSearchParams(location.search).get("auth");
  if (!auth) return;
  history.replaceState(null, "", location.pathname);
  if (auth === "openrouter-connected") toast("OpenRouter 已連線，可以開始猜畫了");
  if (auth === "openrouter-error") {
    const message = sessionStorage.getItem("draw-guess-auth-error") || "OpenRouter 登入未完成。";
    sessionStorage.removeItem("draw-guess-auth-error");
    toast(message);
  }
}

function bindEvents() {
  canvas.addEventListener("pointerdown", beginDraw);
  canvas.addEventListener("pointermove", continueDraw);
  canvas.addEventListener("pointerup", endDraw);
  canvas.addEventListener("pointercancel", endDraw);
  $("pen-tool").addEventListener("click", () => setTool("pen"));
  $("eraser-tool").addEventListener("click", () => setTool("eraser"));
  document.querySelectorAll(".color-swatch").forEach(button => button.addEventListener("click", () => {
    color = button.dataset.color;
    setTool("pen");
    document.querySelectorAll(".color-swatch").forEach(item => {
      item.classList.toggle("selected", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
  }));
  $("brush-size").addEventListener("input", event => {
    brushSize = Number(event.target.value);
    $("brush-value").textContent = brushSize;
  });
  $("undo").addEventListener("click", () => historyIndex > 0 && restoreHistory(historyIndex - 1));
  $("redo").addEventListener("click", () => historyIndex < history.length - 1 && restoreHistory(historyIndex + 1));
  $("clear").addEventListener("click", () => { resetCanvas(); toast("畫布已清空"); });
  $("new-word").addEventListener("click", () => newRound());
  $("free-draw").addEventListener("click", () => newRound(true));
  $("guess-button").addEventListener("click", requestGuess);
  $("mark-correct").addEventListener("click", () => {
    if (roundScored) return;
    wins += 1;
    roundScored = true;
    roundFinished = true;
    updateScore();
    $("judge-actions").hidden = true;
    $("guess-button").querySelector("span").textContent = "開始下一回合";
    setBubble("猜對啦！", "這幅畫真有靈魂！", "按下面的按鈕，繼續下一回合。");
  });
  $("keep-drawing").addEventListener("click", () => {
    $("judge-actions").hidden = true;
    setBubble("繼續畫吧", "再給我一點線索！", "畫好了再讓我猜一次。");
  });
  for (const id of ["open-settings", "change-model"]) $(id).addEventListener("click", openSettings);
  for (const id of ["close-settings", "done-settings"]) $(id).addEventListener("click", closeSettings);
  $("settings-modal").addEventListener("click", event => { if (event.target === $("settings-modal")) closeSettings(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("settings-modal").hidden) closeSettings(); });
  for (const tab of document.querySelectorAll(".connection-tab")) tab.addEventListener("click", () => {
    connectionMode = tab.dataset.mode;
    $("api-key-input").value = "";
    selectedProvider = connectionMode === "custom" ? "custom" : modeProviders()[0]?.id || "";
    selectedModel = connectionMode === "custom" ? readCredentials().custom?.model || "" : currentProvider()?.models[0]?.id || "";
    $("model-search").value = "";
    $("oauth-flow").hidden = true;
    persistSelection();
    renderSettings();
    renderModelLine();
  });
  $("provider-select").addEventListener("change", event => {
    selectedProvider = event.target.value;
    $("api-key-input").value = "";
    selectedModel = currentProvider()?.models[0]?.id || "";
    $("model-search").value = "";
    $("oauth-flow").hidden = true;
    persistSelection();
    renderSettings();
    renderModelLine();
  });
  $("model-search").addEventListener("input", renderSettings);
  $("model-select").addEventListener("change", event => {
    selectedModel = event.target.value;
    persistSelection();
    renderModelLine();
  });
  $("oauth-button").addEventListener("click", startOAuth);
  $("save-api-key").addEventListener("click", () => {
    const key = $("api-key-input").value.trim();
    if (!key || key.length > 2048) return toast("請輸入有效的 API Key");
    saveCredential(credentialKey(), { type: "api_key", key });
    $("api-key-input").value = "";
    renderSettings();
    renderModelLine();
    toast("API Key 已儲存在此分頁，可以開始猜畫了");
  });
  $("save-custom").addEventListener("click", () => {
    const baseUrl = $("custom-url").value.trim();
    const model = $("custom-model").value.trim();
    const key = $("custom-key").value.trim();
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port && url.port !== "443" || /^(localhost|.*\.(localhost|local|internal|chatgpt\.site))$/i.test(url.hostname) || /^\d+(\.\d+){3}$/.test(url.hostname) || url.hostname.includes(":")) throw new Error();
    } catch { return toast("請輸入公開可連線的 HTTPS API 基底網址"); }
    if (!model || model.length > 120 || key.length > 2048) return toast("請檢查模型 ID 或 API Key");
    saveCredential("custom", { type: "custom", baseUrl, model, key: key || activeCredential()?.key || "" });
    selectedModel = model;
    persistSelection();
    renderSettings();
    renderModelLine();
    toast("自訂介面已儲存，可以開始猜畫了");
  });
  $("disconnect").addEventListener("click", async () => {
    try {
      saveCredential(credentialKey(), null);
      await refreshBootstrap();
      toast("已移除此分頁的模型連線");
    } catch (error) { toast(error.message); }
  });
}

bindEvents();
newRound();
restoreRoundAfterRedirect();
refreshBootstrap(false).then(showAuthReturn).catch(error => {
  toast(`無法讀取模型：${error.message}`);
  setBubble("連線失敗", "模型服務暫時無法使用。", "請稍後重新整理頁面。");
});
