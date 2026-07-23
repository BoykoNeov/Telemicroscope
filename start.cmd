@echo off
setlocal
rem ---------------------------------------------------------------------------
rem Telemicroscope launcher — double-click to start the dev server + browser.
rem
rem The port is never hand-picked: we ask scripts/port-guard.mjs for the port
rem this project owns (canonically 5187), open the browser there, then start the
rem dev server, which re-acquires the same free port. Losing a port is cheap;
rem killing another project's server is not — the guard guarantees we never do.
rem ---------------------------------------------------------------------------

rem Run from this file's own folder no matter where it was launched from.
cd /d "%~dp0"

rem Make sure Node/npm are available before we go further.
where node >nul 2>nul
if errorlevel 1 (
  echo [start] Node.js was not found on your PATH. Install it from https://nodejs.org
  echo         then run this again.
  pause
  exit /b 1
)

rem First-run convenience: install dependencies if they are missing.
if not exist "node_modules" (
  echo [start] Installing dependencies ^(first run^)...
  call npm install
  if errorlevel 1 (
    echo [start] npm install failed. See the messages above.
    pause
    exit /b 1
  )
)

rem Ask the guard which port we'll actually use (stdout is just the number).
set "PORT="
for /f "delims=" %%p in ('node scripts\port-guard.mjs') do set "PORT=%%p"
if not defined PORT set "PORT=5187"

echo [start] Launching Telemicroscope on http://localhost:%PORT%/
echo [start] Leave this window open. Close it (or press Ctrl+C) to stop the server.

rem Open the browser once the server has had a moment to boot.
start "" cmd /c "timeout /t 4 >nul & start "" http://localhost:%PORT%/"

rem Run the dev server in the foreground so this window stays alive with logs.
call npm run dev

rem If the server exits, keep the window up so any error is readable.
echo.
echo [start] Dev server stopped.
pause
