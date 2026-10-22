@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe goto setup
if not exist .venv\.science-hub-ready goto setup
if not exist frontend\dist\index.html goto setup
goto launch
:setup
python setup.py
if errorlevel 1 (
  pause
  exit /b 1
)
:launch
.venv\Scripts\python.exe run.py
pause
