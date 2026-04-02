/**
 * Vim Motion Functions
 *
 * Pure functions for resolving vim motions to cursor positions.
 * Operates on plain text strings with a numeric cursor offset.
 *
 * Unlike Claude Code's implementation which depends on a rich Cursor class,
 * this module works directly with (text, offset) pairs for simplicity
 * and independence from any specific UI framework.
 */

// ============================================================================
// Character Classification
// ============================================================================

export function isWordChar(ch: string): boolean {
  return /[a-zA-Z0-9_]/.test(ch)
}

export function isWhitespace(ch: string): boolean {
  return /\s/.test(ch)
}

export function isPunctuation(ch: string): boolean {
  return !isWordChar(ch) && !isWhitespace(ch)
}

// ============================================================================
// Motion Resolution
// ============================================================================

/**
 * Resolve a motion to a target cursor offset.
 * Pure calculation - does not modify anything.
 */
export function resolveMotion(
  key: string,
  text: string,
  offset: number,
  count: number,
): number {
  let result = offset
  for (let i = 0; i < count; i++) {
    const next = applySingleMotion(key, text, result)
    if (next === result) break
    result = next
  }
  return result
}

/**
 * Apply a single motion step.
 */
function applySingleMotion(key: string, text: string, offset: number): number {
  switch (key) {
    case 'h':
      return moveLeft(text, offset)
    case 'l':
      return moveRight(text, offset)
    case 'j':
      return moveDown(text, offset)
    case 'k':
      return moveUp(text, offset)
    case 'gj':
      return moveDown(text, offset)
    case 'gk':
      return moveUp(text, offset)
    case 'w':
      return nextWord(text, offset)
    case 'b':
      return prevWord(text, offset)
    case 'e':
      return endOfWord(text, offset)
    case 'W':
      return nextWORD(text, offset)
    case 'B':
      return prevWORD(text, offset)
    case 'E':
      return endOfWORD(text, offset)
    case '0':
      return startOfLine(text, offset)
    case '^':
      return firstNonBlank(text, offset)
    case '$':
      return endOfLine(text, offset)
    case 'G':
      return startOfLastLine(text)
    default:
      return offset
  }
}

/**
 * Check if a motion is inclusive (includes character at destination).
 */
export function isInclusiveMotion(key: string): boolean {
  return 'eE$'.includes(key)
}

/**
 * Check if a motion is linewise (operates on full lines with operators).
 */
export function isLinewiseMotion(key: string): boolean {
  return 'jkG'.includes(key) || key === 'gg'
}

// ============================================================================
// Basic Movement
// ============================================================================

function moveLeft(_text: string, offset: number): number {
  return Math.max(0, offset - 1)
}

function moveRight(text: string, offset: number): number {
  if (offset >= text.length - 1) return offset
  return offset + 1
}

function moveDown(text: string, offset: number): number {
  const lines = text.split('\n')
  const { line, col } = offsetToLineCol(text, offset)
  if (line >= lines.length - 1) return offset
  const nextLineLen = lines[line + 1]!.length
  const newCol = Math.min(col, nextLineLen)
  return lineColToOffset(text, line + 1, newCol)
}

function moveUp(text: string, offset: number): number {
  const { line, col } = offsetToLineCol(text, offset)
  if (line <= 0) return offset
  const lines = text.split('\n')
  const prevLineLen = lines[line - 1]!.length
  const newCol = Math.min(col, prevLineLen)
  return lineColToOffset(text, line - 1, newCol)
}

// ============================================================================
// Word Motions (vim word = [a-zA-Z0-9_]+ or punctuation sequence)
// ============================================================================

export function nextWord(text: string, offset: number): number {
  let i = offset
  if (i >= text.length) return i

  // Skip current word or punctuation
  if (isWordChar(text[i]!)) {
    while (i < text.length && isWordChar(text[i]!)) i++
  } else if (isPunctuation(text[i]!)) {
    while (i < text.length && isPunctuation(text[i]!)) i++
  }
  // Skip whitespace
  while (i < text.length && isWhitespace(text[i]!)) i++

  return Math.min(i, text.length)
}

function prevWord(text: string, offset: number): number {
  let i = offset - 1
  if (i <= 0) return 0

  // Skip whitespace backwards
  while (i > 0 && isWhitespace(text[i]!)) i--
  if (i <= 0) return 0

  // Skip word or punctuation backwards
  if (isWordChar(text[i]!)) {
    while (i > 0 && isWordChar(text[i - 1]!)) i--
  } else if (isPunctuation(text[i]!)) {
    while (i > 0 && isPunctuation(text[i - 1]!)) i--
  }

  return i
}

