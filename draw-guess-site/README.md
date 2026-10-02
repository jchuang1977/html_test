# 畫點什麼｜ChatGPT Sites 公開版

這是 `../draw-guess` 的公開站台版本，沿用相同的畫板與臺灣繁體中文遊戲介面，使用 Vinext / Cloudflare Workers 處理模型請求。

公開版的「模型設定」提供三種連線方式：

- 訂閱登入：GitHub Copilot 裝置登入，以及 OpenRouter 網站授權。OpenRouter 用量依該帳號計算，未必包含模型供應商的訂閱權益。
- API Key：OpenAI、Anthropic、Google 與 OpenRouter；每位訪客使用自己的金鑰。
- 自訂介面：公開 HTTPS 的 OpenAI 相容 Chat Completions 圖片輸入端點，填入基底網址、模型 ID 和選填的 API Key。

連線憑證只存在該訪客分頁的 `sessionStorage`；送出猜畫時傳到本站 Worker，再轉交對應模型服務。伺服器不會持久儲存憑證。OpenRouter 登入前會暫存目前畫布，返回後還原。站內「移除此分頁的連線」只清除本地憑證；若要撤銷供應商授權，須到該帳號管理頁操作。

OpenAI 訂閱登入目前顯示申請提示，尚未開通。OpenAI 官方公開網站登入需要為本站核發的 OAuth client ID 與登記回呼網址；pi-ai 內建的本機 Codex 登入不能直接代替網站的授權設定。取得網站專用授權後，仍須依官方流程實作並驗證圖片辨識模型的使用權限。

本機驗證：`npm ci`、`npm run build`、`npm start -- --port 4175`。站台身分記錄於 `.openai/hosting.json`，使用 Sites 工作流程發佈。
