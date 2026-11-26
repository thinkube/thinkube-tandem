import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TandemShown, TandemView } from '../types'

// The record of a module is kept by Tandem, not by the session that does the
// work. These hooks are run by the engine: they tell the record's command
// what entered the session, what it sent and when a turn ended, carry a
// request between two owner sessions, and draw what the command answers.
// The command is the extension's own code; nothing is decided here.
//
// Two engines load this file on one machine, the editor's and the older
// command line's, so it keeps to what both know: a tool is served at
// tool.call.

const PANE = 'tandem'
// The plugin's skill already answers to /tandem, so the command is /module.
const TITLE = 'Tandem'
const SHOWN_CHARS = 220
// The engine masks credentials in texts up to this length.
const MASKED_CHARS = 100_000

const shown = atom({ plugin: 'tandem', key: 'shown' } as const, {
  view: null,
  problem: null,
} as TandemShown)

type Answer =
  | {
      ok: true
      view?: TandemView
      filed?: boolean
      commits?: number
      note?: string
      request?: string
      send?: { session: string; text: string }
    }
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
// and what it could not do when it failed. A failure is also a line of the
// transcript, so it is seen where no pane is drawn.
async function keep($: EngineInterface, answer: Answer): Promise<void> {
  if (!answer.ok) $.ui.log(`Tandem: ${answer.reason}`)
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
    const from = s.request
      ? `*(request ${s.request})* `
      : s.by === 'session'
        ? '*(from another session)* '
        : ''
    lines.push(`${i + 1}. ${from}${cut(s.text)}`)
    for (const c of s.commits) lines.push(`   - \`${c.sha.slice(0, 7)}\` ${c.subject}`)
  })
  if (view.loose.length > 0) {
    lines.push('', '**Commits with no sentence**', '')
    for (const c of view.loose) lines.push(`- \`${c.sha.slice(0, 7)}\` ${c.subject}`)
  }
  if (view.requests.length > 0) {
    lines.push('', '**Requests between modules**', '')
    for (const r of view.requests) {
      const who = r.direction === 'asked' ? `to ${r.module}` : `from ${r.module}`
      lines.push(`- \`${r.id}\` ${who} · ${r.state}: ${cut(r.text)}`)
      if (r.answer) lines.push(`   - answer: ${cut(r.answer)}`)
    }
  }
  if (view.sent.length > 0) {
    lines.push('', '**Sent to other sessions**', '')
    for (const m of view.sent) lines.push(`- to ${m.to}: ${cut(m.text)}`)
  }
  return lines.join('\n')
}

// Masks the credentials the engine finds in a text that is about to be
// filed. An engine older than this method has nothing to call: the text
// then goes as it is to the store's own scan, which the record's command
// runs on every text and which refuses a hit. Any other failure means the
// text could not be masked: the store is pushed to a remote, so the text is
// not written there, and undefined says so.
async function masked($: EngineInterface, text: string): Promise<string | undefined> {
  const whole = text.length <= MASKED_CHARS
  const head = whole ? text : text.slice(0, MASKED_CHARS)
  const mark = whole ? '' : `\n[cut here: the text had ${text.length} characters]`
  try {
    return `${await $.session.redact(head)}${mark}`
  } catch (err) {
    if (err instanceof TypeError) return `${head}${mark}`
    await keep($, {
      ok: false,
      reason: `A text was not kept: its credentials could not be masked (${String(err)}).`,
    })
    return undefined
  }
}

// The two tools an owner session works with other modules through. They are
// in the tool list of a session that owns a module, and behind the tool
// search of one that does not.
async function offerTools($: EngineInterface, isOwner: boolean): Promise<void> {
  await $.tool.register({
    name: 'ask_module',
    description:
      'Ask another module for something the module of this session needs. Use it when the work here depends on a change in another module: that module has an owner session of its own, so do not edit its files. Tandem writes the request in the record of both modules and hands it to the owner session of the module asked. The result says whether it was handed over. The answer comes later, as a message that starts with "Tandem answer to request".',
    inputSchema: {
      type: 'object',
      properties: {
        module: {
          type: 'string',
          description: 'The module to ask: its name as /module shows it, such as "mill", or its id.',
        },
        text: {
          type: 'string',
          description:
            'What is needed, and why. Write it in full: the other session knows nothing of this conversation.',
        },
      },
      required: ['module', 'text'],
    },
    isDeferred: !isOwner,
  })
  await $.tool.register({
    name: 'answer_request',
    description:
      'Answer a request another module made to the module of this session (a message that starts with "Tandem request r-..."). Call it when what was asked is built and pushed, or when it cannot be done. Tandem writes the answer on the request and tells the owner session of the module that asked.',
    inputSchema: {
      type: 'object',
      properties: {
        request: { type: 'string', description: 'The id of the request, such as "r-1a2b3c".' },
        text: {
          type: 'string',
          description: 'What was done and how to use it, or why it was not done.',
        },
      },
      required: ['request', 'text'],
    },
    isDeferred: !isOwner,
  })
}

