/**
 * PluginTemplates - Built-in plugin templates for scaffolding
 *
 * Provides template structures for common plugin types:
 * - empty: Minimal structure
 * - hooks-only: Safety hooks (like block-deployment-edits)
 * - commands-only: Slash commands collection
 * - full-stack: Commands + Hooks + Skills + Agents
 * - analyzer: Project analysis skills
 */

export interface TemplateFile {
    path: string;
    content: string;
}

export interface PluginTemplate {
    name: string;
    description: string;
    icon: string;
    files: TemplateFile[];
    components: {
        commands: boolean;
        hooks: boolean;
        skills: boolean;
        agents: boolean;
        mcpServers: boolean;
    };
}

/**
 * Get placeholder replacements for template files
 */
function replacePlaceholders(content: string, variables: Record<string, string>): string {
    let result = content;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
}

/**
 * Get all available templates
 */
export function getTemplates(): PluginTemplate[] {
    return [
        emptyTemplate,
        hooksOnlyTemplate,
        commandsOnlyTemplate,
        fullStackTemplate,
        analyzerTemplate
    ];
}

/**
 * Get a specific template by name
 */
export function getTemplate(name: string): PluginTemplate | undefined {
    return getTemplates().find(t => t.name === name);
}

/**
 * Generate template files with variable substitution
 */
export function generateTemplateFiles(
    template: PluginTemplate,
    variables: {
        pluginName: string;
        description: string;
        marketplace: string;
    }
): TemplateFile[] {
    return template.files.map(file => ({
        path: replacePlaceholders(file.path, variables),
        content: replacePlaceholders(file.content, variables)
    }));
}

// ========== Template Definitions ==========

const emptyTemplate: PluginTemplate = {
    name: 'empty',
    description: 'Minimal structure, user fills in',
    icon: 'file',
    components: {
        commands: false,
        hooks: false,
        skills: false,
        agents: false,
        mcpServers: false
    },
    files: [
        {
            path: '.claude-plugin/plugin.json',
            content: `{
  "name": "tk-{{pluginName}}",
  "version": "1.0.0",
  "description": "{{description}}"
}
`
        },
        {
            path: 'README.md',
            content: `# tk-{{pluginName}}

{{description}}

## Installation

Add to your project's \`.claude/settings.json\`:

\`\`\`json
{
  "enabledPlugins": {
    "tk-{{pluginName}}@{{marketplace}}": true
  }
}
\`\`\`
`
        }
    ]
};

const hooksOnlyTemplate: PluginTemplate = {
    name: 'hooks-only',
    description: 'Safety hooks (like block-deployment-edits)',
    icon: 'shield',
    components: {
        commands: false,
        hooks: true,
        skills: false,
        agents: false,
        mcpServers: false
    },
    files: [
        {
            path: '.claude-plugin/plugin.json',
            content: `{
  "name": "tk-{{pluginName}}",
  "version": "1.0.0",
  "description": "{{description}}",
  "hooks": "./hooks/hooks.json"
}
`
        },
        {
            path: 'hooks/hooks.json',
            content: `{
  "PreToolUse": [
    {
      "matcher": "Edit|Write",
      "hooks": [
        {
          "type": "command",
          "command": "./scripts/validate.sh"
        }
      ]
    }
  ],
  "PostToolUse": []
}
`
        },
        {
            path: 'scripts/validate.sh',
            content: `#!/bin/bash
# {{description}}
# This hook runs before Edit/Write operations

# Parse the file_path from the tool input JSON
file_path=$(python3 -c "
import json
import sys
try:
    data = json.load(sys.stdin)
    print(data.get('tool_input', {}).get('file_path', ''))
except:
    print('')
")

# Add your validation logic here
# Exit 0 to allow, exit 2 to block

exit 0
`
        },
        {
            path: 'README.md',
            content: `# tk-{{pluginName}}

{{description}}

## Hooks

### PreToolUse

- **Edit|Write**: Runs validation before file edits

## Installation

Add to your project's \`.claude/settings.json\`:

\`\`\`json
{
  "enabledPlugins": {
    "tk-{{pluginName}}@{{marketplace}}": true
  }
}
\`\`\`
`
        }
    ]
};

const commandsOnlyTemplate: PluginTemplate = {
    name: 'commands-only',
    description: 'Slash commands collection',
    icon: 'terminal',
    components: {
        commands: true,
        hooks: false,
        skills: false,
        agents: false,
        mcpServers: false
    },
    files: [
        {
            path: '.claude-plugin/plugin.json',
            content: `{
  "name": "tk-{{pluginName}}",
  "version": "1.0.0",
  "description": "{{description}}",
  "commands": "./commands"
}
`
        },
        {
            path: 'commands/help.md',
            content: `# Help

Show available commands from the {{pluginName}} plugin.

## Instructions

List all available commands in this plugin and their usage.

## Commands

- \`/help\` - Show this help message
- \`/example\` - Example command

## Arguments

- \`$ARGUMENTS\` - Optional: specific command to get help for
`
        },
        {
            path: 'commands/example.md',
            content: `# Example

Example command for {{pluginName}}.

## Instructions

{{description}}

## Arguments

- \`$ARGUMENTS\` - Arguments passed to the command
`
        },
        {
            path: 'README.md',
            content: `# tk-{{pluginName}}

{{description}}

## Commands

| Command | Description |
|---------|-------------|
| \`/help\` | Show available commands |
| \`/example\` | Example command |

## Installation

Add to your project's \`.claude/settings.json\`:

\`\`\`json
{
  "enabledPlugins": {
    "tk-{{pluginName}}@{{marketplace}}": true
  }
}
\`\`\`
`
        }
    ]
};

