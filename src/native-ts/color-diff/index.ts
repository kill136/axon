/**
 * Pure-TypeScript port of vendor/color-diff (Rust NAPI module).
 *
 * The native module uses tree-sitter for syntax highlighting and a custom
 * word-level diff renderer. This port reimplements the same API using
 * highlight.js for syntax coloring and the `diff` package for word-level diffs.
 *
 * Key API:
 *   ColorDiff  — syntax-highlighted word-level diff rendering
 *   ColorFile  — syntax-highlighted file content rendering
 *   getSyntaxTheme(themeId) — returns a theme object or null
 *
 * Both classes use lazy initialization: highlight.js is only loaded on first
 * use, keeping startup fast for paths that never render diffs.
 */

import type { Change } from 'diff'

type Hunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

type ThemeColors = {
  added: string
  removed: string
  addedWord: string
  removedWord: string
  lineNumber: string
  dim: string
  keyword: string
  string: string
  number: string
  comment: string
  function: string
  type: string
  variable: string
  operator: string
  punctuation: string
  tag: string
  attribute: string
  text: string
}

type SyntaxTheme = {
  id: string
  colors: ThemeColors
}

const DARK_THEME: SyntaxTheme = {
  id: 'dark',
  colors: {
    added: '\x1b[32m',
    removed: '\x1b[31m',
    addedWord: '\x1b[30;42m',
    removedWord: '\x1b[30;41m',
    lineNumber: '\x1b[90m',
    dim: '\x1b[2m',
    keyword: '\x1b[35m',
    string: '\x1b[33m',
    number: '\x1b[36m',
    comment: '\x1b[90m',
    function: '\x1b[34m',
    type: '\x1b[36m',
    variable: '\x1b[37m',
    operator: '\x1b[37m',
    punctuation: '\x1b[37m',
    tag: '\x1b[31m',
    attribute: '\x1b[33m',
    text: '\x1b[37m',
  },
}

const LIGHT_THEME: SyntaxTheme = {
  id: 'light',
  colors: {
    added: '\x1b[32m',
    removed: '\x1b[31m',
    addedWord: '\x1b[30;42m',
    removedWord: '\x1b[30;41m',
    lineNumber: '\x1b[90m',
    dim: '\x1b[2m',
    keyword: '\x1b[35m',
    string: '\x1b[33m',
    number: '\x1b[34m',
    comment: '\x1b[90m',
    function: '\x1b[34m',
    type: '\x1b[36m',
    variable: '\x1b[30m',
    operator: '\x1b[30m',
    punctuation: '\x1b[30m',
    tag: '\x1b[31m',
    attribute: '\x1b[33m',
    text: '\x1b[30m',
  },
}

const RESET = '\x1b[0m'

let hljs: typeof import('highlight.js').default | null = null
let diffModule: typeof import('diff') | null = null
let hljsLoaded = false
let diffLoaded = false

function ensureHljs(): typeof import('highlight.js').default | null {
  if (hljsLoaded) return hljs
  hljsLoaded = true
  try {
    hljs = require('highlight.js') as typeof import('highlight.js').default
  } catch {
    hljs = null
  }
  return hljs
}

function ensureDiff(): typeof import('diff') | null {
  if (diffLoaded) return diffModule
  diffLoaded = true
  try {
    diffModule = require('diff') as typeof import('diff')
  } catch {
    diffModule = null
  }
  return diffModule
}

function extToLanguage(filePath: string | null): string | undefined {
  if (!filePath) return undefined
  const dot = filePath.lastIndexOf('.')
  if (dot === -1) return undefined
  const ext = filePath.slice(dot + 1).toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    c: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'ini',
    xml: 'xml',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    sql: 'sql',
    md: 'markdown',
    markdown: 'markdown',
    lua: 'lua',
    r: 'r',
    scala: 'scala',
    dart: 'dart',
    zig: 'zig',
    ex: 'elixir',
    exs: 'elixir',
    erl: 'erlang',
    hs: 'haskell',
    ml: 'ocaml',
    vue: 'xml',
    svelte: 'xml',
    graphql: 'graphql',
    gql: 'graphql',
    proto: 'protobuf',
    dockerfile: 'dockerfile',
    tf: 'hcl',
    vim: 'vim',
    el: 'lisp',
    clj: 'clojure',
    ps1: 'powershell',
    bat: 'dos',
    ini: 'ini',
    cfg: 'ini',
    makefile: 'makefile',
    cmake: 'cmake',
  }
  return map[ext]
}

