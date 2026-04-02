/**
 * Vim Operator Functions
 *
 * Pure functions for executing vim operators (delete, change, yank, etc.)
 * Works with plain (text, offset) pairs instead of a Cursor class.
 */

import {
  isInclusiveMotion,
  isLinewiseMotion,
  resolveMotion,
  findCharacter,
  offsetToLineCol,
  countNewlinesBefore,
  startOfLine,
  startOfLastLine,
  startOfFirstLine,
  goToLine,
  endOfWord,
  endOfWORD,
  nextWord,
  nextWORD,
} from './motions.js'
import { findTextObject } from './textObjects.js'
import type {
  FindType,
  Operator,
  RecordedChange,
  TextObjScope,
} from './types.js'

// ============================================================================
// Operator Context
// ============================================================================

/**
 * Context for operator execution.
 * The caller provides these callbacks to interact with actual text state.
 */
export type OperatorContext = {
  text: string
  offset: number
  setText: (text: string) => void
  setOffset: (offset: number) => void
  enterInsert: (offset: number) => void
  getRegister: () => string
  getRegisterIsLinewise: () => boolean
  setRegister: (content: string, linewise: boolean) => void
  getLastFind: () => { type: FindType; char: string } | null
  setLastFind: (type: FindType, char: string) => void
  recordChange: (change: RecordedChange) => void
}

// ============================================================================
// Line start offset helper
// ============================================================================

function getLineStartOffset(lines: string[], lineIndex: number): number {
  return lines.slice(0, lineIndex).join('\n').length + (lineIndex > 0 ? 1 : 0)
}

// ============================================================================
// Core Operator Application
// ============================================================================

function applyOperator(
  op: Operator,
  from: number,
  to: number,
  ctx: OperatorContext,
  linewise: boolean = false,
): void {
  let content = ctx.text.slice(from, to)
  if (linewise && !content.endsWith('\n')) {
    content = content + '\n'
  }
  ctx.setRegister(content, linewise)

  if (op === 'yank') {
    ctx.setOffset(from)
  } else if (op === 'delete') {
    const newText = ctx.text.slice(0, from) + ctx.text.slice(to)
    ctx.setText(newText)
    const maxOff = Math.max(0, newText.length - 1)
    ctx.setOffset(Math.min(from, maxOff))
  } else if (op === 'change') {
    const newText = ctx.text.slice(0, from) + ctx.text.slice(to)
    ctx.setText(newText)
    ctx.enterInsert(from)
  }
}

// ============================================================================
// Operator Range Calculation
// ============================================================================

function getOperatorRange(
  text: string,
  cursorOffset: number,
  targetOffset: number,
  motion: string,
  op: Operator,
  count: number,
): { from: number; to: number; linewise: boolean } {
  let from = Math.min(cursorOffset, targetOffset)
  let to = Math.max(cursorOffset, targetOffset)
  let linewise = false

  // Special case: cw/cW changes to end of word, not start of next word
  if (op === 'change' && (motion === 'w' || motion === 'W')) {
    let wordOffset = cursorOffset
    for (let i = 0; i < count - 1; i++) {
      wordOffset =
        motion === 'w'
          ? nextWord(text, wordOffset)
          : nextWORD(text, wordOffset)
    }
    const wordEnd =
      motion === 'w'
        ? endOfWord(text, wordOffset)
        : endOfWORD(text, wordOffset)
    to = Math.min(wordEnd + 1, text.length)
  } else if (isLinewiseMotion(motion)) {
    linewise = true
    const nextNewline = text.indexOf('\n', to)
    if (nextNewline === -1) {
      to = text.length
      if (from > 0 && text[from - 1] === '\n') {
        from -= 1
      }
    } else {
      to = nextNewline + 1
    }
  } else if (isInclusiveMotion(motion) && cursorOffset <= targetOffset) {
    to = Math.min(to + 1, text.length)
  }

  return { from, to, linewise }
}

function getOperatorRangeForFind(
  cursorOffset: number,
  targetOffset: number,
): { from: number; to: number } {
  const from = Math.min(cursorOffset, targetOffset)
  const to = Math.max(cursorOffset, targetOffset) + 1
  return { from, to }
}

// ============================================================================
// Public Operator Functions
// ============================================================================

/**
 * Execute an operator with a simple motion.
 */