export function endOfWord(text: string, offset: number): number {
  let i = offset + 1
  if (i >= text.length) return Math.max(0, text.length - 1)

  // Skip whitespace
  while (i < text.length && isWhitespace(text[i]!)) i++
  if (i >= text.length) return Math.max(0, text.length - 1)

  // Move to end of word or punctuation
  if (isWordChar(text[i]!)) {
    while (i + 1 < text.length && isWordChar(text[i + 1]!)) i++
  } else if (isPunctuation(text[i]!)) {
    while (i + 1 < text.length && isPunctuation(text[i + 1]!)) i++
  }

  return i
}

// ============================================================================
// WORD Motions (WORD = any non-whitespace sequence)
// ============================================================================

export function nextWORD(text: string, offset: number): number {
  let i = offset
  // Skip non-whitespace
  while (i < text.length && !isWhitespace(text[i]!)) i++
  // Skip whitespace
  while (i < text.length && isWhitespace(text[i]!)) i++
  return Math.min(i, text.length)
}

function prevWORD(text: string, offset: number): number {
  let i = offset - 1
  if (i <= 0) return 0
  // Skip whitespace backwards
  while (i > 0 && isWhitespace(text[i]!)) i--
  // Skip non-whitespace backwards
  while (i > 0 && !isWhitespace(text[i - 1]!)) i--
  return i
}

export function endOfWORD(text: string, offset: number): number {
  let i = offset + 1
  if (i >= text.length) return Math.max(0, text.length - 1)
  // Skip whitespace
  while (i < text.length && isWhitespace(text[i]!)) i++
  // Move to end of WORD
  while (i + 1 < text.length && !isWhitespace(text[i + 1]!)) i++
  return Math.min(i, Math.max(0, text.length - 1))
}

// ============================================================================
// Line Motions
// ============================================================================

export function startOfLine(text: string, offset: number): number {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  return lineStart
}

export function firstNonBlank(text: string, offset: number): number {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  let i = lineStart
  while (i < text.length && text[i] !== '\n' && /\s/.test(text[i]!)) i++
  return i
}

function endOfLine(text: string, offset: number): number {
  const lineEnd = text.indexOf('\n', offset)
  if (lineEnd === -1) return Math.max(0, text.length - 1)
  return Math.max(0, lineEnd - 1)
}

export function startOfLastLine(text: string): number {
  const lastNewline = text.lastIndexOf('\n')
  return lastNewline === -1 ? 0 : lastNewline + 1
}

export function startOfFirstLine(): number {
  return 0
}

export function goToLine(text: string, lineNumber: number): number {
  const lines = text.split('\n')
  const targetLine = Math.min(lineNumber - 1, lines.length - 1)
  return lineColToOffset(text, Math.max(0, targetLine), 0)
}

// ============================================================================
// Find Character
// ============================================================================

/**
 * Find a character on the current line.
 * Returns the target offset or null if not found.
 */
export function findCharacter(
  text: string,
  offset: number,
  char: string,
  findType: 'f' | 'F' | 't' | 'T',
  count: number,
): number | null {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = text.indexOf('\n', offset)
  const effectiveEnd = lineEnd === -1 ? text.length : lineEnd

  const forward = findType === 'f' || findType === 't'
  let found = 0
  let pos = offset

  if (forward) {
    for (let i = offset + 1; i < effectiveEnd; i++) {
      if (text[i] === char) {
        found++
        pos = i
        if (found === count) break
      }
    }
  } else {
    for (let i = offset - 1; i >= lineStart; i--) {
      if (text[i] === char) {
        found++
        pos = i
        if (found === count) break
      }
    }
  }

  if (found < count) return null

  // Adjust for t/T (stop before the character)
  if (findType === 't') return pos - 1
  if (findType === 'T') return pos + 1
  return pos
}

// ============================================================================
// Coordinate Utilities
// ============================================================================

export function offsetToLineCol(
  text: string,
  offset: number,
): { line: number; col: number } {
  let line = 0
  let col = 0
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++
      col = 0
    } else {
      col++
    }
  }
  return { line, col }
}

export function lineColToOffset(
  text: string,
  line: number,
  col: number,
): number {
  const lines = text.split('\n')
  let offset = 0
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i]!.length + 1
  }
  const lineLen = lines[line]?.length ?? 0
  return offset + Math.min(col, lineLen)
}

export function countNewlinesBefore(text: string, offset: number): number {
  let count = 0
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') count++
  }
  return count
}
