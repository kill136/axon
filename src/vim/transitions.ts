import {
  resolveMotion,
  findCharacter,
  startOfLastLine,
  startOfFirstLine,
  goToLine,
  firstNonBlank,
  startOfLine,
} from './motions.js'
import {
  executeOperatorMotion,
  executeOperatorFind,
  executeOperatorTextObj,
  executeLineOp,
  executeX,
  executeReplace,
  executeToggleCase,
  executeJoin,
  executePaste,
  executeIndent,
  executeOpenLine,
  executeOperatorG,
  executeOperatorGg,
  type OperatorContext,
} from './operators.js'
import {
  type VimState,
  type CommandState,
  type FindType,
  type PersistentState,
  type Operator,
  OPERATORS,
  SIMPLE_MOTIONS,
  FIND_KEYS,
  TEXT_OBJ_SCOPES,
  TEXT_OBJ_TYPES,
  MAX_VIM_COUNT,
  isOperatorKey,
  isTextObjScopeKey,
} from './types.js'

export type TransitionResult = {
  next?: CommandState
  execute?: () => void
}

export type TransitionContext = OperatorContext & {
  onDotRepeat?: () => void
  onUndo?: () => void
}

export function processNormalKey(
  command: CommandState,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  switch (command.type) {
    case 'idle':
      return handleIdle(key, ctx)
    case 'count':
      return handleCount(command, key, ctx)
    case 'operator':
      return handleOperator(command, key, ctx)
    case 'operatorCount':
      return handleOperatorCount(command, key, ctx)
    case 'operatorFind':
      return handleOperatorFind(command, key, ctx)
    case 'operatorTextObj':
      return handleOperatorTextObj(command, key, ctx)
    case 'find':
      return handleFind(command, key, ctx)
    case 'g':
      return handleG(command, key, ctx)
    case 'operatorG':
      return handleOperatorG(command, key, ctx)
    case 'replace':
      return handleReplace(command, key, ctx)
    case 'indent':
      return handleIndent(command, key, ctx)
  }
}

function dispatchNormalKey(
  key: string,
  count: number,
  ctx: TransitionContext,
): TransitionResult | null {
  if (isOperatorKey(key)) {
    return { next: { type: 'operator', op: OPERATORS[key], count } }
  }
  if (SIMPLE_MOTIONS.has(key)) {
    return {
      execute: () => {
        const target = resolveMotion(key, ctx.text, ctx.offset, count)
        ctx.setOffset(target)
      },
    }
  }
  if (FIND_KEYS.has(key)) {
    return { next: { type: 'find', find: key as FindType, count } }
  }
  if (key === 'g') return { next: { type: 'g', count } }
  if (key === 'r') return { next: { type: 'replace', count } }
  if (key === '>' || key === '<') {
    return { next: { type: 'indent', dir: key, count } }
  }
  if (key === '~') return { execute: () => executeToggleCase(count, ctx) }
  if (key === 'x') return { execute: () => executeX(count, ctx) }
  if (key === 'J') return { execute: () => executeJoin(count, ctx) }
  if (key === 'p' || key === 'P') {
    return { execute: () => executePaste(key === 'p', count, ctx) }
  }
  if (key === 'D') {
    return { execute: () => executeOperatorMotion('delete', '$', 1, ctx) }
  }
  if (key === 'C') {
    return { execute: () => executeOperatorMotion('change', '$', 1, ctx) }
  }
  if (key === 'Y') {
    return { execute: () => executeLineOp('yank', count, ctx) }
  }
  if (key === 'G') {
    return {
      execute: () => {
        if (count === 1) {
          ctx.setOffset(startOfLastLine(ctx.text))
        } else {
          ctx.setOffset(goToLine(ctx.text, count))
        }
      },
    }
  }
  if (key === '.') return { execute: () => ctx.onDotRepeat?.() }
  if (key === ';' || key === ',') {
    return { execute: () => repeatFind(key === ',', count, ctx) }
  }
  if (key === 'u') return { execute: () => ctx.onUndo?.() }
  if (key === 'i') {
    return { execute: () => ctx.enterInsert(ctx.offset) }
  }
  if (key === 'I') {
    return {
      execute: () => ctx.enterInsert(firstNonBlank(ctx.text, ctx.offset)),
    }
  }
  if (key === 'a') {
    return {
      execute: () => {
        const pos =
          ctx.offset >= ctx.text.length - 1 ? ctx.offset : ctx.offset + 1
        ctx.enterInsert(pos)
      },
    }
  }
  if (key === 'A') {
    return {
      execute: () => ctx.enterInsert(endOfLine(ctx.text, ctx.offset) + 1),
    }
  }
  if (key === 'o') {
    return { execute: () => executeOpenLine('below', ctx) }
  }
  if (key === 'O') {
    return { execute: () => executeOpenLine('above', ctx) }
  }
  return null
}

