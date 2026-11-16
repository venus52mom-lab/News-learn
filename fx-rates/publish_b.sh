#!/bin/bash
# 把 A 版（fx-rates/）目前的程式複製成 B 版（fx-b/）。只有在要更新 B 網址時才執行。
# B 版的程式固定不動，但資料直接讀 A 版的 data/，所以匯率、股價照常每小時更新。
set -e
cd "$(dirname "$0")/.."
rm -rf fx-b && mkdir fx-b
cp -r fx-rates/index.html fx-rates/app.js fx-rates/style.css fx-rates/sw.js fx-rates/manifest.webmanifest fx-rates/catalog.json fx-rates/icons fx-b/
# 資料讀 A 版的 data/
sed -i 's#|| "data/"#|| "../fx-rates/data/"#' fx-b/app.js
# 設定分開存（同一支手機同時裝 A 和 B 也不會互相影響）
sed -i 's/"fx-settings"/"fxb-settings"/g; s/"fx-mm-quota"/"fxb-mm-quota"/g' fx-b/app.js
# 離線快取分開
sed -i 's/"fx-v/"fxb-v/; s/k.startsWith("fx-v")/k.startsWith("fxb-v")/' fx-b/sw.js
sed -i 's/"name": "匯率股市"/"name": "匯率股市 B"/' fx-b/manifest.webmanifest
echo "B 版已更新：$(date '+%Y-%m-%d %H:%M')" > fx-b/VERSION.txt
grep -c '"../fx-rates/data/"' fx-b/app.js >/dev/null && grep -q fxb-settings fx-b/app.js && grep -q fxb-v fx-b/sw.js && echo OK
