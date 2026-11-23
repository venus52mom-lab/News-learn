#!/usr/bin/env bash
# myTube 雲端下載伺服器 一鍵安裝（Ubuntu / Debian）
#
# 用法（在伺服器上用 root 執行）：
#   有網域（推薦，網址固定）：
#     curl -fsSL https://raw.githubusercontent.com/venus52mom-lab/News-learn/main/mytube/server/install.sh | bash -s -- 你的網域
#   沒有網域（用 Cloudflare 免費網址，重開機網址會變）：
#     curl -fsSL https://raw.githubusercontent.com/venus52mom-lab/News-learn/main/mytube/server/install.sh | bash
#
# 再跑一次就是「更新」，密碼會保留。
set -euo pipefail

DOMAIN="${1:-}"
RAW="https://raw.githubusercontent.com/venus52mom-lab/News-learn/main/mytube/server"
DIR="/opt/mytube"
PORT="8765"

if [ "$(id -u)" != "0" ]; then echo "請用 root 執行（前面加 sudo）"; exit 1; fi
command -v apt-get >/dev/null || { echo "這個安裝檔只支援 Ubuntu / Debian"; exit 1; }

echo "==> 1/6 安裝系統套件（Python、ffmpeg）"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip ffmpeg curl unzip ca-certificates gnupg openssl >/dev/null

echo "==> 2/6 安裝 Deno（YouTube 驗證需要）"
if ! command -v deno >/dev/null; then
  curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y >/dev/null
fi
deno --version | head -1

echo "==> 3/6 下載 myTube 伺服器程式"
mkdir -p "$DIR"
curl -fsSL "$RAW/server.py" -o "$DIR/server.py"
curl -fsSL "$RAW/requirements.txt" -o "$DIR/requirements.txt"
python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install -q -U pip
"$DIR/venv/bin/pip" install -q -U -r "$DIR/requirements.txt"

echo "==> 4/6 設定下載密碼"
if [ -f "$DIR/token" ]; then TOKEN="$(cat "$DIR/token")"; else TOKEN="$(openssl rand -hex 4)"; echo "$TOKEN" > "$DIR/token"; chmod 600 "$DIR/token"; fi

cat > /etc/systemd/system/mytube.service <<EOF
[Unit]
Description=myTube download server
After=network-online.target

[Service]
WorkingDirectory=$DIR
Environment=MYTUBE_TOKEN=$TOKEN
Environment=MYTUBE_API_ONLY=1
Environment=MYTUBE_HOST=127.0.0.1
Environment=PORT=$PORT
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=$DIR/venv/bin/python $DIR/server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

# 每天自動更新 yt-dlp（YouTube 常改版）
cat > /etc/cron.daily/mytube-update <<EOF
#!/bin/sh
$DIR/venv/bin/pip install -q -U yt-dlp yt-dlp-ejs && systemctl restart mytube
EOF
chmod +x /etc/cron.daily/mytube-update

systemctl daemon-reload
systemctl enable -q mytube
systemctl restart mytube

echo "==> 5/6 設定 https 網址"
URL=""
if [ -n "$DOMAIN" ]; then
  if ! command -v caddy >/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  reverse_proxy 127.0.0.1:$PORT
}
EOF
  systemctl restart caddy
  URL="https://$DOMAIN"
else
  if ! command -v cloudflared >/dev/null; then
    ARCH="$(dpkg --print-architecture)"
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$ARCH.deb" -o /tmp/cloudflared.deb
    dpkg -i /tmp/cloudflared.deb >/dev/null
  fi
  cat > /etc/systemd/system/mytube-tunnel.service <<EOF
[Unit]
Description=myTube Cloudflare quick tunnel
After=network-online.target mytube.service

[Service]
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$PORT
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable -q mytube-tunnel
  systemctl restart mytube-tunnel
  for i in $(seq 1 30); do
    URL="$(journalctl -u mytube-tunnel --no-pager -n 200 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1 || true)"
    [ -n "$URL" ] && break; sleep 2
  done
fi

echo "==> 6/6 檢查"
sleep 2
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then echo "伺服器運作中 ✅"; else echo "⚠️ 伺服器沒有回應，請執行：journalctl -u mytube -n 50"; fi

echo
echo "================================================"
echo " myTube 下載伺服器裝好了！在 myTube「下載」→「⚙️ 下載設定」填入："
echo "   伺服器網址：${URL:-（還沒拿到，等一下執行：journalctl -u mytube-tunnel | grep trycloudflare）}"
echo "   下載密碼：  $TOKEN"
echo
echo " 給朋友用：把上面兩個一起傳給他們。"
echo " 如果下載出現「Sign in to confirm you're not a bot」："
echo "   把 YouTube 的 cookies.txt 放到 $DIR/cookies.txt，再執行 systemctl restart mytube"
echo "================================================"