function dispatchOperatorMotion(
  op: Operator,
  count: number,
  key: string,
  ctx: TransitionContext,
): TransitionResult | null {
  if (isTextObjScopeKey(key)) {
    return {
      next: {
        type: 'operatorTextObj',
        op,
        count,
        scope: TEXT_OBJ_SCOPES[key],
      },
    }
  }
  if (FIND_KEYS.has(key)) {
    return {
      next: { type: 'operatorFind', op, count, find: key as FindType },
    }
  }
  if (SIMPLE_MOTIONS.has(key)) {
    return { execute: () => executeOperatorMotion(op, key, count, ctx) }
  }
  if (key === 'G') {
    return { execute: () => executeOperatorG(op, count, ctx) }
  }
  if (key === 'g') {
    return { next: { type: 'operatorG', op, count } }
  }
  return null
}

function handleIdle(key: string, ctx: TransitionContext): TransitionResult {
  if (/[1-9]/.test(key)) {
    return { next: { type: 'count', digits: key } }
  }
  if (key === '0') {
    return { execute: () => ctx.setOffset(startOfLine(ctx.text, ctx.offset)) }
  }
  return dispatchNormalKey(key, 1, ctx) ?? {}
}

function handleCount(
  state: Extract<CommandState, { type: 'count' }>,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  if (/[0-9]/.test(key)) {
    const digits = state.digits + key
    const value = Math.min(parseInt(digits, 10), MAX_VIM_COUNT)
    return { next: { type: 'count', digits: String(value) } }
  }
  const count = parseInt(state.digits, 10)
  return dispatchNormalKey(key, count, ctx) ?? { next: { type: 'idle' } }
}

function handleOperator(
  state: Extract<CommandState, { type: 'operator' }>,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  if (key === state.op[0]) {
    return { execute: () => executeLineOp(state.op, state.count, ctx) }
  }
  if (/[0-9]/.test(key)) {
    return {
      next: {
        type: 'operatorCount',
        op: state.op,
        count: state.count,
        digits: key,
      },
    }
  }
  return (
    dispatchOperatorMotion(state.op, state.count, key, ctx) ?? {
      next: { type: 'idle' },
    }
  )
}

function handleOperatorCount(
  state: Extract<CommandState, { type: 'operatorCount' }>,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  if (/[0-9]/.test(key)) {
    const digits = state.digits + key
    const value = Math.min(parseInt(digits, 10), MAX_VIM_COUNT)
    return { next: { ...state, digits: String(value) } }
  }
  const innerCount = parseInt(state.digits, 10)
  const totalCount = state.count * innerCount
  return (
    dispatchOperatorMotion(state.op, totalCount, key, ctx) ?? {
      next: { type: 'idle' },
    }
  )
}

function handleOperatorFind(
  state: Extract<CommandState, { type: 'operatorFind' }>,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  return {
    execute: () =>
      executeOperatorFind(state.op, state.find, key, state.count, ctx),
  }
}

