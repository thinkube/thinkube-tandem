/**
 * Skill - Claude Code reusable capability
 *
 * Skills are markdown files with YAML frontmatter
 * stored in .claude/skills/{skill-name}/SKILL.md
 *
 * Frontmatter fields (all optional except description):
 *   description, allowed-tools, model, user-invocable,
 *   when_to_use, argument-hint, disable-model-invocation,
 *   context, agent, effort, shell, paths, hooks, memory
 */

export interface Skill {
    name: string;
    description: string;
    allowedTools: string[];
    model?: string;               // full model ID or omit to inherit
    content: string;
    filePath: string;
    // Extended frontmatter
    userInvocable?: boolean;
    whenToUse?: string;
    argumentHint?: string;
    disableModelInvocation?: boolean;
    context?: string;
    agent?: string;
    effort?: string;
    shell?: string;
    paths?: string[];
    memory?: boolean;
}

export function createSkill(
    name: string,
    description: string,
    content: string,
    allowedTools: string[] = [],
    model?: string
): Omit<Skill, 'filePath'> {
    return {
        name: normalizeSkillName(name),
        description,
        allowedTools,
        model,
        content
    };
}

export function normalizeSkillName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

export function skillToMarkdown(skill: Skill | Omit<Skill, 'filePath'>): string {
    const lines = ['---', `description: ${skill.description}`];

    if (skill.allowedTools.length > 0) { lines.push(`allowed-tools: ${skill.allowedTools.join(', ')}`); }
    if (skill.model) { lines.push(`model: ${skill.model}`); }
    if (skill.userInvocable !== undefined) { lines.push(`user-invocable: ${skill.userInvocable}`); }
    if (skill.whenToUse) { lines.push(`when_to_use: ${skill.whenToUse}`); }
    if (skill.argumentHint) { lines.push(`argument-hint: ${skill.argumentHint}`); }
    if (skill.disableModelInvocation !== undefined) { lines.push(`disable-model-invocation: ${skill.disableModelInvocation}`); }
    if (skill.context) { lines.push(`context: ${skill.context}`); }
    if (skill.agent) { lines.push(`agent: ${skill.agent}`); }
    if (skill.effort) { lines.push(`effort: ${skill.effort}`); }
    if (skill.shell) { lines.push(`shell: ${skill.shell}`); }
    if (skill.paths && skill.paths.length > 0) { lines.push(`paths: ${skill.paths.join(', ')}`); }
    if (skill.memory !== undefined) { lines.push(`memory: ${skill.memory}`); }

    lines.push('---', '');

    return lines.join('\n') + skill.content;
}

export function parseSkillMarkdown(content: string, filePath: string): Skill | null {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
        return null;
    }

    const [, frontmatter, body] = frontmatterMatch;
    const metadata: Record<string, string> = {};

    frontmatter.split('\n').forEach(line => {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) {
            metadata[match[1].trim()] = match[2].trim();
        }
    });

    const name = metadata['name'] || filePath.split('/').slice(-2, -1)[0] || '';

    // Read allowed-tools with fallback to tools for backward compat
    const toolsStr = metadata['allowed-tools'] || metadata['tools'] || '';
    const allowedTools = toolsStr ? toolsStr.split(',').map(t => t.trim()) : [];

    const parseBool = (v: string | undefined): boolean | undefined => {
        if (v === undefined) return undefined;
        return v === 'true';
    };

    return {
        name,
        description: metadata['description'] || '',
        allowedTools,
        model: metadata['model'] || undefined,
        content: body.trim(),
        filePath,
        userInvocable: parseBool(metadata['user-invocable']),
        whenToUse: metadata['when_to_use'],
        argumentHint: metadata['argument-hint'],
        disableModelInvocation: parseBool(metadata['disable-model-invocation']),
        context: metadata['context'],
        agent: metadata['agent'],
        effort: metadata['effort'],
        shell: metadata['shell'],
        paths: metadata['paths'] ? metadata['paths'].split(',').map(p => p.trim()) : undefined,
        memory: parseBool(metadata['memory'])
    };
}
