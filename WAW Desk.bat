@echo off
title WAW Desk
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0WAW-Desk.ps1"
if errorlevel 1 pause
