# 畫點什麼 · 你畫 AI 猜

這是可在本機執行的「你畫 AI 猜」網頁遊戲。玩家可用滑鼠、觸控筆或手指畫畫，AI 只會看畫布圖片並猜測內容。每回合可以隨機抽題或自由畫；是否猜對由玩家判定並計分。

## 啟動

需要 Node.js 20 或更新版本。

```powershell
cd D:\codex\html_test\draw-guess
npm install
npm start
```

開啟 http://127.0.0.1:4174 。可用 `PORT` 環境變數調整連接埠。服務只會監聽本機的 `127.0.0.1`。

## 連接模型

點選頁面右上角的「模型設定」，選擇模型供應商與支援圖片辨識的聊天模型，再用訂閱帳號登入或填入 API 金鑰。目前支援 OpenAI、Anthropic、Google、OpenRouter、GitHub Copilot。只有提供 OAuth 的供應商會顯示帳號授權選項；可使用哪些模型，仍取決於你的帳號與供應商。

模型呼叫與圖片輸入使用 [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)。OAuth 由 Node 服務處理，支援授權連結、裝置代碼與手動輸入授權碼。憑證存放在本專案的 `.data/credentials.json`，不會傳回網頁；這個目錄已加入 `.gitignore`。若電腦上已設定對應的環境變數，服務也會依 pi-ai 的驗證規則使用。頁面顯示「已設定」只表示找到憑證或環境變數，實際能否使用會在猜畫時由供應商驗證。

AI 會收到以臺灣繁體中文作答的指示；如果模型仍使用簡體中文，伺服器會在顯示前轉換為臺灣繁體中文與常用詞。

## 驗證

```powershell
npm test
```

瀏覽器測試使用本機 Edge；若瀏覽器安裝在其他位置，可透過 `BROWSER_PATH` 指定。測試會用模擬的猜測結果檢查畫布和回合互動，不會呼叫付費模型。
