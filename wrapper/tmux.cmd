@echo off
rem Fake `tmux` launcher for Claude Code agent teams (SP-tgnb5o), Windows.
rem Forwards argv to the Node shim client, which talks to the Extension Host.
node "%~dp0tmux-shim.js" %*
