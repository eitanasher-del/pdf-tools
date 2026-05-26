@echo off
title PDF Tools
cd /d "%~dp0"

:: Check Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.9+ from https://python.org
    pause
    exit /b 1
)

:: Create virtual environment on first run
if not exist venv\ (
    echo Creating virtual environment, please wait...
    python -m venv venv
)

:: Activate venv
call venv\Scripts\activate.bat

:: Install dependencies if not already installed
pip show pymupdf >nul 2>&1
if errorlevel 1 (
    echo Installing dependencies ^(first run only, this may take a minute^)...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: Open browser and start server
echo.
echo  =============================================
echo    PDF Tools is starting...
echo    Opening http://localhost:5000 in browser
echo  =============================================
echo.
start http://localhost:5000
timeout /t 2 /nobreak >nul
python app.py

deactivate
