@echo off
cd /d "%~dp0"
set "PHP_EXE=C:\xampp\php\php.exe"
if not exist "%PHP_EXE%" set "PHP_EXE=php"
"%PHP_EXE%" artisan serve --host=127.0.0.1 --port=8000
pause
