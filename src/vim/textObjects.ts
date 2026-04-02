/**
 * Vim Text Object Finding
 *
 * Functions for finding text object boundaries (iw, aw, i", a(, etc.)
 */

import { isWordChar, isWhitespace, isPunctuation } from './motions.js'

export type TextObjectRange = { start: number; end: number } | null

/**
 * Delimiter pairs for text objects.
 */
const PAIRS: Record<string, [string, string]> = {
  '(': ['(', ')'],
  ')': ['(', ')'],
  b: ['(', ')'],
  '[': ['[', ']'],
  ']': ['[', ']'],
  '{': ['{', '}'],
  '}': ['{', '}'],
  B: ['{', '}'],
  '<': ['<', '>'],
  '>': ['<', '>'],
  '"': ['"', '"'],
  "'": ["'", "'"],
  '`': ['`', '`'],
}

/**
 * Find a text object at the given position.
 */
export function findTextObject(
  text: string,
  offset: number,
  objectType: string,
  isInner: boolean,
): TextObjectRange {
  if (objectType === 'w')
    return findWordObject(text, offset, isInner, isWordChar)
  if (objectType === 'W')
    return findWordObject(text, offset, isInner, ch => !isWhitespace(ch))

  const pair = PAIRS[objectType]
  if (pair) {
    const [open, close] = pair
    return open === close
      ? findQuoteObject(text, offset, open, isInner)
      : findBracketObject(text, offset, open, close, isInner)
  }

  return null
}

function findWordObject(
  text: string,
  offset: number,
  isInner: boolean,
  isWordFn: (ch: string) => boolean,
): TextObjectRange {
  if (offset >= text.length) return null

  let start = offset
  let end = offset

  const ch = text[offset]!

  if (isWordFn(ch)) {
    // Expand to cover the full word
    while (start > 0 && isWordFn(text[start - 1]!)) start--
    while (end < text.length && isWordFn(text[end]!)) end++
  } else if (isWhitespace(ch)) {
    // Whitespace region
    while (start > 0 && isWhitespace(text[start - 1]!)) start--
    while (end < text.length && isWhitespace(text[end]!)) end++
    return { start, end }
  } else if (isPunctuation(ch)) {
    // Punctuation sequence
    while (start > 0 && isPunctuation(text[start - 1]!)) start--
    while (end < text.length && isPunctuation(text[end]!)) end++
  }

  if (!isInner) {
    // Include surrounding whitespace
    if (end < text.length && isWhitespace(text[end]!)) {
      while (end < text.length && isWhitespace(text[end]!)) end++
    } else if (start > 0 && isWhitespace(text[start - 1]!)) {
      while (start > 0 && isWhitespace(text[start - 1]!)) start--
    }
  }

  return { start, end }
}

function findQuoteObject(
  text: string,
  offset: number,
  quote: string,
  isInner: boolean,
): TextObjectRange {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = text.indexOf('\n', offset)
  const effectiveEnd = lineEnd === -1 ? text.length : lineEnd
  const line = text.slice(lineStart, effectiveEnd)
  const posInLine = offset - lineStart

  const positions: number[] = []
  for (let i = 0; i < line.length; i++) {
    if (line[i] === quote) positions.push(i)
  }

  // Pair quotes: 0-1, 2-3, 4-5, etc.
  for (let i = 0; i < positions.length - 1; i += 2) {
    const qs = positions[i]!
    const qe = positions[i + 1]!
    if (qs <= posInLine && posInLine <= qe) {
      return isInner
        ? { start: lineStart + qs + 1, end: lineStart + qe }
        : { start: lineStart + qs, end: lineStart + qe + 1 }
    }
  }

  return null
}

function findBracketObject(
  text: string,
  offset: number,
  open: string,
  close: string,
  isInner: boolean,
): TextObjectRange {
  let depth = 0
  let start = -1

  for (let i = offset; i >= 0; i--) {
    if (text[i] === close && i !== offset) depth++
    else if (text[i] === open) {
      if (depth === 0) {
        start = i
        break
      }
      depth--
    }
  }
  if (start === -1) return null

  depth = 0
  let end = -1
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close) {
      if (depth === 0) {
        end = i
        break
      }
      depth--
    }
  }
  if (end === -1) return null

  return isInner ? { start: start + 1, end } : { start, end: end + 1 }
}