const CSS_CLASS_TO_THEME_KEY: Record<string, keyof ThemeColors> = {
  'hljs-keyword': 'keyword',
  'hljs-built_in': 'keyword',
  'hljs-literal': 'keyword',
  'hljs-type': 'type',
  'hljs-string': 'string',
  'hljs-template-variable': 'string',
  'hljs-regexp': 'string',
  'hljs-number': 'number',
  'hljs-comment': 'comment',
  'hljs-doctag': 'comment',
  'hljs-title': 'function',
  'hljs-title.function_': 'function',
  'hljs-function': 'function',
  'hljs-variable': 'variable',
  'hljs-params': 'variable',
  'hljs-attr': 'attribute',
  'hljs-attribute': 'attribute',
  'hljs-tag': 'tag',
  'hljs-name': 'tag',
  'hljs-selector-tag': 'tag',
  'hljs-selector-class': 'attribute',
  'hljs-selector-id': 'attribute',
  'hljs-operator': 'operator',
  'hljs-punctuation': 'punctuation',
  'hljs-symbol': 'string',
  'hljs-meta': 'comment',
  'hljs-property': 'variable',
}

function htmlToAnsi(html: string, colors: ThemeColors): string {
  let result = ''
  let i = 0
  const colorStack: string[] = []

  while (i < html.length) {
    if (html[i] === '<') {
      const closeTag = html[i + 1] === '/'
      const tagEnd = html.indexOf('>', i)
      if (tagEnd === -1) {
        result += html[i]
        i++
        continue
      }

      if (closeTag) {
        colorStack.pop()
        result += RESET
        if (colorStack.length > 0) {
          result += colorStack[colorStack.length - 1]!
        }
        i = tagEnd + 1
        continue
      }

      const tagContent = html.slice(i + 1, tagEnd)
      const classMatch = tagContent.match(/class="([^"]*)"/)
      if (classMatch) {
        const classes = classMatch[1]!.split(' ')
        let color = colors.text
        for (const cls of classes) {
          const key = CSS_CLASS_TO_THEME_KEY[cls]
          if (key) {
            color = colors[key]
            break
          }
        }
        colorStack.push(color)
        result += color
      }
      i = tagEnd + 1
      continue
    }

    if (html[i] === '&') {
      const semiIdx = html.indexOf(';', i)
      if (semiIdx !== -1 && semiIdx - i < 8) {
        const entity = html.slice(i, semiIdx + 1)
        if (entity === '&lt;') result += '<'
        else if (entity === '&gt;') result += '>'
        else if (entity === '&amp;') result += '&'
        else if (entity === '&quot;') result += '"'
        else if (entity === '&#x27;' || entity === '&apos;') result += "'"
        else result += entity
        i = semiIdx + 1
        continue
      }
    }

    result += html[i]
    i++
  }

  return result + RESET
}

function highlightLine(line: string, lang: string | undefined, colors: ThemeColors): string {
  const hl = ensureHljs()
  if (!hl) return line

  try {
    let result
    if (lang) {
      try {
        result = hl.highlight(line, { language: lang })
      } catch {
        result = hl.highlightAuto(line)
      }
    } else {
      result = hl.highlightAuto(line)
    }
    return htmlToAnsi(result.value, colors)
  } catch {
    return line
  }
}

function padLineNumber(n: number, width: number): string {
  const s = n.toString()
  return ' '.repeat(Math.max(0, width - s.length)) + s
}

function computeGutterWidth(maxLine: number): number {
  return Math.max(3, maxLine.toString().length)
}

function truncateToWidth(line: string, width: number): string {
  let visible = 0
  let inEscape = false
  let i = 0
  for (; i < line.length && visible < width; i++) {
    if (line[i] === '\x1b') {
      inEscape = true
      continue
    }
    if (inEscape) {
      if (line[i] === 'm') inEscape = false
      continue
    }
    visible++
  }
  if (visible >= width && i < line.length) {
    return line.slice(0, i) + RESET
  }
  return line
}

export class ColorDiff {
  private hunks: Hunk[]
  private firstLine: number | null
  private filePath: string | null
  private fileContent: string | null

  constructor(
    hunks: Hunk[],
    firstLine: number | null,
    filePath: string | null,
    fileContent: string | null,
  ) {
    this.hunks = hunks
    this.firstLine = firstLine
    this.filePath = filePath
    this.fileContent = fileContent
  }

