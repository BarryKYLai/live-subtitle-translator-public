# Meeting Live Translator

即時語音翻譯字幕工具:把會議中雙方說的話轉成中越雙語字幕,顯示在你的螢幕上。目前為**低延遲版本(約 2–3 秒),非真正即時**,持續優化中。

---

## 這個專案做了什麼(What)

在遠端視訊會議中,同時擷取兩條音訊來源:

- **你的麥克風**(`getUserMedia`)— 你說的話
- **會議分頁的音訊**(`getDisplayMedia`)— 對方說的話

兩條音軌分別送到本機的 Node.js relay,由 Gemini API 做語音辨識 + 翻譯(一次完成),然後在瀏覽器頁面上顯示**雙色雙語字幕**:

- 藍色 = 你說的(原文 + 翻譯)
- 珊瑚色 = 對方說的(原文 + 翻譯)

語言方面,兩條音軌各有一個「主要語言」(麥克風預設繁體中文 zh-TW、分頁音訊預設越南文 vi),但 prompt 允許 Gemini 自動判斷實際輸入語言再翻譯成另一種;夾雜的英文術語(IT/AI 詞彙)會保留原文。中文輸出強制繁體。

整套工具**只在你這一端跑**:對方零安裝、零設定、不需要金鑰。用兩條獨立音軌天然分辨「誰在說話」,不需要語者分離模型。

## 用途(Why / Use case)

適合「你聽不懂對方語言、對方也不會為你安裝任何東西」的遠端視訊情境,例如:

- 跨語言的遠端會議或面試
- 需要即席理解外語內容、又不能要求對方配合的場合

需要讓對方也看到字幕時,把字幕視窗透過會議軟體分享出去即可。

## 怎麼用(How to run)

### 環境需求

- Windows + 桌面版 Chrome 或 Edge(分頁音訊擷取只有桌面版 Chromium 系瀏覽器支援)
- Node.js 18 以上
- 一組 Gemini API 金鑰(可在 [Google AI Studio](https://aistudio.google.com/apikey) 免費申請)

### 設定與啟動

```sh
git clone <repo-url>
cd meeting-live-translator
npm install
copy .env.example .env    # macOS/Linux 用 cp
```

編輯 `.env`,填入你的金鑰(只需要這一個環境變數):

```
GEMINI_API_KEY=<你的金鑰>
```

啟動:

```sh
npm start
```

瀏覽器開啟 **http://localhost:3000**,按「開始字幕」:

1. 允許麥克風存取
2. 選擇含有對方聲音的分頁,**務必勾選「分享分頁音訊」**(預設不勾;沒勾會拿到無聲串流且不報錯)
3. 字幕開始顯示

音訊參數(靜音門檻、噪音過濾、切段長度等)集中在 `server/config.js`,可直接修改或用同名環境變數覆蓋。金鑰以外的設定都不放 `.env`。

## 技術架構

```
瀏覽器前端 (原生 JS)                    本機 relay (Node.js)
┌─────────────────────────┐            ┌──────────────────────────┐
│ 麥克風 → AudioWorklet    │─ WebSocket→│ 噪音閘門 (RMS/ZCR)        │
│ 分頁音訊 → Silero VAD    │─ WebSocket→│ → Gemini API (辨識+翻譯)  │
│ 字幕渲染 (partial/final) │←──────────│ 金鑰只存在這一層           │
└─────────────────────────┘            └──────────────────────────┘
```

- **前端**:原生 JavaScript 單頁,無框架。麥克風軌用 AudioWorklet 擷取 16kHz PCM;分頁音軌接 [Silero VAD](https://github.com/ricky0123/vad)(`@ricky0123/vad-web`,WASM)在瀏覽器端先過濾非人聲,只把語音片段送出。
- **Relay**:Node.js + Express + ws。持有 `GEMINI_API_KEY`(環境變數),前端只連 localhost,金鑰不進前端、不進 git。
- **引擎層**:抽象成可抽換的 `Transcriber` 介面(輸入音訊 → 回傳 `{ original, translated }`)。目前使用 **chunk 模式**(`GeminiChunkEngine`,gemini-2.5-flash):累積一段語音後整段送 API,附帶靜音偵測、三層噪音閘門(時長 / 平均音量 / 過零率)與相鄰段重疊,減少斷句掉字。另有 Gemini Live API 的串流實作(`GeminiLiveEngine`)保留在程式庫中,見下方「已知挑戰」。

## 開發方式

本專案以 **AI agent 協作開發**(Claude Code / Codex)完成:我負責需求定義、實際測試、參數調校決策與驗收,AI 負責程式碼實作。

## 目前狀態與已知挑戰

這是一個**進行中的個人專案**,已能在 localhost 完整運作,但仍在調優與實測階段。目前遇到的主要挑戰:

- **延遲優化**:chunk 模式的架構延遲約 2–3 秒(要等一句話講完才送 API)。真正的低延遲需要串流式 API。
- **Gemini Live API 的可用性**:專案原本以 Gemini Live(雙向串流)為目標引擎,但實測發現使用的 API 金鑰在帳戶層級沒有 `bidiGenerateContent` 權限。倉庫裡的 `live-test.mjs` / `live-test-raw.mjs` / `check-models.ps1` 是為此寫的診斷腳本,測過多個模型版本(gemini-2.0-flash-live-001、gemini-live-2.5-flash-preview 等)與 API 版本(v1alpha / v1beta)皆不可用。目前以 chunk 模式替代,引擎介面已抽換化,權限開放後可直接切回。
- **長語音段**:分頁音軌由 VAD 切段,連續講話時可能產生過長片段、拉高單句延遲,需要加上強制切段。
- **VAD 的本質限制**:VAD 只能判斷「是不是人聲」,無法區分「對方在講話」與「分頁裡播放的其他真人語音」。

## 未來規劃

- 朝更低延遲、接近即時的方向優化(Gemini Live API 或其他串流辨識方案)
- 分頁音軌加上最大長度強制切段,壓住長句延遲
- 桌面懸浮字幕(Electron/Tauri 透明置頂視窗,`desktop/` 已預留)
- 離線引擎選項:本地 Whisper 辨識 + LLM 翻譯,沿用同一套 `Transcriber` 介面
- 會後自動摘要(以累積的文字稿產生,不做錄音存檔)
