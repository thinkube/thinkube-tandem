import * as fs from 'fs';
import * as path from 'path';

export interface ProjectInfo {
    type: 'nodejs' | 'python' | 'rust' | 'go' | 'java' | 'unknown';
    name: string;
    tools: DetectedTool[];
    suggestions: ConfigSuggestion[];
}

export interface DetectedTool {
    name: string;
    type: 'linter' | 'formatter' | 'test' | 'build' | 'ci' | 'other';
    configFile?: string;
}

export interface ConfigSuggestion {
    type: 'hook' | 'command' | 'skill' | 'agent' | 'mcp-server';
    name: string;
    description: string;
    reason: string;
    config: HookConfig | CommandConfig | SkillConfig | AgentConfig | McpServerConfig;
}

interface HookConfig {
    event: string;   // any HookEvent
    matcher: string;
    type?: 'command' | 'http' | 'prompt' | 'agent';
    command?: string;
    url?: string;
    prompt?: string;
    agent?: string;
}

interface CommandConfig {
    name: string;
    description: string;
    content: string;
}

interface SkillConfig {
    name: string;
    description: string;
    content: string;
}

interface AgentConfig {
    name: string;
    description: string;
    content: string;
    tools?: string[];
    model?: string;
}

interface McpServerConfig {
    id: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export class ProjectAnalyzer {
    constructor(private basePath: string) {}

    async analyze(): Promise<ProjectInfo> {
        const type = await this.detectProjectType();
        const name = this.detectProjectName();
        const tools = await this.detectTools();
        const suggestions = this.generateSuggestions(type, tools);

        return { type, name, tools, suggestions };
    }

    private async detectProjectType(): Promise<ProjectInfo['type']> {
        const files: string[] = await fs.promises.readdir(this.basePath).catch(() => [] as string[]);

        if (files.includes('package.json')) return 'nodejs';
        if (files.includes('pyproject.toml') || files.includes('setup.py') || files.includes('requirements.txt')) return 'python';
        if (files.includes('Cargo.toml')) return 'rust';
        if (files.includes('go.mod')) return 'go';
        if (files.includes('pom.xml') || files.includes('build.gradle')) return 'java';

        return 'unknown';
    }

    private detectProjectName(): string {
        // Try package.json first
        const packageJsonPath = path.join(this.basePath, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                if (pkg.name) return pkg.name;
            } catch {}
        }

        // Try pyproject.toml
        const pyprojectPath = path.join(this.basePath, 'pyproject.toml');
        if (fs.existsSync(pyprojectPath)) {
            try {
                const content = fs.readFileSync(pyprojectPath, 'utf8');
                const match = content.match(/name\s*=\s*["'](.+?)["']/);
                if (match) return match[1];
            } catch {}
        }

        // Fall back to directory name
        return path.basename(this.basePath);
    }

    private async detectTools(): Promise<DetectedTool[]> {
        const tools: DetectedTool[] = [];
        const files: string[] = await fs.promises.readdir(this.basePath).catch(() => [] as string[]);

        // ESLint
        if (files.some(f => f.startsWith('.eslint') || f === 'eslint.config.js' || f === 'eslint.config.mjs')) {
            tools.push({ name: 'ESLint', type: 'linter', configFile: '.eslintrc' });
        }

        // Prettier
        if (files.some(f => f.startsWith('.prettier') || f === 'prettier.config.js')) {
            tools.push({ name: 'Prettier', type: 'formatter', configFile: '.prettierrc' });
        }

        // TypeScript
        if (files.includes('tsconfig.json')) {
            tools.push({ name: 'TypeScript', type: 'build', configFile: 'tsconfig.json' });
        }

        // Jest
        if (files.includes('jest.config.js') || files.includes('jest.config.ts')) {
            tools.push({ name: 'Jest', type: 'test', configFile: 'jest.config.js' });
        }

        // Vitest
        if (files.includes('vitest.config.ts') || files.includes('vitest.config.js')) {
            tools.push({ name: 'Vitest', type: 'test', configFile: 'vitest.config.ts' });
        }

        // Pytest (Python)
        if (files.includes('pytest.ini') || files.includes('conftest.py')) {
            tools.push({ name: 'pytest', type: 'test', configFile: 'pytest.ini' });
        }

        // Ruff (Python linter/formatter)
        if (files.includes('ruff.toml') || files.some(f => f === 'pyproject.toml')) {
            const pyprojectPath = path.join(this.basePath, 'pyproject.toml');
            if (fs.existsSync(pyprojectPath)) {
                const content = fs.readFileSync(pyprojectPath, 'utf8');
                if (content.includes('[tool.ruff]')) {
                    tools.push({ name: 'Ruff', type: 'linter', configFile: 'pyproject.toml' });
                }
            }
        }

        // Black (Python formatter)
        if (files.includes('pyproject.toml')) {
            try {
                const content = fs.readFileSync(path.join(this.basePath, 'pyproject.toml'), 'utf8');
                if (content.includes('[tool.black]')) {
                    tools.push({ name: 'Black', type: 'formatter', configFile: 'pyproject.toml' });
                }
            } catch {}
        }

        // Docker
        if (files.includes('Dockerfile') || files.includes('docker-compose.yml') || files.includes('docker-compose.yaml')) {
            tools.push({ name: 'Docker', type: 'build', configFile: 'Dockerfile' });
        }

        // GitHub Actions
        const githubDir = path.join(this.basePath, '.github', 'workflows');
        if (fs.existsSync(githubDir)) {
            tools.push({ name: 'GitHub Actions', type: 'ci', configFile: '.github/workflows' });
        }

        // Husky (git hooks)
        if (files.includes('.husky') || (files.includes('package.json') && this.packageHasHusky())) {
            tools.push({ name: 'Husky', type: 'other', configFile: '.husky' });
        }

        return tools;
    }

    private packageHasHusky(): boolean {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(this.basePath, 'package.json'), 'utf8'));
            return !!(pkg.devDependencies?.husky || pkg.dependencies?.husky);
        } catch {
            return false;
        }
    }

    private generateSuggestions(type: ProjectInfo['type'], tools: DetectedTool[]): ConfigSuggestion[] {
        const suggestions: ConfigSuggestion[] = [];
        const toolNames = tools.map(t => t.name);

        // Linting hooks
        if (toolNames.includes('ESLint')) {
            suggestions.push({
                type: 'hook',
                name: 'ESLint Check',
                description: 'Run ESLint after Claude edits files',
                reason: 'ESLint detected in project',
                config: {
                    event: 'PostToolUse',
                    matcher: 'Edit',
                    command: 'npx eslint --fix "$CLAUDE_FILE_PATH"'
                } as HookConfig
            });
        }

        if (toolNames.includes('Ruff')) {
            suggestions.push({
                type: 'hook',
                name: 'Ruff Check',
                description: 'Run Ruff linter after Claude edits Python files',
                reason: 'Ruff detected in project',
                config: {
                    event: 'PostToolUse',
                    matcher: 'Edit',
                    command: 'ruff check --fix "$CLAUDE_FILE_PATH"'
                } as HookConfig
            });
        }

        // Formatting hooks
        if (toolNames.includes('Prettier')) {
            suggestions.push({
                type: 'hook',
                name: 'Prettier Format',
                description: 'Auto-format files after Claude edits',
                reason: 'Prettier detected in project',
                config: {
                    event: 'PostToolUse',
                    matcher: 'Edit',
                    command: 'npx prettier --write "$CLAUDE_FILE_PATH"'
                } as HookConfig
            });
        }

        if (toolNames.includes('Black')) {
            suggestions.push({
                type: 'hook',
                name: 'Black Format',
                description: 'Auto-format Python files after Claude edits',
                reason: 'Black detected in project',
                config: {
                    event: 'PostToolUse',
                    matcher: 'Edit',
                    command: 'black "$CLAUDE_FILE_PATH"'
                } as HookConfig
            });
        }

        // Test commands
        if (toolNames.includes('Jest') || toolNames.includes('Vitest')) {
            const testCmd = toolNames.includes('Vitest') ? 'npx vitest run' : 'npx jest';
            suggestions.push({
                type: 'command',
                name: 'run-tests',
                description: 'Run the test suite',
                reason: `${toolNames.includes('Vitest') ? 'Vitest' : 'Jest'} detected in project`,
                config: {
                    name: 'run-tests',
                    description: 'Run the project test suite and report results',
                    content: `Run the tests for this project using \`${testCmd}\`.\n\nAnalyze any failures and suggest fixes.`
                } as CommandConfig
            });
        }

        if (toolNames.includes('pytest')) {
            suggestions.push({
                type: 'command',
                name: 'run-tests',
                description: 'Run pytest test suite',
                reason: 'pytest detected in project',
                config: {
                    name: 'run-tests',
                    description: 'Run the pytest test suite and report results',
                    content: 'Run the tests using `pytest -v`.\n\nAnalyze any failures and suggest fixes.'
                } as CommandConfig
            });
        }

        // TypeScript type checking
        if (toolNames.includes('TypeScript')) {
            suggestions.push({
                type: 'command',
                name: 'type-check',
                description: 'Check TypeScript types',
                reason: 'TypeScript detected in project',
                config: {
                    name: 'type-check',
                    description: 'Run TypeScript compiler to check for type errors',
                    content: 'Run `npx tsc --noEmit` and fix any type errors found.'
                } as CommandConfig
            });
        }

        // Code review subagent (NOT a skill - needs isolated context for thorough analysis)
        suggestions.push({
            type: 'agent',
            name: 'code-reviewer',
            description: 'Review code for issues and improvements',
            reason: 'Delegated code review with isolated context',
            config: {
                name: 'code-reviewer',
                description: 'Expert code review. Use PROACTIVELY after significant code changes.',
                tools: ['Read', 'Grep', 'Glob'],
                model: 'inherit',
                content: `You are a senior code reviewer ensuring high standards of code quality.

## Review Checklist

1. **Correctness**:
   - Potential bugs and edge cases
   - Logic errors
   - Error handling

2. **Security**:
   - Input validation
   - Authentication/authorization
   - Common vulnerabilities (XSS, SQL injection, etc.)

3. **Performance**:
   - Inefficient algorithms
   - Memory leaks
   - Unnecessary computations

4. **Maintainability**:
   - Code clarity and readability
   - Documentation
   - Test coverage
   - Best practices for ${type === 'unknown' ? 'the language being used' : type}

## Output Format

Provide structured feedback with:
- Severity (Critical/Major/Minor)
- Location (file:line)
- Issue description
- Suggested fix with code example
- Explanation of "why"

Be constructive and focus on learning.`
            } as AgentConfig
        });

        // MCP servers based on project
        if (toolNames.includes('GitHub Actions')) {
            suggestions.push({
                type: 'mcp-server',
                name: 'GitHub MCP',
                description: 'Interact with GitHub issues, PRs, and actions',
                reason: 'GitHub Actions detected in project',
                config: {
                    id: 'github',
                    command: 'npx',
                    args: ['-y', '@modelcontextprotocol/server-github'],
                    env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' }
                } as McpServerConfig
            });
        }

        // Docker commands
        if (toolNames.includes('Docker')) {
            suggestions.push({
                type: 'command',
                name: 'docker-build',
                description: 'Build and test Docker image',
                reason: 'Docker detected in project',
                config: {
                    name: 'docker-build',
                    description: 'Build the Docker image and run basic tests',
                    content: 'Build the Docker image with `docker build -t $PROJECT_NAME .` and verify it runs correctly.'
                } as CommandConfig
            });
        }

        return suggestions;
    }
}
