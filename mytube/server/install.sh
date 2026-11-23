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
if ss -ltn 2>/dev/null | grep -q ":$PORT " && ! systemctl is-active -q mytube; then
  echo "⚠️ 連接埠 $PORT 已經被其他程式使用，為了不影響它，安裝停止。"; exit 1
fi
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
# 用獨立的低權限帳號執行，碰不到你其他程式（例如程式交易）的檔案
id mytube >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin mytube
mkdir -p "$DIR" "$DIR/tmp"
curl -fsSL "$RAW/server.py" -o "$DIR/server.py"
curl -fsSL "$RAW/requirements.txt" -o "$DIR/requirements.txt"
python3 -m venv "$DIR/venv"
"$DIR/venv/bin/pip" install -q -U pip
"$DIR/venv/bin/pip" install -q -U -r "$DIR/requirements.txt"

chown -R mytube:mytube "$DIR"

echo "==> 4/6 設定下載密碼"
if [ -f "$DIR/token" ]; then TOKEN="$(cat "$DIR/token")"; else TOKEN="$(openssl rand -hex 4)"; echo "$TOKEN" > "$DIR/token"; fi
chown mytube:mytube "$DIR/token"; chmod 600 "$DIR/token"

cat > /etc/systemd/system/mytube.service <<EOF
[Unit]
Description=myTube download server
After=network-online.target

[Service]
User=mytube
Group=mytube
WorkingDirectory=$DIR
# ── 保護你伺服器上的其他程式 ──
Nice=19
CPUWeight=10
IOSchedulingClass=idle
IOWeight=10
MemoryMax=500M
Environment=MYTUBE_PARALLEL=1
Environment=MYTUBE_WORK=$DIR/tmp
Environment=MYTUBE_MIN_FREE_GB=3
Environment=MYTUBE_MAX_FILE_MB=1500
Environment=HOME=$DIR
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
$DIR/venv/bin/pip install -q -U yt-dlp yt-dlp-ejs && chown -R mytube:mytube $DIR && systemctl restart mytube
EOF
chmod +x /etc/cron.daily/mytube-update

systemctl daemon-reload
systemctl enable -q mytube
systemctl restart mytube

echo "==> 5/6 設定 https 網址"
URL=""
if [ -n "$DOMAIN" ]; then
  # 如果 80/443 已經被別的程式用（例如你原本的網站），不要搶
  if ss -ltnp 2>/dev/null | grep -E ':(80|443)\s' | grep -vq caddy; then
    echo "⚠️ 這台伺服器的 80/443 已經有其他程式在用，為了不影響它，改用 Cloudflare 免費網址。"
    DOMAIN=""
  fi
fi
if [ -n "$DOMAIN" ]; then
  if ! command -v caddy >/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  if [ -f /etc/caddy/Caddyfile ] && ! grep -q "myTube" /etc/caddy/Caddyfile && grep -q "{" /etc/caddy/Caddyfile && ! grep -q "^:80" /etc/caddy/Caddyfile; then
    cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak
    printf '\n# myTube\n%s {\n  reverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" >> /etc/caddy/Caddyfile
  else
    printf '# myTube\n%s {\n  reverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$PORT" > /etc/caddy/Caddyfile
  fi
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
echo " 保護設定：低優先權、最多用 500MB 記憶體、一次下載 1 個、硬碟剩不到 3GB 就暫停、"
echo "           檔案傳到手機後馬上刪除，沒拿走的 30 分鐘後自動刪除。"
echo " 想完全移除：systemctl disable --now mytube mytube-tunnel; rm -rf $DIR /etc/systemd/system/mytube*.service /etc/cron.daily/mytube-update"
echo " 如果下載出現「Sign in to confirm you're not a bot」："
echo "   把 YouTube 的 cookies.txt 放到 $DIR/cookies.txt，再執行 systemctl restart mytube"
echo "================================================"