function handleOperatorTextObj(
  state: Extract<CommandState, { type: 'operatorTextObj' }>,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  if (TEXT_OBJ_TYPES.has(key)) {
    return {
      execute: () =>
        executeOperatorTextObj(state.op, state.scope, key, state.count, ctx),
    }
  }
  return { next: { type: 'idle' } }
}

function handleFind(
  state: Extract<CommandState, { type: 'find' }>,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  return {
    execute: () => {
      const target = findCharacter(
        ctx.text,
        ctx.offset,
        key,
        state.find,
        state.count,
      )
      if (target !== null) {
        ctx.setOffset(target)
        ctx.setLastFind(state.find, key)
      }
    },
  }
}

function handleG(
  state: Extract<CommandState, { type: 'g' }>,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  if (key === 'g') {
    if (state.count > 1) {
      return {
        execute: () => ctx.setOffset(goToLine(ctx.text, state.count)),
      }
    }
    return { execute: () => ctx.setOffset(startOfFirstLine()) }
  }
  return { next: { type: 'idle' } }
}

function handleOperatorG(
  state: Extract<CommandState, { type: 'operatorG' }>,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  if (key === 'g') {
    return {
      execute: () => executeOperatorGg(state.op, state.count, ctx),
    }
  }
  return { next: { type: 'idle' } }
}

function handleReplace(
  state: Extract<CommandState, { type: 'replace' }>,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  return { execute: () => executeReplace(key, state.count, ctx) }
}

function handleIndent(
  state: Extract<CommandState, { type: 'indent' }>,
  key: string,
  ctx: TransitionContext,
): TransitionResult {
  if (key === state.dir) {
    return { execute: () => executeIndent(state.dir, state.count, ctx) }
  }
  return { next: { type: 'idle' } }
}

function repeatFind(
  reverse: boolean,
  count: number,
  ctx: TransitionContext,
): void {
  const last = ctx.getLastFind()
  if (!last) return
  let findType = last.type
  if (reverse) {
    findType = ({ f: 'F', F: 'f', t: 'T', T: 't' } as const)[findType]
  }
  const target = findCharacter(ctx.text, ctx.offset, last.char, findType, count)
  if (target !== null) ctx.setOffset(target)
}

function endOfLine(text: string, offset: number): number {
  const lineEnd = text.indexOf('\n', offset)
  if (lineEnd === -1) return Math.max(0, text.length - 1)
  return Math.max(0, lineEnd - 1)
}

export function handleVimKey(
  state: VimState,
  key: string,
  persistent: PersistentState,
  ctx: TransitionContext,
): VimState {
  if (state.mode === 'INSERT') {
    if (key === 'escape') {
      if (state.insertedText.length > 0) {
        ctx.recordChange({ type: 'insert', text: state.insertedText })
      }
      const newOffset = Math.max(0, ctx.offset - 1)
      ctx.setOffset(newOffset)
      return { mode: 'NORMAL', command: { type: 'idle' } }
    }
    return { mode: 'INSERT', insertedText: state.insertedText + key }
  }

  if (key === 'escape') {
    return { mode: 'NORMAL', command: { type: 'idle' } }
  }

  const wrappedCtx: TransitionContext = {
    ...ctx,
    getLastFind: () => persistent.lastFind,
    setLastFind: (type, char) => {
      persistent.lastFind = { type, char }
    },
    getRegister: () => persistent.register,
    getRegisterIsLinewise: () => persistent.registerIsLinewise,
    setRegister: (content, linewise) => {
      persistent.register = content
      persistent.registerIsLinewise = linewise
    },
    recordChange: (change) => {
      persistent.lastChange = change
      ctx.recordChange(change)
    },
    enterInsert: (offset) => {
      ctx.enterInsert(offset)
    },
  }

  const result = processNormalKey(state.command, key, wrappedCtx)

  if (result.execute) {
    result.execute()
    return { mode: 'NORMAL', command: { type: 'idle' } }
  }

  if (result.next) {
    return { mode: 'NORMAL', command: result.next }
  }

  return state
}
