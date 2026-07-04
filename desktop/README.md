# desktop/ — 第二階段：Electron Overlay（佔位）

這個目錄保留給第二階段的 Electron 桌面殼。

目標：把 `frontend/` 包進透明懸浮視窗
- `transparent: true` + `frame: false`（無邊框透明）
- `alwaysOnTop: true`（永遠最上層）
- `setIgnoreMouseEvents(true)`（滑鼠穿透，點字幕等於點底下的程式）

詳見 `PROJECT_PLAN.md` 第二階段說明。
