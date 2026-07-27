@echo off
REM Start the ATLAS SOC Access persistence service.
cd /d "%~dp0"
echo Installing dependencies (first run only)...
pip install -r requirements.txt
echo Starting SOC DB service on http://127.0.0.1:8077 ...
python soc_db_service.py
pause
