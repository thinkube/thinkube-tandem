// What the Tandem pane shows, as the record's command answers it
// (src/record/view.ts in the extension).

export type TandemCommit = { sha: string; subject: string }

export type TandemSentence = {
  id: string
  at: string
  by: 'person' | 'session'
  text: string
  commits: TandemCommit[]
}

export type TandemPlace = {
  dir: string
  label: string
  repo: string
  prefix: string
  owner: 'this' | 'other' | 'none'
}

export type TandemView = {
  module?: { id: string; label: string; product?: string; repo: string; prefix: string }
  sentences: TandemSentence[]
  loose: TandemCommit[]
  here: TandemPlace[]
  note?: string
}

// The last view the record gave, and the last thing it could not do.
export type TandemShown = { view: TandemView | null; problem: string | null }

declare module 'claude-code' {
  interface PluginState {
    tandem: { shown: TandemShown }
  }
}
