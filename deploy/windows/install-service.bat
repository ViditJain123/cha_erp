@echo off
setlocal enabledelayedexpansion

REM ---------------------------------------------------------------------------
REM Installs the mailbox watcher (apps/worker) as a Windows Service via NSSM.
REM Run once, from an Administrator command prompt.
REM
REM Prerequisites:
REM   - Node 24 installed and on PATH
REM   - NSSM on PATH            (https://nssm.cc/download)
REM   - Repo cloned and `corepack pnpm install` already run
REM   - .env.local present at the repo root (see env.local.template)
REM ---------------------------------------------------------------------------

set SERVICE=ErpMailWatcher

REM Repo root = two levels up from this script (deploy\windows\..\..)
for %%i in ("%~dp0..\..") do set REPO=%%~fi
set WORKER_DIR=%REPO%\apps\worker
set LOG_DIR=%REPO%\logs

REM tsx is reached through the pnpm junction rather than the versioned
REM node_modules\.pnpm\tsx@x.y.z\... path, so a tsx upgrade does not silently
REM leave the service pointing at a directory that no longer exists.
set TSX_CLI=%WORKER_DIR%\node_modules\tsx\dist\cli.mjs

REM --- preflight -------------------------------------------------------------

net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: run this from an Administrator command prompt.
  exit /b 1
)

REM AppParameters is passed to NSSM as a single quoted string, so a repo path
REM containing a space would be split into two argv entries by node. Rather
REM than fight nested batch quoting, refuse the path outright.
echo %REPO% | findstr /C:" " >nul
if not errorlevel 1 (
  echo ERROR: the repo path contains a space:
  echo   %REPO%
  echo Move the checkout somewhere without spaces, e.g. C:\erp\checklist-app
  exit /b 1
)

where nssm >nul 2>&1
if errorlevel 1 (
  echo ERROR: nssm not found on PATH. Download from https://nssm.cc/download
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: node not found on PATH.
  exit /b 1
)

for /f "delims=" %%i in ('where node') do set NODE_EXE=%%i& goto :gotnode
:gotnode

if not exist "%TSX_CLI%" (
  echo ERROR: tsx not found at:
  echo   %TSX_CLI%
  echo Run `corepack pnpm install` in %REPO% first.
  exit /b 1
)

if not exist "%REPO%\.env.local" (
  echo ERROR: %REPO%\.env.local is missing.
  echo Copy deploy\windows\env.local.template and fill it in.
  exit /b 1
)

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM --- install ---------------------------------------------------------------

echo Installing service %SERVICE% ...
nssm install %SERVICE% "%NODE_EXE%"
if errorlevel 1 (
  echo ERROR: nssm install failed. Is %SERVICE% already installed?
  echo Remove it first with:  nssm remove %SERVICE% confirm
  exit /b 1
)

REM Node is invoked directly on the tsx CLI -- NOT through corepack/pnpm.
REM Wrapper processes sit between the service manager and node and swallow the
REM Ctrl+C that the graceful-shutdown path depends on.
nssm set %SERVICE% AppParameters "%TSX_CLI% src\index.ts"
nssm set %SERVICE% AppDirectory "%WORKER_DIR%"
nssm set %SERVICE% DisplayName "ERP Mailbox Watcher"
nssm set %SERVICE% Description "Polls connected Outlook mailboxes and ingests customs documents."
nssm set %SERVICE% Start SERVICE_AUTO_START

REM Windows has no SIGTERM. Node never receives the SIGTERM handler registered
REM in apps/worker/src/index.ts, so the graceful path is reachable only via a
REM console Ctrl+C, which raises SIGINT. AppStopMethodConsole defaults to
REM 1500ms -- far under the 25s drain in index.ts:52 -- so it must be raised or
REM every stop is a hard kill.
nssm set %SERVICE% AppStopMethodConsole 30000

REM Restart on unexpected exit. The tick loop already swallows per-tick errors,
REM so an exit means something fatal: back off before retrying.
nssm set %SERVICE% AppExit Default Restart
nssm set %SERVICE% AppRestartDelay 5000

REM logger.ts writes one JSON line per poll to stdout, forever. Cap it.
nssm set %SERVICE% AppStdout "%LOG_DIR%\worker.log"
nssm set %SERVICE% AppStderr "%LOG_DIR%\worker.err.log"
nssm set %SERVICE% AppRotateFiles 1
nssm set %SERVICE% AppRotateOnline 1
nssm set %SERVICE% AppRotateBytes 10485760

echo.
echo Starting %SERVICE% ...
nssm start %SERVICE%

echo.
echo Done. Verify with:
echo   nssm status %SERVICE%
echo   type "%LOG_DIR%\worker.log"
echo.
echo IMPORTANT -- confirm graceful shutdown actually works:
echo   nssm stop %SERVICE%
echo then check worker.log for a "shutting down" line. If it is absent, the
echo Ctrl+C is not reaching node and every stop strands one mailbox for the
echo 10-minute staleness window in claim_mail_connection.
echo.

endlocal
