export {
  type VimState,
  type CommandState,
  type PersistentState,
  type RecordedChange,
  type Operator,
  type FindType,
  type TextObjScope,
  OPERATORS,
  SIMPLE_MOTIONS,
  FIND_KEYS,
  TEXT_OBJ_SCOPES,
  TEXT_OBJ_TYPES,
  MAX_VIM_COUNT,
  isOperatorKey,
  isTextObjScopeKey,
  createInitialVimState,
  createInitialPersistentState,
} from './types.js'

export {
  resolveMotion,
  findCharacter,
  isInclusiveMotion,
  isLinewiseMotion,
  offsetToLineCol,
  lineColToOffset,
  goToLine,
  startOfLine,
  firstNonBlank,
  startOfLastLine,
  startOfFirstLine,
  countNewlinesBefore,
} from './motions.js'

export {
  type OperatorContext,
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
} from './operators.js'

export { type TextObjectRange, findTextObject } from './textObjects.js'

export {
  type TransitionResult,
  type TransitionContext,
  processNormalKey,
  handleVimKey,
} from './transitions.js'