const fullStackTemplate: PluginTemplate = {
    name: 'full-stack',
    description: 'Commands + Hooks + Skills + Agents',
    icon: 'package',
    components: {
        commands: true,
        hooks: true,
        skills: true,
        agents: true,
        mcpServers: false
    },
    files: [
        {
            path: '.claude-plugin/plugin.json',
            content: `{
  "name": "tk-{{pluginName}}",
  "version": "1.0.0",
  "description": "{{description}}",
  "commands": "./commands",
  "hooks": "./hooks/hooks.json",
  "skills": "./skills",
  "agents": "./agents"
}
`
        },
        {
            path: 'commands/main.md',
            content: `# Main

Main command for {{pluginName}}.

## Instructions

{{description}}

## Arguments

- \`$ARGUMENTS\` - Arguments passed to the command
`
        },
        {
            path: 'hooks/hooks.json',
            content: `{
  "PreToolUse": [],
  "PostToolUse": []
}
`
        },
        {
            path: 'skills/{{pluginName}}-expert/SKILL.md',
            content: `# {{pluginName}} Expert

You are an expert in {{description}}.

## Best Practices

- Add your best practices here

## Common Tasks

1. Task 1
2. Task 2
3. Task 3
`
        },
        {
            path: 'agents/assistant.md',
            content: `# {{pluginName}} Assistant

An agent specialized in {{description}}.

## Role

Help users with {{pluginName}}-related tasks.

## Capabilities

- Analyze project structure
- Suggest improvements
- Guide best practices

## Constraints

- Stay focused on {{pluginName}} domain
- Follow project conventions
`
        },
        {
            path: 'README.md',
            content: `# tk-{{pluginName}}

{{description}}

## Features

### Commands

| Command | Description |
|---------|-------------|
| \`/main\` | Main command |

### Hooks

Configure hooks in \`hooks/hooks.json\`.

### Skills

- **{{pluginName}}-expert**: Domain expertise

### Agents

- **assistant**: Specialized assistant

## Installation

Add to your project's \`.claude/settings.json\`:

\`\`\`json
{
  "enabledPlugins": {
    "tk-{{pluginName}}@{{marketplace}}": true
  }
}
\`\`\`
`
        }
    ]
};

const analyzerTemplate: PluginTemplate = {
    name: 'analyzer',
    description: 'Project analysis skills',
    icon: 'search',
    components: {
        commands: true,
        hooks: false,
        skills: true,
        agents: true,
        mcpServers: false
    },
    files: [
        {
            path: '.claude-plugin/plugin.json',
            content: `{
  "name": "tk-{{pluginName}}",
  "version": "1.0.0",
  "description": "{{description}}",
  "commands": "./commands",
  "skills": "./skills",
  "agents": "./agents"
}
`
        },
        {
            path: 'commands/analyze.md',
            content: `# Analyze

Analyze the project for {{pluginName}} related issues.

## Instructions

Scan the project and provide a report on:
1. Current state
2. Potential issues
3. Recommendations

## Arguments

- \`$ARGUMENTS\` - Optional: specific area to analyze
`
        },
        {
            path: 'commands/report.md',
            content: `# Report

Generate a detailed {{pluginName}} report.

## Instructions

Create a comprehensive report covering:
- Project structure analysis
- Best practice compliance
- Improvement suggestions

## Output Format

The report should be formatted as markdown with sections for each area analyzed.

## Arguments

- \`$ARGUMENTS\` - Optional: report format (markdown, json)
`
        },
        {
            path: 'skills/analyzer/SKILL.md',
            content: `# {{pluginName}} Analyzer

You are an expert at analyzing projects for {{description}}.

## Analysis Approach

1. **Structure Analysis**: Examine project layout and organization
2. **Pattern Detection**: Identify common patterns and anti-patterns
3. **Compliance Check**: Verify adherence to best practices
4. **Recommendations**: Provide actionable improvement suggestions

## Output Format

Always provide analysis in a structured format with:
- Summary
- Findings (categorized by severity)
- Recommendations (prioritized)
`
        },
        {
            path: 'agents/analyzer-agent.md',
            content: `# {{pluginName}} Analyzer Agent

An agent that performs deep analysis for {{description}}.

## Role

Thoroughly analyze projects and provide detailed reports.

## Capabilities

- Deep code analysis
- Pattern recognition
- Best practice validation
- Automated recommendations

## Workflow

1. Scan project structure
2. Analyze relevant files
3. Identify issues and patterns
4. Generate comprehensive report
`
        },
        {
            path: 'README.md',
            content: `# tk-{{pluginName}}

{{description}}

## Features

### Commands

| Command | Description |
|---------|-------------|
| \`/analyze\` | Analyze the project |
| \`/report\` | Generate detailed report |

### Skills

- **analyzer**: Project analysis expertise

### Agents

- **analyzer-agent**: Deep analysis automation

## Installation

Add to your project's \`.claude/settings.json\`:

\`\`\`json
{
  "enabledPlugins": {
    "tk-{{pluginName}}@{{marketplace}}": true
  }
}
\`\`\`
`
        }
    ]
};
