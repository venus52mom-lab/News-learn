#!/bin/bash
cd "$(dirname "$0")"
echo "安裝/更新需要的套件..."
python3 -m pip install -U -r requirements.txt
python3 server.py