// Hands a message of the record to another session, and says how it went.
async function hand(
  $: EngineInterface,
  send: { session: string; text: string },
): Promise<{ delivered: boolean; reason?: string }> {
  const went = await $.session.send({ to: { sessionId: send.session }, text: send.text })
  return went.isDelivered ? { delivered: true } : { delivered: false, reason: went.reason }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'module',
      description: 'Show the module this session owns. Also: /module own <folder>, /module leave',
    })
    const answer = await record($, 'view', {})
    await keep($, answer)
    const isOwner = answer.ok && answer.view?.module !== undefined
    await offerTools($, isOwner)
    // Unasked, the pane opens only for a session that already owns a module.
    if (isOwner) void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'module' }, async ($, e) => {
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    if (word !== '' && word !== 'own' && word !== 'leave')
      return { text: 'Use /module, /module own <folder> or /module leave.' }

    const answer =
      word === 'own'
        ? await record($, 'own', rest.length > 0 ? { dir: rest.join(' ') } : {})
        : await record($, word === 'leave' ? 'leave' : 'view', {})
    await keep($, answer)
    if (answer.ok && word !== '') await offerTools($, answer.view?.module !== undefined)
    const opened = await $.ui.open({ id: PANE, title: TITLE })

    // A surface that draws the pane shows the page there.
    return { text: opened.isPlaced ? 'The Tandem pane is open.' : page(await read($, shown)) }
  })

  // A prompt is filed after it entered, so one that was refused is not kept.
  on('prompt.submit', async ($, e, next) => {
    const entered = await next(e)
    if (entered.drop !== undefined || e.command) return entered

    const text = await masked($, e.text)
    if (text === undefined) return entered
    const answer = await record($, 'said', {
      text,
      origin: e.origin.kind,
      surface: await $.session.surface(),
    })
    if (!answer.ok || answer.view) await keep($, answer)

    return entered
  }).catch(($, e, next) => {
    $.ui.log(`Tandem: a prompt was not kept, the hook failed: ${JSON.stringify(next.error)}`)
    return next(e)
  })

  // A message the session's own model sends to another session is kept as
  // sent. One to an agent of this session is its own inner work, and one
  // the record composes is already on its request.
  on('session.send', async ($, e, next) => {
    const went = await next(e)
    if (!went.isDelivered || e.origin.kind !== 'model' || e.agentId !== undefined) return went
    const agents = await $.agent.list()
    if (agents.some(a => a.id === e.to || a.name === e.to || a.teammateId === e.to)) return went

    const text = await masked($, e.text)
    if (text !== undefined) {
      const answer = await record($, 'sent', { to: e.to, text })
      if (!answer.ok || answer.view) await keep($, answer)
    }

    return went
  }).catch(($, e, next) => {
    $.ui.log(`Tandem: a sent message was not kept, the hook failed: ${JSON.stringify(next.error)}`)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__tandem__ask_module' }, async ($, e) => {
    const text = await masked($, String(e.text ?? ''))
    if (text === undefined) return { deny: 'The request could not be masked, so it was not kept.' }
    const answer = await record($, 'ask', { to: String(e.module ?? ''), text })
    if (!answer.ok) return { deny: answer.reason }
    await keep($, answer)
    if (!answer.send) return { result: `Request ${answer.request} is in the record. ${answer.note}` }

    const went = await hand($, answer.send)
    await keep(
      $,
      await record($, 'handed', { request: answer.request, to: answer.send.session, ...went }),
    )

    return {
      result: went.delivered
        ? `Request ${answer.request} is in the record and was handed to the owner session of the module. Its answer will arrive as a message that starts with "Tandem answer to request ${answer.request}".`
        : `Request ${answer.request} is in the record, but the owner session of the module was not reached: ${went.reason}. That session is shown the request when it runs again.`,
    }
  }).catch(($, e, next) => ({
    deny: `Tandem could not ask the module, its tool failed: ${JSON.stringify(next.error)}`,
  }))

  on('tool.call', { tool: 'mcp__tandem__answer_request' }, async ($, e) => {
    const text = await masked($, String(e.text ?? ''))
    if (text === undefined) return { deny: 'The answer could not be masked, so it was not kept.' }
    const answer = await record($, 'answer', { request: String(e.request ?? ''), text })
    if (!answer.ok) return { deny: answer.reason }
    await keep($, answer)
    if (!answer.send) return { result: `The answer is on request ${answer.request}. ${answer.note}` }

    const went = await hand($, answer.send)

    return {
      result: went.delivered
        ? `The answer is on request ${answer.request}, and the owner session of the module that asked was told.`
        : `The answer is on request ${answer.request}. The owner session of the module that asked was not reached: ${went.reason}. It sees the answer in its pane.`,
    }
  }).catch(($, e, next) => ({
    deny: `Tandem could not keep the answer, its tool failed: ${JSON.stringify(next.error)}`,
  }))

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
    const act = async (command: string, input: Record<string, unknown>) => {
      const answer = await record($, command, input)
      await keep($, answer)
      if (answer.ok && command !== 'view') await offerTools($, answer.view?.module !== undefined)
    }
    const waiting = now.view?.requests.filter(r => r.message !== undefined) ?? []

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
        {waiting.map(r => (
          <Box key={r.id}>
            <Button
              key={`start:${r.id}`}
              label={`Start on ${r.id}`}
              variant="primary"
              onPress={async () => {
                if (r.message !== undefined) await $.prompt.submit({ text: r.message })
              }}
            />
            <Text dimColor> from {r.module}, not given to this session yet</Text>
          </Box>
        ))}
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
