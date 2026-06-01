---
name: claude-code-concepts
description: Deep knowledge of Claude Code configuration types and when to use each
tools: Read
model: inherit
---

# Claude Code Configuration Concepts

## Hooks

**Purpose**: Automated actions triggered by Claude's tool use
**Location**: `.claude/settings.json` under `hooks.PreToolUse` or `hooks.PostToolUse`
**Invocation**: Automatic when tool matchers match

**Structure**:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "npx eslint --fix \"$CLAUDE_FILE_PATH\"",
            "timeout": 30000
          }
        ]
      }
    ]
  }
}
```

**Best for**: Linting, formatting, validation after Claude edits files

## Commands

**Purpose**: User-invoked shortcuts (slash commands)
**Location**: `.claude/commands/*.md` - one file per command
**Invocation**: User types `/command-name` in chat

**Structure**:

```markdown
---
name: run-tests
description: Run project tests and analyze failures
---

Run the test suite using the appropriate test runner.
Analyze any failures and suggest fixes.
```

**Best for**: Common workflows, testing, building, deploying

## Skills

**Purpose**: Contextual expertise that auto-loads
**Location**: `.claude/skills/skill-name/SKILL.md`
**Invocation**: Automatic based on context/project

**Structure**:

```markdown
---
name: api-reference
description: REST API endpoint documentation
---

# API Endpoints

## POST /api/users

Creates a new user...
```

**Best for**: Documentation, schemas, architecture knowledge, domain expertise

**CRITICAL**: Skills are NOT separate agents - they're knowledge files that enhance Claude's understanding

## Subagents

**Purpose**: Delegated tasks with isolated context
**Location**: `.claude/agents/*.md`
**Invocation**: Task tool (explicit or proactive)

**Structure**:

```markdown
---
name: code-reviewer
description: Expert code review. Use PROACTIVELY after code changes.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer ensuring high standards...
```

**Best for**: Complex analysis tasks that benefit from fresh context (code review, debugging, security audits)

**CRITICAL**: Subagents run in SEPARATE context windows - only use when isolation is valuable

## MCP Servers

**Purpose**: External tool/API integration
**Location**: `.claude/settings.json` under `mcpServers`
**Invocation**: Claude uses MCP tools automatically

**Structure**:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**Best for**: GitHub, databases, cloud APIs, custom business logic

## Permissions

**Purpose**: Control what Claude can do
**Location**: `.claude/settings.json` under `permissions`

**Structure**:

```json
{
  "permissions": {
    "allow": ["Bash(npm install:*)", "Bash(git add:*)"],
    "deny": ["Bash(rm -rf:*)"],
    "ask": ["Bash(git push:*)"]
  }
}
```

## Decision Matrix

| Need                      | Use                |
| ------------------------- | ------------------ |
| Auto-format after edits   | Hook (PostToolUse) |
| User workflow shortcut    | Command            |
| Project documentation     | Skill              |
| Isolated specialized task | Subagent           |
| External API access       | MCP Server         |
| Security control          | Permission         |

## Common Mistakes

❌ Making code-reviewer a Skill (it's a Subagent - needs isolation)
❌ Making API docs a Subagent (it's a Skill - just knowledge)
❌ Using Commands for automation (use Hooks instead)
❌ Creating Subagents for everything (most things are Hooks/Commands/Skills)