export function executeOperatorMotion(
  op: Operator,
  motion: string,
  count: number,
  ctx: OperatorContext,
): void {
  const target = resolveMotion(motion, ctx.text, ctx.offset, count)
  if (target === ctx.offset) return

  const range = getOperatorRange(ctx.text, ctx.offset, target, motion, op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  ctx.recordChange({ type: 'operator', op, motion, count })
}

/**
 * Execute an operator with a find motion.
 */
export function executeOperatorFind(
  op: Operator,
  findType: FindType,
  char: string,
  count: number,
  ctx: OperatorContext,
): void {
  const targetOffset = findCharacter(ctx.text, ctx.offset, char, findType, count)
  if (targetOffset === null) return

  const range = getOperatorRangeForFind(ctx.offset, targetOffset)
  applyOperator(op, range.from, range.to, ctx)
  ctx.setLastFind(findType, char)
  ctx.recordChange({ type: 'operatorFind', op, find: findType, char, count })
}

/**
 * Execute an operator with a text object.
 */
export function executeOperatorTextObj(
  op: Operator,
  scope: TextObjScope,
  objType: string,
  count: number,
  ctx: OperatorContext,
): void {
  const range = findTextObject(
    ctx.text,
    ctx.offset,
    objType,
    scope === 'inner',
  )
  if (!range) return

  applyOperator(op, range.start, range.end, ctx)
  ctx.recordChange({ type: 'operatorTextObj', op, objType, scope, count })
}

/**
 * Execute a line operation (dd, cc, yy).
 */
export function executeLineOp(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  const currentLine = countNewlinesBefore(text, ctx.offset)
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const lineStart = startOfLine(text, ctx.offset)
  let lineEnd = lineStart
  for (let i = 0; i < linesToAffect; i++) {
    const nextNewline = text.indexOf('\n', lineEnd)
    lineEnd = nextNewline === -1 ? text.length : nextNewline + 1
  }

  let content = text.slice(lineStart, lineEnd)
  if (!content.endsWith('\n')) {
    content = content + '\n'
  }
  ctx.setRegister(content, true)

  if (op === 'yank') {
    ctx.setOffset(lineStart)
  } else if (op === 'delete') {
    let deleteStart = lineStart
    const deleteEnd = lineEnd

    if (deleteEnd === text.length && deleteStart > 0 && text[deleteStart - 1] === '\n') {
      deleteStart -= 1
    }

    const newText = text.slice(0, deleteStart) + text.slice(deleteEnd)
    ctx.setText(newText || '')
    const maxOff = Math.max(0, newText.length - 1)
    ctx.setOffset(Math.min(deleteStart, maxOff))
  } else if (op === 'change') {
    if (lines.length === 1) {
      ctx.setText('')
      ctx.enterInsert(0)
    } else {
      const beforeLines = lines.slice(0, currentLine)
      const afterLines = lines.slice(currentLine + linesToAffect)
      const newText = [...beforeLines, '', ...afterLines].join('\n')
      ctx.setText(newText)
      ctx.enterInsert(lineStart)
    }
  }

  ctx.recordChange({ type: 'operator', op, motion: op[0]!, count })
}

/**
 * Execute delete character (x command).
 */
export function executeX(count: number, ctx: OperatorContext): void {
  const from = ctx.offset
  if (from >= ctx.text.length) return

  const to = Math.min(from + count, ctx.text.length)
  const deleted = ctx.text.slice(from, to)
  const newText = ctx.text.slice(0, from) + ctx.text.slice(to)

  ctx.setRegister(deleted, false)
  ctx.setText(newText)
  const maxOff = Math.max(0, newText.length - 1)
  ctx.setOffset(Math.min(from, maxOff))
  ctx.recordChange({ type: 'x', count })
}

/**
 * Execute replace character (r command).
 */
export function executeReplace(
  char: string,
  count: number,
  ctx: OperatorContext,
): void {
  let offset = ctx.offset
  let newText = ctx.text

  for (let i = 0; i < count && offset < newText.length; i++) {
    newText = newText.slice(0, offset) + char + newText.slice(offset + 1)
    offset += char.length
  }

  ctx.setText(newText)
  ctx.setOffset(Math.max(0, offset - char.length))
  ctx.recordChange({ type: 'replace', char, count })
}

/**
 * Execute toggle case (~ command).
 */
export function executeToggleCase(count: number, ctx: OperatorContext): void {
  const startOffset = ctx.offset
  if (startOffset >= ctx.text.length) return

  let newText = ctx.text
  let offset = startOffset
  let toggled = 0

  while (offset < newText.length && toggled < count) {
    const ch = newText[offset]!
    const toggledChar =
      ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()
    newText = newText.slice(0, offset) + toggledChar + newText.slice(offset + 1)
    offset++
    toggled++
  }

  ctx.setText(newText)
  ctx.setOffset(offset)
  ctx.recordChange({ type: 'toggleCase', count })
}

/**
 * Execute join lines (J command).
 */
export function executeJoin(count: number, ctx: OperatorContext): void {
  const text = ctx.text
  const lines = text.split('\n')
  const { line: currentLine } = offsetToLineCol(text, ctx.offset)

  if (currentLine >= lines.length - 1) return

  const linesToJoin = Math.min(count, lines.length - currentLine - 1)
  let joinedLine = lines[currentLine]!
  const cursorPos = joinedLine.length

  for (let i = 1; i <= linesToJoin; i++) {
    const nextLine = (lines[currentLine + i] ?? '').trimStart()
    if (nextLine.length > 0) {
      if (!joinedLine.endsWith(' ') && joinedLine.length > 0) {
        joinedLine += ' '
      }
      joinedLine += nextLine
    }
  }

  const newLines = [
    ...lines.slice(0, currentLine),
    joinedLine,
    ...lines.slice(currentLine + linesToJoin + 1),
  ]

  const newText = newLines.join('\n')
  ctx.setText(newText)
  ctx.setOffset(getLineStartOffset(newLines, currentLine) + cursorPos)
  ctx.recordChange({ type: 'join', count })
}

/**
 * Execute paste (p/P command).
 */
export function executePaste(
  after: boolean,
  count: number,
  ctx: OperatorContext,
): void {
  const register = ctx.getRegister()
  if (!register) return

  const isLinewise = ctx.getRegisterIsLinewise()
  const content = isLinewise && register.endsWith('\n')
    ? register.slice(0, -1)
    : register

  if (isLinewise) {
    const text = ctx.text
    const lines = text.split('\n')
    const { line: currentLine } = offsetToLineCol(text, ctx.offset)

    const insertLine = after ? currentLine + 1 : currentLine
    const contentLines = content.split('\n')
    const repeatedLines: string[] = []
    for (let i = 0; i < count; i++) {
      repeatedLines.push(...contentLines)
    }

    const newLines = [
      ...lines.slice(0, insertLine),
      ...repeatedLines,
      ...lines.slice(insertLine),
    ]

    const newText = newLines.join('\n')
    ctx.setText(newText)
    ctx.setOffset(getLineStartOffset(newLines, insertLine))
  } else {
    const textToInsert = content.repeat(count)
    const insertPoint =
      after && ctx.offset < ctx.text.length
        ? ctx.offset + 1
        : ctx.offset

    const newText =
      ctx.text.slice(0, insertPoint) +
      textToInsert +
      ctx.text.slice(insertPoint)
    const newOffset = insertPoint + textToInsert.length - 1

    ctx.setText(newText)
    ctx.setOffset(Math.max(insertPoint, newOffset))
  }
}

/**
 * Execute indent (>> / << command).
 */
export function executeIndent(
  dir: '>' | '<',
  count: number,
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  const { line: currentLine } = offsetToLineCol(text, ctx.offset)
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const indent = '  ' // Two spaces

  for (let i = 0; i < linesToAffect; i++) {
    const lineIdx = currentLine + i
    const line = lines[lineIdx] ?? ''

    if (dir === '>') {
      lines[lineIdx] = indent + line
    } else if (line.startsWith(indent)) {
      lines[lineIdx] = line.slice(indent.length)
    } else if (line.startsWith('\t')) {
      lines[lineIdx] = line.slice(1)
    } else {
      let removed = 0
      let idx = 0
      while (idx < line.length && removed < indent.length && /\s/.test(line[idx]!)) {
        removed++
        idx++
      }
      lines[lineIdx] = line.slice(idx)
    }
  }

  const newText = lines.join('\n')
  const currentLineText = lines[currentLine] ?? ''
  const firstNonBlankPos = (currentLineText.match(/^\s*/)?.[0] ?? '').length

  ctx.setText(newText)
  ctx.setOffset(getLineStartOffset(lines, currentLine) + firstNonBlankPos)
  ctx.recordChange({ type: 'indent', dir, count })
}

/**
 * Execute open line (o/O command).
 */
export function executeOpenLine(
  direction: 'above' | 'below',
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  const { line: currentLine } = offsetToLineCol(text, ctx.offset)

  const insertLine = direction === 'below' ? currentLine + 1 : currentLine
  const newLines = [
    ...lines.slice(0, insertLine),
    '',
    ...lines.slice(insertLine),
  ]

  const newText = newLines.join('\n')
  ctx.setText(newText)
  ctx.enterInsert(getLineStartOffset(newLines, insertLine))
  ctx.recordChange({ type: 'openLine', direction })
}

/**
 * Execute operator with G motion.
 */
export function executeOperatorG(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  const target =
    count === 1
      ? startOfLastLine(ctx.text)
      : goToLine(ctx.text, count)

  if (target === ctx.offset) return

  const range = getOperatorRange(ctx.text, ctx.offset, target, 'G', op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  ctx.recordChange({ type: 'operator', op, motion: 'G', count })
}

/**
 * Execute operator with gg motion.
 */
export function executeOperatorGg(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  const target =
    count === 1
      ? startOfFirstLine()
      : goToLine(ctx.text, count)

  if (target === ctx.offset) return

  const range = getOperatorRange(ctx.text, ctx.offset, target, 'gg', op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  ctx.recordChange({ type: 'operator', op, motion: 'gg', count })
}

