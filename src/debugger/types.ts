export interface Breakpoint {
  id: number;
  file: string;
  line: number;
  condition?: string;
  hitCondition?: string;
  verified: boolean;
  message?: string;
}

export interface StackFrame {
  id: number;
  name: string;
  file: string;
  line: number;
  column: number;
}

export interface Scope {
  name: string;
  variablesReference: number;
  expensive: boolean;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  indexedVariables?: number;
  namedVariables?: number;
}

export interface DebugSession {
  id: string;
  runtime: 'node' | 'python';
  program: string;
  pid?: number;
  state: 'initializing' | 'running' | 'paused' | 'terminated';
  breakpoints: Breakpoint[];
  currentFrame?: StackFrame;
}

export interface DebuggerInput {
  action: 'launch' | 'attach' | 'disconnect' | 'set_breakpoint' | 'remove_breakpoint' | 'list_breakpoints' | 'continue' | 'step_over' | 'step_into' | 'step_out' | 'pause' | 'stack_trace' | 'scopes' | 'variables' | 'evaluate' | 'threads';
  program?: string;
  args?: string[];
  runtime?: 'node' | 'python';
  cwd?: string;
  env?: Record<string, string>;
  host?: string;
  port?: number;
  file?: string;
  line?: number;
  condition?: string;
  hitCondition?: string;
  breakpointId?: number;
  frameId?: number;
  variablesReference?: number;
  expression?: string;
  context?: 'watch' | 'repl' | 'hover';
  timeout?: number;
}
