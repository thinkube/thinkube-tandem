'use strict'

// Asciidoctor.js block extension: renders a [d2] literal or listing block
// with the local d2 binary and embeds the SVG in the page.
//
//   [d2,alt="What the diagram shows, in words"]
//   ....
//   a -> b: label
//   ....
//
// The d2 binary must be on PATH. A missing binary or a diagram d2 rejects
// stops the build with d2's own message.

const { execFileSync } = require('node:child_process')

const D2_ARGS = ['--layout', 'elk', '--pad', '16', '--scale', '1', '-', '-']

function escapeAttribute (text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderD2 (source, where) {
  try {
    return execFileSync('d2', D2_ARGS, { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`${where}: the d2 binary is not on PATH; install d2 (https://github.com/terrastruct/d2/releases) to build this site`)
    }
    const said = (err.stderr || err.message || '').toString().trim()
    throw new Error(`${where}: d2 could not render the diagram: ${said}`)
  }
}

function d2BlockProcessor () {
  this.named('d2')
  this.onContexts(['listing', 'literal'])
  this.parseContentAs('raw')
  this.process((parent, reader, attrs) => {
    const doc = parent.getDocument()
    const where = `${doc.getAttribute('docfile') || doc.getAttribute('docname') || 'a page'}`
    const svg = renderD2(reader.getString(), where)
      .replace(/^<\?xml[^>]*\?>\s*/, '')
      .replace(/^<svg /, '<svg style="max-width:100%;height:auto" ')
    const alt = attrs.alt ? ` role="img" aria-label="${escapeAttribute(attrs.alt)}"` : ''
    const html = `<div class="imageblock d2"><div class="content"${alt}>${svg}</div></div>`
    return this.createBlock(parent, 'pass', html)
  })
}

module.exports.register = function register (registry) {
  registry.block(d2BlockProcessor)
}
