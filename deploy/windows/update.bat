@echo off
setlocal enabledelayedexpansion

REM ---------------------------------------------------------------------------
REM Pulls new code and restarts the mailbox watcher.
REM Run from an Administrator command prompt after every web deploy that
REM touches apps/worker, packages/graph, packages/ingest or packages/extraction.
REM
REM This does NOT run database migrations. `supabase db push` is run once, from
REM whichever machine owns the Supabase link -- not from here, and not twice.
REM ---------------------------------------------------------------------------

set SERVICE=ErpMailWatcher
for %%i in ("%~dp0..\..") do set REPO=%%~fi
set WORKER_DIR=%REPO%\apps\worker
set TSX_CLI=%WORKER_DIR%\node_modules\tsx\dist\cli.mjs

net session >nul 2>&1
if errorlevel 1 (
  echo ERROR: run this from an Administrator command prompt.
  exit /b 1
)

pushd "%REPO%"

echo === Stopping %SERVICE% ===
nssm stop %SERVICE%

echo.
echo === git pull ===
git pull --ff-only
if errorlevel 1 (
  echo ERROR: git pull failed. Resolve it, then re-run.
  echo The service is STOPPED -- restart it with: nssm start %SERVICE%
  popd
  exit /b 1
)

echo.
echo === pnpm install ===
REM The filter installs only the worker's dependency graph -- @checklist/web is
REM excluded, so playwright never downloads its browser binaries on this box.
REM --frozen-lockfile is deliberate: if package.json moved without the lockfile
REM this fails loudly here rather than installing something different from what
REM Vercel built.
call corepack pnpm install --filter "@checklist/worker..." --frozen-lockfile
if errorlevel 1 (
  echo ERROR: pnpm install failed.
  echo The service is STOPPED -- restart it with: nssm start %SERVICE%
  popd
  exit /b 1
)

REM A tsx major upgrade can move this path; the service holds it as a literal.
if not exist "%TSX_CLI%" (
  echo ERROR: tsx is no longer at:
  echo   %TSX_CLI%
  echo Re-run install-service.bat after removing the old service:
  echo   nssm remove %SERVICE% confirm
  popd
  exit /b 1
)

echo.
echo === Starting %SERVICE% ===
nssm start %SERVICE%
nssm status %SERVICE%

popd
echo.
echo Done. Tail the log to confirm the first tick:
echo   type "%REPO%\logs\worker.log"
endlocal
