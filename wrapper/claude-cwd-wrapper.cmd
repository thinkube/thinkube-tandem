@echo off
REM Windows entrypoint registered in claudeCode.claudeProcessWrapper.
REM Forwards all args verbatim to the PowerShell wrapper alongside it.
REM Using -File requires PowerShell 5+ which ships with every supported
REM Windows version; -NoProfile keeps user profile noise out of the env;
REM -ExecutionPolicy Bypass avoids needing a signed script.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0claude-cwd-wrapper.ps1" %*
exit /b %ERRORLEVEL%
