/**
 * ClaudeAnalyzer - Uses Agent SDK to invoke Claude for intelligent project analysis
 *
 * This replaces the dumb file-detection logic with actual AI-powered analysis
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
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
     * Analyze a project using Claude and return intelligent configuration suggestions
     */
    async analyzeProject(projectPath: string): Promise<ClaudeAnalysisResult> {
        // Build the prompt for Claude
        const prompt = this.buildAnalysisPrompt(projectPath);

        // Invoke Claude via Agent SDK
        // This automatically uses the same API key as Claude Code (from user settings)
        const queryResult = query({
            prompt,
            options: {
                model: 'claude-sonnet-4-5-20250929',
                cwd: projectPath, // Set working directory to project
                settingSources: ['user', 'project'], // Load API key from user settings, .claude config from project
                allowedTools: ['Read', 'Grep', 'Glob'], // Limit to read-only tools
            }
        });

        // Collect all messages from the stream
        let finalResponse = '';
        let messageCount = 0;
        try {
            for await (const message of queryResult) {
                messageCount++;
                console.log('[ClaudeAnalyzer] Received message:', JSON.stringify(message).substring(0, 500));

                // Extract text content from assistant messages
                if (message.type === 'assistant') {
                    const msg = (message as any).message;
                    if (msg && msg.content && Array.isArray(msg.content)) {
                        for (const block of msg.content) {
                            if (block.type === 'text' && block.text) {
                                console.log('[ClaudeAnalyzer] Extracted text:', block.text.substring(0, 200));
                                finalResponse += block.text + '\n';
                            }
                        }
                    }
                }
            }
            console.log('[ClaudeAnalyzer] Total messages received:', messageCount);
            console.log('[ClaudeAnalyzer] Final response length:', finalResponse.length);
        } catch (error) {
            console.error('[ClaudeAnalyzer] Error during query:', error);
            throw error;
        }

        // Parse Claude's response
        return this.parseResponse(finalResponse, projectPath);
    }

    /**
     * Build the analysis prompt for Claude
     */
    private buildAnalysisPrompt(projectPath: string): string {
        const projectName = path.basename(projectPath);

        return `Analyze the project at "${projectPath}" and suggest appropriate Claude Code configurations.

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
        // For hook: { event, matcher, command }
        // For command: { name, description, content }
        // For skill: { name, description, content }
        // For agent: { name, description, content, tools, model }
        // For mcp-server: { id, command, args, env }
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
        } catch (error) {
            console.error('Failed to parse Claude response:', error);
            console.error('Response was:', response);

            // Return empty result on parse error
            return {
                projectType: 'unknown',
                projectName: path.basename(projectPath),
                summary: 'Failed to parse analysis',
                suggestions: []
            };
        }
    }
}
