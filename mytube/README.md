# myTube 📺

YouTube 風格的個人影音庫，有這些功能：

- **影片**、**音樂**、**下載** 三個分頁（下載固定在最右邊），右上角可以切換深色／淺色模式
- 貼上 YouTube 網址就能下載 **MP4** 或 **MP3**，可以一次下載一個，也可以同時下載很多個（同時跑 3 個），下面會顯示下載紀錄
- 下載好的檔案**會保存在 myTube 裡**，直接按「影片」「音樂」分頁就能播放
- 可以把手機裡原本就有的影片和音樂載入 myTube
- 影片滑到畫面中間時，會自動靜音播放前 5 秒當預覽；滑到下一部，上一部的預覽就會停止
- 可以**背景播放**（切到別的 App 或關掉螢幕也會繼續）、**子母畫面**、在 myTube 裡**縮小播放**
- 影片和音樂各有自己的**播放清單**，也有隨機播放和循環播放
- 鎖定畫面和控制中心都能控制播放（播放／暫停／上一首／下一首）

可以在 iPhone、Android、Windows、Mac 上使用（介面是手機版）。

**網址：** https://venus52mom-lab.github.io/News-learn/mytube/

## 給朋友用（每支手機各自獨立）
- 把上面的網址傳給朋友，請他們用 **Safari 打開 → 分享 →「加入主畫面」**，再從桌面的 myTube 打開
- **密碼鎖是選用的**：想上鎖的人按右上角🔒自己設定 4 位數 PIN 碼，每支手機各自設定，可以都不一樣
- 影片、音樂、播放清單、下載紀錄、深淺色設定都**只存在那支手機裡**，彼此看不到，也不會互相影響
- 忘記密碼：在解鎖畫面按「忘記密碼？」並按兩次確認，會清除**那支手機**的 myTube 資料，然後重新設定（不會影響別人，也不會影響同網站的其他 App）

## 資料會不會不見？
- 從**桌面 App** 打開的 myTube，匯入或下載的影片會一直保留。隔一週、一個月再打開都還在，iPhone 不會因為「很久沒用」自動清掉
- 我（開發者）**更新程式不會刪掉任何人的影片**，因為資料存在每支手機裡，不在 GitHub 上
- 會讓資料消失的情況：刪掉桌面上的 myTube 圖示、在 iPhone 設定清除 Safari 網站資料、手機空間嚴重不足時 iOS 自動清理、按了「忘記密碼」重設
- 只在 Safari 網頁裡（沒有加到主畫面）使用的話，超過 7 天沒開，Safari 可能會清掉資料，所以一定要加到主畫面
- 在 Safari 網頁裡和桌面 App 裡的資料是**分開**的，要匯入的話請在桌面 App 裡匯入

---

## 下載方式
0. **📱 App 內下載（預設，不用電腦、不用設定）**：在 myTube 裡貼網址就直接下載，完成後自動出現在影片／音樂，可以一次下載很多個。程式內建 4 個 cobalt 下載服務，依序嘗試，一個失敗就自動換下一個（內建清單寫在 `app.js` 的 `DEFAULT_APIS`）。公開服務隨時可能被 YouTube 擋或關閉，不能用時可以在「⚙️ 下載設定」加入自己找到的 API 網址（會優先使用），清單可到 https://instances.cobalt.best/service/youtube 查看
1. **🌐 下載網站**：按「開始下載」會自動複製網址並打開下載網站（預設 cobalt.tools）→ 貼上網址下載 → 存到「檔案」App → 回 myTube 按紀錄上的「匯入 myTube」選那個檔案。外部網站有時會被 YouTube 擋，失敗時可以在「下載設定」換別的下載網站
2. **💻 我的電腦伺服器**：最穩、可以一次下載很多個，下載完自動出現在影片/音樂裡，但電腦要開著（見下面）

## 架構（為什麼要兩個部分）

YouTube 不讓網頁直接下載影片，所以 myTube 分成兩個部分：

| 部分 | 放在哪 | 做什麼 |
|---|---|---|
| 網頁 App（`index.html`、`app.js`…） | GitHub Pages | 介面、播放器、影音庫、播放清單 |
| 下載伺服器（`server/`） | 你自己的 Windows / Mac 電腦 | 用 yt-dlp 從 YouTube 下載，再轉成 MP4 或 MP3 |

> 只看影片、聽音樂、載入手機裡的檔案的話，**不需要**伺服器。只有「下載 YouTube」才需要。

---

## 1. 放到 GitHub Pages

