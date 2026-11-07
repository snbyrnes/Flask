@echo off
rem Starts the SMS Substances viewer and opens it in your browser.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install || goto :error
)
call npm start
goto :eof

:error
echo.
echo Could not install dependencies. Check that Node.js 20 or newer is installed.
pause
