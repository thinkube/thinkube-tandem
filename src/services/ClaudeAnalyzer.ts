/**
 * ClaudeAnalyzer - Uses Claude CLI (`claude --print`) for intelligent project analysis
 *
 * Replaces the Agent SDK with a direct CLI invocation.
 */

import { spawn } from 'child_process';
import type { ConfigSuggestion } from './ProjectAnalyzer';
import * as path from 'path';

export interface ClaudeAnalysisResult {
    projectType: string;
    projectName: string;
    summary: string;
    suggestions: ConfigSuggestion[];
}

export class ClaudeAnalyzer {
    /**
     * Analyze a project using Claude CLI and return intelligent configuration suggestions.
     * Passes the user's actual message into the prompt so Claude answers the real question.
     */
    async analyzeProject(projectPath: string, userMessage?: string): Promise<ClaudeAnalysisResult> {
        const prompt = this.buildAnalysisPrompt(projectPath, userMessage);

        const output = await this.runClaudeCli(prompt, projectPath);

        return this.parseResponse(output, projectPath);
    }

    /**
     * Check if `claude` CLI is available.
     */
    static async isAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const proc = spawn('claude', ['--version'], { timeout: 5000 });
            proc.on('error', () => resolve(false));
            proc.on('close', (code) => resolve(code === 0));
        });
    }

    /**
     * Run `claude --print` and collect JSON output.
     */
    private runClaudeCli(prompt: string, cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const args = [
                '--print',
                '--output-format', 'json',
                '--max-turns', '3',
                '--allowedTools', 'Read,Grep,Glob',
                '-p', prompt
            ];

            const proc = spawn('claude', args, {
                cwd,
                timeout: 60000,
                env: { ...process.env }
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
            proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

            proc.on('error', (err) => {
                reject(new Error(`Claude CLI not found. Install Claude Code CLI to use analysis features. (${err.message})`));
            });

            proc.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
                    return;
                }

                // Extract the result text from the JSON output
                try {
                    const parsed = JSON.parse(stdout);
                    // claude --print --output-format json returns { result: "...", ... }
                    resolve(parsed.result || stdout);
                } catch {
                    // If not JSON, use raw output
                    resolve(stdout);
                }
            });
        });
    }

    /**
     * Build the analysis prompt for Claude
     */
    private buildAnalysisPrompt(projectPath: string, userMessage?: string): string {
        const projectName = path.basename(projectPath);

        const userPart = userMessage
            ? `\n\nThe user asked: "${userMessage}"\nIncorporate their question into your analysis and answer it directly.\n`
            : '';

        return `Analyze the project at "${projectPath}" and suggest appropriate Claude Code configurations.${userPart}

Your task:
1. Examine the project structure, dependencies, and tooling
2. Suggest appropriate Claude Code configurations:
   - **Hooks**: For automated validation/formatting after Claude edits (e.g., linters, formatters)
   - **Commands**: For user-invoked workflows (e.g., run-tests, type-check, docker-build)
   - **Skills**: For passive knowledge/documentation (e.g., API schemas, architecture docs)
   - **Subagents**: For complex delegated tasks with isolated context (e.g., code-reviewer, debugger)
   - **MCP Servers**: For external integrations (e.g., GitHub, databases)

Return your response as JSON in this exact format:
\`\`\`json
{
  "projectType": "nodejs|python|rust|go|java|unknown",
  "projectName": "${projectName}",
  "summary": "Brief description of the project and detected tools",
  "suggestions": [
    {
      "type": "hook|command|skill|agent|mcp-server",
      "name": "suggestion-name",
      "description": "What it does",
      "reason": "Why this is recommended",
      "config": {
        // Type-specific configuration
        // For hook: { event, matcher, type, command }
        // For command: { name, description, content }
        // For skill: { name, description, content }
        // For agent: { name, description, content, tools, model }
        // For mcp-server: { id, type, command, args } or { id, type: "http", url }
      }
    }
  ]
}
\`\`\`

Be intelligent about categorization:
- Don't suggest subagents for everything - most things are hooks/commands
- code-reviewer SHOULD be a subagent (needs isolated context)
- API docs SHOULD be a skill (passive knowledge)
- Linters/formatters SHOULD be hooks (automatic after edits)

Analyze now:`;
    }

    /**
     * Parse Claude's JSON response into structured result
     */
    private parseResponse(response: string, projectPath: string): ClaudeAnalysisResult {
        // Extract JSON from markdown code block if present
        const jsonMatch = response.match(/```json\s*\n([\s\S]*?)\n```/);
        const jsonStr = jsonMatch ? jsonMatch[1] : response;

        try {
            const parsed = JSON.parse(jsonStr);
            return {
                projectType: parsed.projectType || 'unknown',
                projectName: parsed.projectName || path.basename(projectPath),
                summary: parsed.summary || 'No summary provided',
                suggestions: parsed.suggestions || []
            };
        } catch {
            // Return the raw text as summary if not parseable as JSON
            return {
                projectType: 'unknown',
                projectName: path.basename(projectPath),
                summary: response || 'Failed to parse analysis',
                suggestions: []
            };
        }
    }
}
