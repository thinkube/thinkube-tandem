# Windows wrapper — PowerShell parity with claude-cwd-wrapper.sh.
#
# Invoked via claude-cwd-wrapper.cmd, which is what gets registered in
# `claudeCode.claudeProcessWrapper`. The Claude Code extension passes the
# real claude binary as the first positional argument and its own args
# as the rest. We:
#   - cd to a target directory
#   - on --resume, re-derive the target from the original session's
#     recorded cwd in ~/.claude/projects/*/<uuid>.jsonl
#   - on a fresh interactive session spawn, prepend --append-system-prompt
#     with a title-prefix directive
# Logging is off by default; opt in with CLAUDE_CWD_PROXY_LOG=1.

$ErrorActionPreference = 'Stop'

$selfDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$proxyDir  = if ($env:CLAUDE_CWD_PROXY_DIR) { $env:CLAUDE_CWD_PROXY_DIR } else { $selfDir }
$targetFile = Join-Path $proxyDir '.target-cwd'
$prefixFile = Join-Path $proxyDir '.target-prefix'
$logDir     = Join-Path $proxyDir 'logs'
$initialCwd = (Get-Location).Path

$logEnabled = ($env:CLAUDE_CWD_PROXY_LOG -eq '1')
$logPath = $null
if ($logEnabled) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $ts = (Get-Date -Format 'yyyyMMdd-HHmmss')
    $logPath = Join-Path $logDir "wrapper-$ts-$PID.log"
}

function Write-Log([string]$line) {
    if ($logEnabled) { Add-Content -LiteralPath $logPath -Value $line }
}

if ($args.Count -lt 1) {
    [Console]::Error.WriteLine("claude-cwd-wrapper.ps1: extension passed no binary path as `$1")
    exit 64
}

$realClaude = $args[0]
$rest = if ($args.Count -gt 1) { @($args[1..($args.Count - 1)]) } else { @() }

if (-not (Test-Path -LiteralPath $realClaude -PathType Leaf)) {
    [Console]::Error.WriteLine("claude-cwd-wrapper.ps1: not found / not a file: $realClaude")
    exit 126
}

# Tag invocation + capture resume UUID, mirroring the .sh wrapper.
$invokeTag = 'other'
$resumeUuid = ''
$prevArg = ''
foreach ($a in $rest) {
    switch -Regex ($a) {
        '^(--resume|-r|--continue|-c|--session-id|--resume-session-id)$' { $invokeTag = 'RESUME' }
        '^--output-format$' { if ($invokeTag -eq 'other') { $invokeTag = 'session' } }
        '^(auth|--version|--help|mcp|config)$' { if ($invokeTag -eq 'other') { $invokeTag = 'probe' } }
        '^--resume=(.+)$'             { $resumeUuid = $matches[1] }
        '^--resume-session-id=(.+)$'  { $resumeUuid = $matches[1] }
        '^--session-id=(.+)$'         { $resumeUuid = $matches[1] }
    }
    if ($prevArg -in @('--resume', '-r', '--resume-session-id', '--session-id')) {
        $resumeUuid = $a
    }
    $prevArg = $a
}

Write-Log "=== claude-cwd-wrapper.ps1 invocation at $(Get-Date) ==="
Write-Log "  tag:       $invokeTag"
Write-Log "  proxy dir: $proxyDir"
Write-Log "  initial cwd (before any cd): $initialCwd"
Write-Log ""
Write-Log "--- real binary ---"
Write-Log "  $realClaude"
Write-Log ""
Write-Log "--- argv to real binary (count=$($rest.Count)) ---"
for ($i = 0; $i -lt $rest.Count; $i++) {
    Write-Log ("  [{0}] {1}" -f ($i + 1), $rest[$i])
}
Write-Log ""
Write-Log "--- .target-cwd ---"
if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
    Write-Log "  file: $targetFile"
    $firstLine = (Get-Content -LiteralPath $targetFile -TotalCount 1)
    Write-Log "  contents (first line): $firstLine"
} else {
    Write-Log "  (file not readable or missing: $targetFile)"
}
Write-Log ""

# RESUME: cd to the session's *original* cwd (recorded inside the JSONL),
# not .target-cwd. Claude CLI keys session lookup off cwd, so resuming with
# a different cwd produces "No conversation found with session ID …".
$sessionCwd = ''
if ($invokeTag -eq 'RESUME' -and $resumeUuid) {
    $projectsRoot = Join-Path $env:USERPROFILE '.claude\projects'
    if (Test-Path -LiteralPath $projectsRoot -PathType Container) {
        $match = Get-ChildItem -LiteralPath $projectsRoot -Recurse -Filter "$resumeUuid.jsonl" -ErrorAction SilentlyContinue |
                 Select-Object -First 1
        if ($match) {
            # Read just enough of the JSONL to find a line containing "cwd".
            $cwdLine = Select-String -LiteralPath $match.FullName -Pattern '"cwd":"' -SimpleMatch -List -ErrorAction SilentlyContinue
            if ($cwdLine) {
                if ($cwdLine.Line -match '"cwd":"([^"]*)"') {
                    $sessionCwd = $matches[1]
                    Write-Log "--- resume session JSONL ---"
                    Write-Log "  file: $($match.FullName)"
                    Write-Log "  cwd:  $sessionCwd"
                }
            }
        }
    }
    if (-not $sessionCwd) {
        Write-Log "--- resume session JSONL: NOT FOUND for uuid $resumeUuid ---"
    }
}

if ($sessionCwd -and (Test-Path -LiteralPath $sessionCwd -PathType Container)) {
    Set-Location -LiteralPath $sessionCwd
} elseif (Test-Path -LiteralPath $targetFile -PathType Leaf) {
    $target = (Get-Content -LiteralPath $targetFile -TotalCount 1).Trim()
    if ($target -and (Test-Path -LiteralPath $target -PathType Container)) {
        Set-Location -LiteralPath $target
    }
}

Write-Log "--- cwd after cwd handling ---"
Write-Log "  $((Get-Location).Path)"
Write-Log ""

# Prefix injection for fresh interactive sessions only (skip on RESUME and
# on subcommand probes whose first arg is not a flag).
$firstArg = if ($rest.Count -gt 0) { [string]$rest[0] } else { '' }
$injected = $false
if ($invokeTag -ne 'RESUME' -and $firstArg.StartsWith('--') -and (Test-Path -LiteralPath $prefixFile -PathType Leaf)) {
    $prefix = (Get-Content -LiteralPath $prefixFile -TotalCount 1).Trim()
    if ($prefix) {
        $sysPrompt = "When summarising this conversation for the tab title, always begin the title with `"$prefix `". Treat this as a strict formatting rule that overrides any default summarisation style."
        $finalArgs = @('--append-system-prompt', $sysPrompt) + $rest
        Write-Log "--- exec branch: prefix-injection (--append-system-prompt added) ---"
        & $realClaude @finalArgs
        exit $LASTEXITCODE
    }
}

Write-Log "--- exec branch: plain ---"
& $realClaude @rest
exit $LASTEXITCODE