1. 到 github.com 建立新的 repository，例如 `mytube`（設成 Public）
2. 按 **Add file → Upload files**，把這個資料夾裡的**所有檔案和資料夾**拖進去（`index.html` 要在最外層），然後按 Commit
   - 用 iPhone 的話，先在 Safari 網址列按「ㄚㄚ」→「切換為電腦版網站」，才會出現上傳按鈕
3. 到 **Settings → Pages**，Source 選 **Deploy from a branch**，Branch 選 `main`、`/ (root)`，按 Save
4. 等大約 1 分鐘，網址會是 `https://你的帳號.github.io/mytube/`
5. iPhone 用 Safari 打開這個網址 → 按分享 → **加入主畫面**，之後就能像 App 一樣使用（背景播放也會比較穩定）

## 2. 在電腦上執行下載伺服器

### 先安裝這 3 個（只要裝一次）
- **Python 3.10 以上**：https://www.python.org/downloads/ （Windows 安裝時記得勾選「Add Python to PATH」）
- **ffmpeg**（轉 MP3、合併高畫質影片要用）
  - Windows：`winget install ffmpeg`
  - Mac：`brew install ffmpeg`
- **Deno**（現在 yt-dlp 下載 YouTube 需要它）
  - Windows：`winget install DenoLand.Deno`
  - Mac：`brew install deno`

### 啟動
- Windows：雙擊 `server/start-windows.bat`
- Mac：雙擊 `server/start-mac.command`（如果被擋，請按右鍵 → 打開）

啟動後畫面會顯示 `手機（同一個 Wi-Fi）開：http://192.168.x.x:8000`。

## 3. 讓手機連到伺服器（二選一）

**方法 A：用 GitHub Pages 網址（推薦，出門也能用）**

GitHub Pages 是 https，不能直接連家裡的 http 伺服器，所以要用免費的 Cloudflare Tunnel 拿到一個 https 網址：

```bash
# Windows：winget install Cloudflare.cloudflared    Mac：brew install cloudflared
cloudflared tunnel --url http://localhost:8000
```

把它顯示的 `https://xxxx.trycloudflare.com` 貼到 myTube →「下載」→「⚙️ 下載伺服器與儲存設定」→ 按「測試」。
（這種免費網址每次重開都會換，要固定網址可以改用 Cloudflare 帳號建立 named tunnel。）

**方法 B：同一個 Wi-Fi 下直接開**

手機直接打開 `http://電腦IP:8000`，伺服器網址會自動填好。缺點是只能在家用，而且因為不是 https，離線功能不會啟用。

---

## 存到手機「檔案」裡的 myTube 資料夾

網頁 App 不能自己在手機裡建立資料夾（這是 iOS 和 Android 的安全限制），所以不同裝置的做法不一樣：

| 裝置 | 怎麼存 |
|---|---|
| **iPhone / iPad** | 檔案一定會先存在 myTube 裡。要放進「檔案」App：按紀錄上的 **📁 存到檔案** →「儲存到檔案」→ 選 **我的 iPhone › myTube › 影片**（或 **音樂**）。第一次要先在「檔案」App 建好 `myTube/影片`、`myTube/音樂` 資料夾，之後 iPhone 會記住上次選的位置。 |
| **Android** | 下載完會自動存一份到「下載」資料夾 |
| **Windows / Mac（Chrome、Edge）** | 在設定按「選擇儲存位置」，會自動建立 `myTube/影片`、`myTube/音樂`，之後下載完就會自動分類存好 |
| **Mac Safari / Firefox** | 存到「下載」資料夾 |

## 背景播放小提醒（iPhone）
- **音樂**：直接背景播放，可以鎖定螢幕、用控制中心切歌
- **影片**：
  - 按「**子母畫面**」：縮成小視窗繼續看，可以邊用其他 App
  - 按「**背景播放**」：只播聲音，可以關掉螢幕繼續聽
  - 影片播放中直接切出去的話，myTube 會試著自動切成背景音訊。iOS 有時會擋這個動作，所以要離開 App 前，先按「背景播放」或「子母畫面」最穩

## 注意
- 請只下載你有權利保存的內容（自己的影片、創用 CC、已取得授權的內容）。下載 YouTube 影片可能違反 YouTube 服務條款
- 檔案存在瀏覽器的 App 儲存空間裡。如果刪掉主畫面的 myTube 或清除 Safari 網站資料，這些檔案會一起消失，重要的檔案請另外「存到檔案」
- 如果下載出現錯誤，大多是 yt-dlp 太舊，重新執行啟動檔就會自動更新