  render(themeId: string, width: number, dim: boolean): string[] | null {
    if (this.hunks.length === 0) return null

    const theme = themeId === 'light' ? LIGHT_THEME : DARK_THEME
    const colors = theme.colors
    const lang = extToLanguage(this.filePath)
    const diff = ensureDiff()
    const dimPrefix = dim ? colors.dim : ''
    const output: string[] = []

    let maxLine = 0
    for (const hunk of this.hunks) {
      const addEnd = hunk.newStart + hunk.newLines
      const removeEnd = hunk.oldStart + hunk.oldLines
      if (addEnd > maxLine) maxLine = addEnd
      if (removeEnd > maxLine) maxLine = removeEnd
    }
    const gutterW = computeGutterWidth(maxLine)
    const contentWidth = Math.max(1, width - gutterW - 3)

    for (const hunk of this.hunks) {
      let oldLineNum = hunk.oldStart
      let newLineNum = hunk.newStart
      const lines = hunk.lines

      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!
        const prefix = raw[0]
        const content = raw.slice(1)

        if (prefix === ' ') {
          const gutter = `${colors.lineNumber}${padLineNumber(newLineNum, gutterW)}${RESET}`
          const highlighted = highlightLine(content, lang, colors)
          const line = `${dimPrefix}${gutter} ${dim ? colors.dim : ' '}${highlighted}${RESET}`
          output.push(truncateToWidth(line, width))
          oldLineNum++
          newLineNum++
        } else if (prefix === '-') {
          const nextAdd = findMatchingAdd(lines, i)
          let rendered: string
          if (diff && nextAdd !== null) {
            const addContent = lines[nextAdd]!.slice(1)
            rendered = renderWordDiff(content, addContent, 'remove', colors, diff, lang)
          } else {
            const highlighted = highlightLine(content, lang, colors)
            rendered = `${colors.removed}${highlighted}${RESET}`
          }
          const gutter = `${colors.lineNumber}${padLineNumber(oldLineNum, gutterW)}${RESET}`
          const line = `${dimPrefix}${gutter} ${colors.removed}-${RESET}${rendered}${RESET}`
          output.push(truncateToWidth(line, width))
          oldLineNum++
        } else if (prefix === '+') {
          const prevRemove = findMatchingRemove(lines, i)
          let rendered: string
          if (diff && prevRemove !== null) {
            const removeContent = lines[prevRemove]!.slice(1)
            rendered = renderWordDiff(removeContent, content, 'add', colors, diff, lang)
          } else {
            const highlighted = highlightLine(content, lang, colors)
            rendered = `${colors.added}${highlighted}${RESET}`
          }
          const gutter = `${colors.lineNumber}${padLineNumber(newLineNum, gutterW)}${RESET}`
          const line = `${dimPrefix}${gutter} ${colors.added}+${RESET}${rendered}${RESET}`
          output.push(truncateToWidth(line, width))
          newLineNum++
        }
      }
    }

    return output.length > 0 ? output : null
  }
}

function findMatchingAdd(lines: string[], removeIdx: number): number | null {
  let j = removeIdx + 1
  while (j < lines.length && lines[j]![0] === '-') j++
  if (j < lines.length && lines[j]![0] === '+') return j
  return null
}

function findMatchingRemove(lines: string[], addIdx: number): number | null {
  let j = addIdx - 1
  while (j >= 0 && lines[j]![0] === '+') j--
  if (j >= 0 && lines[j]![0] === '-') return j
  return null
}

function renderWordDiff(
  oldText: string,
  newText: string,
  side: 'add' | 'remove',
  colors: ThemeColors,
  diff: typeof import('diff'),
  lang: string | undefined,
): string {
  const changes: Change[] = diff.diffWords(oldText, newText)
  let result = ''
  const baseColor = side === 'add' ? colors.added : colors.removed
  const wordHighlight = side === 'add' ? colors.addedWord : colors.removedWord
  const showText = side === 'add' ? 'added' : 'removed'

  for (const change of changes) {
    if (change.added && side === 'remove') continue
    if (change.removed && side === 'add') continue

    if ((side === 'add' && change.added) || (side === 'remove' && change.removed)) {
      result += `${wordHighlight}${change.value}${RESET}${baseColor}`
    } else if (!change.added && !change.removed) {
      result += `${baseColor}${change.value}`
    }
  }

  return result + RESET
}

export class ColorFile {
  private code: string
  private filePath: string

  constructor(code: string, filePath: string) {
    this.code = code
    this.filePath = filePath
  }

  render(themeId: string, width: number, dim: boolean): string[] | null {
    const hl = ensureHljs()
    if (!hl) return null

    const theme = themeId === 'light' ? LIGHT_THEME : DARK_THEME
    const colors = theme.colors
    const lang = extToLanguage(this.filePath)
    const lines = this.code.split('\n')
    const gutterW = computeGutterWidth(lines.length)
    const dimPrefix = dim ? colors.dim : ''
    const output: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1
      const gutter = `${colors.lineNumber}${padLineNumber(lineNum, gutterW)}${RESET}`
      const highlighted = highlightLine(lines[i]!, lang, colors)
      const line = `${dimPrefix}${gutter}  ${highlighted}${RESET}`
      output.push(truncateToWidth(line, width))
    }

    return output.length > 0 ? output : null
  }
}

export function getSyntaxTheme(themeId: string): SyntaxTheme | null {
  if (themeId === 'dark') return DARK_THEME
  if (themeId === 'light') return LIGHT_THEME
  return null
}

export type { Hunk, SyntaxTheme, ThemeColors }
