const $ = id => document.getElementById(id);
const canvas = $("draw-canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const words = ["小貓", "冰淇淋", "雨傘", "腳踏車", "火箭", "烏龜", "漢堡", "向日葵", "咖啡杯", "眼鏡", "小船", "蘋果", "蝴蝶", "恐龍", "熱氣球", "雪人", "吉他", "西瓜", "城堡", "章魚", "機器人", "月亮", "小狗", "蘑菇"];

let providers = [];
let selectedProvider = "";
let selectedModel = "";
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

function currentProvider() { return providers.find(p => p.id === selectedProvider); }
function currentModel() { return currentProvider()?.models.find(m => m.id === selectedModel); }

function persistSelection() {
  localStorage.setItem("draw-guess-selection", JSON.stringify({ provider: selectedProvider, model: selectedModel }));
}

function loadSelection() {
  try { return JSON.parse(localStorage.getItem("draw-guess-selection") || "{}"); }
  catch { return {}; }
}

async function refreshBootstrap(keepSelection = true) {
  const data = await api("/api/bootstrap");
  providers = data.providers;
  const saved = loadSelection();
  const wanted = keepSelection ? selectedProvider || saved.provider : saved.provider;
  selectedProvider = providers.find(p => p.id === wanted)?.id || providers.find(p => p.connected)?.id || providers[0]?.id || "";
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
  const providerSelect = $("provider-select");
  providerSelect.replaceChildren();
  for (const provider of providers) {
    const option = new Option(`${provider.name}${provider.connected ? " · 已設定" : ""}`, provider.id);
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
  status.textContent = provider?.connected ? `✓ ${provider.name} 已透過${provider.stored ? (provider.authType === "oauth" ? "訂閱帳號" : "API 金鑰") : "環境變數"}設定，可以開始猜畫了。` : `${provider?.name || "模型供應商"}尚未連線，請選擇一種方式。`;
  status.className = `auth-status ${provider?.connected ? "connected" : "unconnected"}`;
  $("oauth-section").hidden = !provider?.oauth;
  $("key-section").hidden = !provider?.apiKey;
  $("disconnect").hidden = !provider?.stored;
  if (provider?.oauth) {
    $("oauth-section").querySelector("h3").firstChild.textContent = provider.oauth.subscription ? "用訂閱帳號登入 " : "透過帳號授權 ";
    $("oauth-section").querySelector(".recommended").hidden = !provider.oauth.subscription;
    $("oauth-description").textContent = provider.oauth.subscription ? "到供應商網站授權。可使用的訂閱權益由供應商決定。" : "到供應商網站授權，取得此服務的存取憑證。";
    $("oauth-button").textContent = `${provider.oauth.label} ↗`;
  }
}

function openSettings() {
  $("settings-modal").hidden = false;
  document.body.style.overflow = "hidden";
  $("close-settings").focus();
  if (activeSessionId) pollOAuth();
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
    const result = await post("/api/guess", { providerId: selectedProvider, modelId: selectedModel, image: canvas.toDataURL("image/png") });
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
  const prompt = session.prompt;
  const form = $("oauth-prompt");
  form.hidden = !prompt;
  if (prompt) {
    $("prompt-label").textContent = prompt.message;
    const select = $("prompt-options");
    const input = $("prompt-value");
    select.hidden = prompt.type !== "select";
    input.hidden = prompt.type === "select";
    input.type = prompt.type === "secret" ? "password" : "text";
    input.placeholder = "請輸入授權資訊";
    select.replaceChildren(...(prompt.options || []).map(option => new Option(option.label, option.id)));
  }
}

async function pollOAuth() {
  if (!activeSessionId) return;
  clearTimeout(pollingTimer);
  try {
    const session = await api(`/api/auth/session/${activeSessionId}`);
    renderOAuthSession(session);
    if (session.state === "pending") pollingTimer = setTimeout(pollOAuth, 900);
    else {
      activeSessionId = null;
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
  try {
    $("oauth-button").disabled = true;
    const session = await post("/api/auth/oauth", { providerId: selectedProvider });
    activeSessionId = session.id;
    renderOAuthSession(session);
    pollOAuth();
  } catch (error) { toast(error.message); }
  finally { $("oauth-button").disabled = false; }
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
  $("provider-select").addEventListener("change", event => {
    selectedProvider = event.target.value;
    selectedModel = currentProvider()?.models[0]?.id || "";
    $("model-search").value = "";
    $("api-key").value = "";
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
  $("save-key").addEventListener("click", async () => {
    const key = $("api-key").value;
    if (!key.trim()) return toast("請先輸入 API 金鑰");
    try {
      $("save-key").disabled = true;
      await post("/api/auth/key", { providerId: selectedProvider, key });
      $("api-key").value = "";
      await refreshBootstrap();
      toast("金鑰已儲存在這台電腦，猜畫時會驗證是否可用");
    } catch (error) { toast(error.message); }
    finally { $("save-key").disabled = false; }
  });
  $("oauth-button").addEventListener("click", startOAuth);
  $("oauth-prompt").addEventListener("submit", async event => {
    event.preventDefault();
    if (!activeSessionId) return;
    const value = $("prompt-options").hidden ? $("prompt-value").value : $("prompt-options").value;
    try {
      await post(`/api/auth/session/${activeSessionId}/reply`, { value });
      $("prompt-value").value = "";
      $("oauth-prompt").hidden = true;
      pollOAuth();
    } catch (error) { toast(error.message); }
  });
  $("disconnect").addEventListener("click", async () => {
    try {
      await post("/api/auth/logout", { providerId: selectedProvider });
      await refreshBootstrap();
      toast(currentProvider()?.connected ? "已移除本機憑證；環境變數仍可使用此服務" : "已中斷此模型服務的連線");
    } catch (error) { toast(error.message); }
  });
}

bindEvents();
newRound();
refreshBootstrap(false).catch(error => {
  toast(`無法讀取模型：${error.message}`);
  setBubble("連線失敗", "本機服務還沒準備好。", "請確認已執行 npm start。");
});
