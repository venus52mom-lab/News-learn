@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 安裝/更新需要的套件...
python -m pip install -U -r requirements.txt
python server.py
pause
