#!/bin/bash
# Phase 2: cwd-patching wrapper.
#
# Portable across macOS (development) and Linux / code-server (production).
#
# The Claude Code extension passes the real binary as $1 and its own
# args as $2..$N (verified via Phase 1 logs). It also sets the child's
# working directory via spawn() options — there is no --addDir, --cwd,
# or CLAUDE_*_DIR env that names the workspace — so a plain `cd` here
# before `exec` is sufficient to override the extension's choice.
#
# Target directory comes from $CLAUDE_CWD_PROXY_DIR/.target-cwd (first
# non-empty line). If the file is missing, empty, or the path doesn't
# exist, we leave cwd alone rather than guessing.

set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PROXY_DIR="${CLAUDE_CWD_PROXY_DIR:-$SELF_DIR}"
TARGET_FILE="$PROXY_DIR/.target-cwd"
PREFIX_FILE="$PROXY_DIR/.target-prefix"
LOG_DIR="$PROXY_DIR/logs"

# Diagnostic logging — captures every wrapper invocation so we can audit how
# the Claude Code extension spawns the CLI (new vs resume, args, env, cwd).
# Off by default — opt in with CLAUDE_CWD_PROXY_LOG=1. When disabled, LOG
# points at /dev/null so the existing `>>"$LOG"` blocks below are no-ops.
INITIAL_CWD="$(pwd)"
if [ "${CLAUDE_CWD_PROXY_LOG:-0}" = "1" ]; then
  mkdir -p "$LOG_DIR" 2>/dev/null
  TS="$(date +%Y%m%d-%H%M%S)-$$"
  LOG="$LOG_DIR/wrapper-$TS.log"
else
  LOG="/dev/null"
fi

if [ "$#" -lt 1 ]; then
  echo "claude-cwd-wrapper.sh: extension passed no binary path as \$1" >&2
  exit 64
fi

REAL_CLAUDE="$1"
shift

if [ ! -x "$REAL_CLAUDE" ]; then
  echo "claude-cwd-wrapper.sh: not executable: $REAL_CLAUDE" >&2
  exit 126
fi

# Tag the invocation so we can grep resume attempts vs fresh spawns quickly.
# Also capture the resume UUID, if any, so we can route cwd to the original
# session's recorded cwd rather than .target-cwd (see RESUME branch below).
INVOKE_TAG="other"
RESUME_UUID=""
prev_arg=""
for a in "$@"; do
  case "$a" in
    --resume|-r|--continue|-c|--session-id|--resume-session-id)
      INVOKE_TAG="RESUME"
      ;;
    --output-format)
      [ "$INVOKE_TAG" = "other" ] && INVOKE_TAG="session"
      ;;
    auth|--version|--help|mcp|config)
      [ "$INVOKE_TAG" = "other" ] && INVOKE_TAG="probe"
      ;;
    --resume=*) RESUME_UUID="${a#--resume=}" ;;
    --resume-session-id=*) RESUME_UUID="${a#--resume-session-id=}" ;;
    --session-id=*) RESUME_UUID="${a#--session-id=}" ;;
  esac
  case "$prev_arg" in
    --resume|-r|--resume-session-id|--session-id) RESUME_UUID="$a" ;;
  esac
  prev_arg="$a"
done

{
  echo "=== claude-cwd-wrapper.sh invocation at $(date) ==="
  echo "  tag:       $INVOKE_TAG"
  echo "  proxy dir: $PROXY_DIR"
  echo "  initial cwd (before any cd): $INITIAL_CWD"
  echo
  echo "--- real binary ---"
  echo "  $REAL_CLAUDE"
  echo
  echo "--- argv to real binary (\$#=$#) ---"
  i=1
  for a in "$@"; do
    printf '  [%d] %q\n' "$i" "$a"
    i=$((i+1))
  done
  echo
  echo "--- .target-cwd ---"
  if [ -r "$TARGET_FILE" ]; then
    echo "  file: $TARGET_FILE"
    echo "  contents (first line): $(sed -n '1p' "$TARGET_FILE")"
  else
    echo "  (file not readable or missing: $TARGET_FILE)"
  fi
  echo
  echo "--- env (interesting) ---"
  env | grep -E '^(CLAUDE|VSCODE_|PWD=|OLDPWD=|CODE_SERVER)' | sort
  echo
} >>"$LOG" 2>&1

# RESUME: cd to the session's *original* cwd (recorded inside the JSONL),
# not .target-cwd. Claude CLI keys session lookup off cwd, so resuming with
# a different cwd produces "No conversation found with session ID …".
# Sidecar files (e.g. ai-title only) don't carry a cwd field, so we pick
# the JSONL that does. .target-cwd is only used as a fallback if we can't
# locate the session.
SESSION_CWD=""
if [ "$INVOKE_TAG" = "RESUME" ] && [ -n "$RESUME_UUID" ]; then
  for f in "$HOME/.claude/projects/"*/"$RESUME_UUID.jsonl"; do
    [ -f "$f" ] || continue
    candidate="$(grep -m1 -o '"cwd":"[^"]*"' "$f" 2>/dev/null | sed 's/^"cwd":"//; s/"$//')"
    if [ -n "$candidate" ]; then
      SESSION_CWD="$candidate"
      echo "--- resume session JSONL ---" >>"$LOG"
      echo "  file: $f" >>"$LOG"
      echo "  cwd:  $SESSION_CWD" >>"$LOG"
      break
    fi
  done
  if [ -z "$SESSION_CWD" ]; then
    echo "--- resume session JSONL: NOT FOUND for uuid $RESUME_UUID ---" >>"$LOG"
  fi
fi

if [ -n "$SESSION_CWD" ] && [ -d "$SESSION_CWD" ]; then
  cd "$SESSION_CWD"
elif [ -r "$TARGET_FILE" ]; then
  TARGET="$(sed -n '1{s/[[:space:]]*$//;p;}' "$TARGET_FILE")"
  if [ -n "$TARGET" ] && [ -d "$TARGET" ]; then
    cd "$TARGET"
  fi
fi

{
  echo "--- cwd after cwd handling ---"
  echo "  $(pwd)"
  echo
} >>"$LOG" 2>&1

# Inject --append-system-prompt with a title-prefix directive, but only
# for interactive session spawns. The extension also spawns subcommand
# probes (e.g. `claude auth status --json`) through this wrapper; those
# don't accept --append-system-prompt and would error. Heuristic: if the
# first arg starts with --, it's a top-level session invocation.
# Skip on RESUME: the original session already has its title prefix, and
# re-appending the directive on every resume would risk drifting it.
FIRST_ARG="${1:-}"
if [ "$INVOKE_TAG" != "RESUME" ] && [ -n "$FIRST_ARG" ] && [ "$FIRST_ARG" != "${FIRST_ARG#--}" ] && [ -r "$PREFIX_FILE" ]; then
  PREFIX="$(sed -n '1{s/[[:space:]]*$//;p;}' "$PREFIX_FILE")"
  if [ -n "$PREFIX" ]; then
    SYS_PROMPT="When summarising this conversation for the tab title, always begin the title with \"$PREFIX \". Treat this as a strict formatting rule that overrides any default summarisation style."
    echo "--- exec branch: prefix-injection (--append-system-prompt added) ---" >>"$LOG"
    exec "$REAL_CLAUDE" --append-system-prompt "$SYS_PROMPT" "$@"
  fi
fi

echo "--- exec branch: plain ---" >>"$LOG"
exec "$REAL_CLAUDE" "$@"
