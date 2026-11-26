import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TandemShown, TandemView } from '../types'

// The record of a module is kept by Tandem, not by the session that does the
// work. These hooks are run by the engine: they tell the record's command
// what entered the session and when a turn ended, and draw what it answers.
// The command is the extension's own code; nothing is decided here.

const PANE = 'tandem'
const TITLE = 'Tandem'
const SHOWN_CHARS = 220
// The engine masks credentials in texts up to this length.
const MASKED_CHARS = 100_000

const shown = atom({ plugin: 'tandem', key: 'shown' } as const, {
  view: null,
  problem: null,
} as TandemShown)

type Answer =
  | { ok: true; view?: TandemView; filed?: boolean; commits?: number; note?: string }
  | { ok: false; reason: string }

// Runs the record's command of the installed extension, the same path the
// plugin's MCP server is started from.
async function record(
  $: EngineInterface,
  command: string,
  input: Record<string, unknown>,
): Promise<Answer> {
  const home = await $.env.get('HOME')
  if (!home) return { ok: false, reason: 'HOME is not set, so the Tandem extension cannot be found.' }
  const cli = `${home}/.local/share/code-server/User/globalStorage/thinkube.thinkube-tandem/extension-current/out/record/cli.js`
  const stdin = JSON.stringify({
    session: await $.session.id(),
    cwd: await $.session.cwd(),
    ...input,
  })
  try {
    const ran = await $.process.run(['node', cli, command], { stdin })
    if (ran.exitCode !== 0)
      return {
        ok: false,
        reason: ran.stderr.trim() || `The record's command ended with code ${ran.exitCode}.`,
      }
    return JSON.parse(ran.stdout) as Answer
  } catch (err) {
    return { ok: false, reason: `The record's command did not run: ${String(err)}` }
  }
}

// Keeps what the record answered for the pane: a new view when it gave one,
// and what it could not do when it failed.
async function keep($: EngineInterface, answer: Answer): Promise<void> {
  await update($, shown, was =>
    answer.ok
      ? { view: answer.view ?? was.view, problem: answer.note ?? null }
      : { view: was.view, problem: answer.reason },
  )
}

function cut(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > SHOWN_CHARS ? `${line.slice(0, SHOWN_CHARS)}…` : line
}

// The view as Markdown: what the pane draws, and what the command answers
// on a surface that draws no pane.
function page({ view, problem }: TandemShown): string {
  const lines: string[] = []
  if (problem) lines.push(`**Problem:** ${problem}`, '')
  if (!view) return [...lines, 'The record has not answered yet.'].join('\n')
  if (view.note) lines.push(view.note, '')
  if (!view.module) {
    lines.push('This session owns no module. What you type here is not kept.')
    if (view.here.length === 0)
      lines.push('', 'There is no git repository at or under the folder of this session.')
    return lines.join('\n')
  }

  const { label, product, repo, prefix } = view.module
  lines.push(`**${label}**${product ? ` · ${product}` : ''}`)
  lines.push(`\`${repo}${prefix ? `/${prefix}` : ''}\` · this session is the owner`, '')
  lines.push('**Said to this session**', '')
  if (view.sentences.length === 0) lines.push('Nothing yet.')
  view.sentences.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.by === 'session' ? '*(from another session)* ' : ''}${cut(s.text)}`)
    for (const c of s.commits) lines.push(`   - \`${c.sha.slice(0, 7)}\` ${c.subject}`)
  })
  if (view.loose.length > 0) {
    lines.push('', '**Commits with no sentence**', '')
    for (const c of view.loose) lines.push(`- \`${c.sha.slice(0, 7)}\` ${c.subject}`)
  }
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tandem',
      description: 'Show the module this session owns. Also: /tandem own <folder>, /tandem leave',
    })
    const answer = await record($, 'view', {})
    await keep($, answer)
    // Unasked, the pane opens only for a session that already owns a module.
    if (answer.ok && answer.view?.module) void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'tandem' }, async ($, e) => {
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    if (word !== '' && word !== 'own' && word !== 'leave')
      return { text: 'Use /tandem, /tandem own <folder> or /tandem leave.' }

    const answer =
      word === 'own'
        ? await record($, 'own', rest.length > 0 ? { dir: rest.join(' ') } : {})
        : await record($, word === 'leave' ? 'leave' : 'view', {})
    await keep($, answer)
    const opened = await $.ui.open({ id: PANE, title: TITLE })

    // A surface that draws the pane shows the page there.
    return { text: opened.isPlaced ? 'The Tandem pane is open.' : page(await read($, shown)) }
  })

  // A prompt is filed after it entered, so one that was refused is not kept.
  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    if (entered.drop !== undefined || e.command) return entered

    const whole = e.text.length <= MASKED_CHARS
    let text: string
    try {
      text = await $.session.redact(whole ? e.text : e.text.slice(0, MASKED_CHARS))
    } catch (err) {
      // The store is pushed to a remote: a prompt that could not be masked
      // is not written there, and the pane says that it is missing.
      await keep($, {
        ok: false,
        reason: `A prompt was not kept: its credentials could not be masked (${String(err)}).`,
      })
      return entered
    }
    const answer = await record($, 'said', {
      text: whole ? text : `${text}\n[cut here: the prompt had ${e.text.length} characters]`,
      origin: e.origin.kind,
      surface: await $.session.surface(),
    })
    if (!answer.ok || answer.view) await keep($, answer)

    return entered
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // Only a turn of the main conversation: an agent's turn ends inside one.
    if (e.agentId === undefined) {
      const answer = await record($, 'turn', {})
      if (!answer.ok || answer.view) await keep($, answer)
    }

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const now = await read($, shown)
    const act = async (command: string, input: Record<string, unknown>) =>
      keep($, await record($, command, input))

    return (
      <Box flexDirection="column">
        <Markdown text={page(now)} />
        <Text> </Text>
        {now.view && !now.view.module && (
          <Box flexDirection="column">
            {now.view.here.map(place => (
              <Box key={place.dir}>
                <Button
                  key={`own:${place.dir}`}
                  label={`Own ${place.label}`}
                  onPress={() => act('own', { dir: place.dir })}
                />
                <Text dimColor>
                  {' '}
                  {place.repo}
                  {place.prefix ? `/${place.prefix}` : ''}
                  {place.owner === 'other' ? ' · another session owns it' : ''}
                </Text>
              </Box>
            ))}
          </Box>
        )}
        <Box>
          <Button key="refresh" label="Refresh" onPress={() => act('view', {})} />
          {now.view?.module && (
            <Button key="leave" label="Leave this module" onPress={() => act('leave', {})} />
          )}
        </Box>
      </Box>
    )
  })
}
