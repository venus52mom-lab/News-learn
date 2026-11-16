# 匯率走勢（個人用 iPhone App，不用上架）

仿 iOS「股市」的匯率看盤 App，資料來自**臺灣銀行牌告匯率**。

- 首頁：每個幣別一列，縮圖是近 3 個月走勢，右邊是最新牌價與漲跌（點一下切換：日漲跌 % / 3 個月 % / 漲跌值）
- 點進去：3個月 / 1年 / 3年 / 全部歷史，手指在圖上滑動可看每天數值；有最高/最低/平均與台幣換算
- 編輯：加入、移除、拖曳排序臺灣銀行有掛牌的 19 種外幣
- 設定：現金/即期、買入/賣出；「1 外幣 = ? 台幣」或「1000 台幣 = ? 外幣」；紅漲綠跌或綠漲紅跌

## 怎麼運作
GitHub Actions 每個上班日 9:05–17:35 每 30 分鐘去臺銀抓牌價，存進 `data/`；GitHub Pages 把這個資料夾變成網站；
iPhone 用 Safari 打開網站 →「分享」→「加入主畫面」，就會變成一個全螢幕的 App 圖示。

## 第一次設定
1. Settings → Pages → Source 選「Deploy from a branch」、Branch 選 `main` / `(root)` → Save
2. Actions → 左邊「匯率 - 抓完整歷史（第一次手動跑一次）」→ Run workflow（約 30–60 分鐘）
3. Actions → 「匯率 - 更新匯率」→ Run workflow（之後會自動排程）
4. iPhone Safari 打開 `https://venus52mom-lab.github.io/News-learn/fx-rates/` → 分享 → 加入主畫面

## 桌面小工具（選用）
`widget/fx-widget.js` 給免費 App「Scriptable」用，可以在主畫面放像股市一樣的小工具。說明寫在檔案開頭。
