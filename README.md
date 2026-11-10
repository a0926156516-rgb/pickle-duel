# 匹克球對決 Pickle Duel

手機瀏覽器就能玩的匹克球對戰遊戲（繁體中文）。單打 1v1、雙打 2v2，線上最多 4 人用 4 位數房號組隊，空位由電腦補上。

- 純靜態網站：`index.html` + `style.css` + `js/core.js`（規則／物理／AI）+ `js/main.js`（畫面、操作、音效、連線），可直接放 GitHub Pages。
- 線上連線沿用《攀岩》peak2d 的 WebSocket 中繼伺服器與協定（`create` / `join` / `msg`，房主權威）：預設 `wss://panjian-peak2d.onrender.com/ws`，可用 `?server=ws://host:port/ws` 改接。`server/relay.js` 是同協定的本機版（從 peak2d `server.js` 取出房間中繼部分），測試或自架用：`cd server && npm i && PORT=10000 npm start`。
- 網址參數：`?room=1234` 帶入房號、`?auto=1` 自動駕駛（展示／測試）、`?fps=1` 顯示 FPS。

## 規則
低手對角發球、發球不可落廚房區（含線）、兩跳規則、廚房區（非截擊區）截擊犯規與截擊後衝入廚房、出界、掛網、兩次落地；只有發球方得分，11 分領先 2 分（可選 7／15 分）；雙打報分「發球方-接發球方-發球員號碼」，開局 0-0-2，得分時發球員與隊友換邊。

## 操作
- 手機（橫放）：左半邊拖曳移動；右側 抽球／吊小球／高吊。球進入範圍自動揮拍，移動方向控制左右落點；違規的截擊不自動揮拍，但主動按鍵就會照打（並判犯規）。
- 電腦：WASD／方向鍵移動，J／空白 抽球、K 吊小球、L 高吊，Esc 選單。

## 測試（`test/`）
`npm i` 後：`node sim.js`（電腦對電腦整場模擬、計分不變量）、`node rules.js`（規則情境單元測試）、`node local.js` / `node net.js` / `node final.js`（Playwright 截圖、2 人與 4 人線上房間）。需先啟動 `python3 -m http.server 8077`（專案根目錄）與 `PORT=10077 node server/relay.js`。
