/**
 * 全局快捷键管理 Hook
 * 实现 Ctrl+O, Ctrl+T, Ctrl+S, Ctrl+Z, Ctrl+_, Ctrl+G 等全局快捷键
 * v2.1.18: 支持可自定义的键盘快捷键配置
 */

import { useInput } from 'ink';
import { useCallback, useRef, useState, useEffect } from 'react';
import type { UserConfig } from '../../config/index.js';
import {
  getKeybindings,
  onKeybindingsChange,
  initKeybindings,
  getContextBindings,
  parseKeyString as parseKeybindingString,
  type KeybindingContext,
  type KeybindingsLoadResult,
} from '../../config/keybindings.js';
import { isBackgroundTasksDisabled } from '../../utils/env-check.js';
import {
  editInExternalEditor,
  getDefaultEditor,
  type ExternalEditorResult,
} from '../../utils/index.js';

// 重新导出 ExternalEditorResult 类型，方便外部使用
export type { ExternalEditorResult };

export interface GlobalKeybinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  handler: () => void | Promise<void>;
  description: string;
  category?: string;
  enabled?: () => boolean;
}

export interface UseGlobalKeybindingsOptions {
  config?: UserConfig;
  onVerboseToggle?: () => void;
  onTodosToggle?: () => void;
  onModelSwitch?: () => void;
  onStashPrompt?: (prompt: string) => void;
  onUndo?: () => void;
  onThinkingToggle?: () => void;
  onBackgroundTask?: () => void; // 后台运行当前任务
  onExternalEditor?: (result: ExternalEditorResult) => void; // 外部编辑器回调
  onEditorError?: (error: string) => void; // 编辑器错误显示回调 (v2.1.6)
  getCurrentInput?: () => string;
  setCurrentInput?: (value: string) => void; // 设置输入内容
  disabled?: boolean;
}

export function useGlobalKeybindings(options: UseGlobalKeybindingsOptions) {
  const {
    config,
    onVerboseToggle,
    onTodosToggle,
    onModelSwitch,
    onStashPrompt,
    onUndo,
    onThinkingToggle,
    onBackgroundTask,
    onExternalEditor,
    onEditorError,
    getCurrentInput,
    setCurrentInput,
    disabled = false,
  } = options;

  const [isProcessing, setIsProcessing] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const stashedPromptRef = useRef<string>('');

  // v2.1.18: 管理 keybindings 配置状态
  const [keybindingsConfig, setKeybindingsConfig] = useState<KeybindingsLoadResult>(() => getKeybindings());
  const [keybindingsReloaded, setKeybindingsReloaded] = useState(false);

  // 初始化 keybindings 并监听变化
  useEffect(() => {
    // 异步初始化
    initKeybindings().then((result) => {
      setKeybindingsConfig(result);
    });

    // 监听配置变化
    const unsubscribe = onKeybindingsChange((result) => {
      setKeybindingsConfig(result);
      setKeybindingsReloaded(true);
      // 3秒后清除重载标志
      setTimeout(() => setKeybindingsReloaded(false), 3000);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // 内置快捷键映射
  const builtinKeybindings: GlobalKeybinding[] = [
    {
      key: 'o',
      ctrl: true,
      handler: () => onVerboseToggle?.(),
      description: 'Toggle verbose output',
      category: 'Display',
    },
    {
      key: 't',
      ctrl: true,
      handler: () => onTodosToggle?.(),
      description: 'Show/hide todos',
      category: 'Display',
    },
    {
      key: 's',
      ctrl: true,
      handler: () => {
        const prompt = getCurrentInput ? getCurrentInput() : '';
        stashedPromptRef.current = prompt;
        onStashPrompt?.(prompt);
      },
      description: 'Stash current prompt',
      category: 'Edit',
    },
    {
      key: '_',
      ctrl: true,
      handler: () => onUndo?.(),
      description: 'Undo last input',
      category: 'Edit',
    },
    {
      key: 'z',
      ctrl: true,
      handler: () => {
        // 仅在 Linux/macOS 上启用
        if (process.platform !== 'win32') {
          process.kill(process.pid, 'SIGTSTP');
        }
      },
      description: 'Suspend Axon (Linux/macOS)',
      category: 'System',
      enabled: () => process.platform !== 'win32',
    },
    {
      key: 'm',
      ctrl: true,
      handler: () => onModelSwitch?.(),
      description: 'Switch model',
      category: 'System',
    },
    {
      key: 'p',
      alt: true,
      handler: () => onModelSwitch?.(),
      description: 'Switch model (Alt+P)',
      category: 'System',
    },
    {
      key: 't',
      alt: true,
      handler: () => onThinkingToggle?.(),
      description: 'Toggle extended thinking',
      category: 'System',
    },
    {
      key: 'b',
      ctrl: true,
      handler: () => onBackgroundTask?.(),
      description: 'Move current task to background (Ctrl+B)',
      category: 'System',
      enabled: () => !isBackgroundTasksDisabled(),
    },
    {
      key: 'g',
      ctrl: true,
      handler: async () => {
        // 清除之前的错误
        setEditorError(null);

        // 获取当前输入内容
        const currentContent = getCurrentInput ? getCurrentInput() : '';

        // 调用外部编辑器
        const result = await editInExternalEditor(currentContent);

        if (result.success) {
          // 编辑成功，更新输入内容
          if (setCurrentInput && result.content !== undefined) {
            setCurrentInput(result.content);
          }
          onExternalEditor?.(result);
        } else {
          // 编辑失败，显示错误信息 (v2.1.6 新功能)
          const errorMsg = result.error || 'Unknown editor error';
          setEditorError(errorMsg);
          onEditorError?.(errorMsg);

          // 5秒后自动清除错误信息
          setTimeout(() => {
            setEditorError(null);
          }, 5000);
        }
      },
      description: 'Open in external editor (Ctrl+G)',
      category: 'Edit',
    },
  ];

  // 合并自定义键绑定
  const customKeybindings = parseCustomKeybindings(
    config?.terminal?.keybindings || {}
  );

  const allKeybindings = [...builtinKeybindings, ...customKeybindings];

  // 匹配按键
  const matchKeybinding = useCallback(
    (input: string, key: any): GlobalKeybinding | undefined => {
      return allKeybindings.find((kb) => {
        if (kb.enabled && !kb.enabled()) return false;

        const keyMatch = kb.key === input;
        const ctrlMatch = kb.ctrl ? key.ctrl === true : !key.ctrl;
        const shiftMatch = kb.shift ? key.shift === true : !key.shift;
        const altMatch = kb.alt ? key.alt === true : !key.alt;
        const metaMatch = kb.meta ? key.meta === true : !key.meta;

        return keyMatch && ctrlMatch && shiftMatch && altMatch && metaMatch;
      });
    },
    [allKeybindings]
  );

  // 使用 Ink 的 useInput
  useInput(
    (input, key) => {
      if (disabled || isProcessing) return;

      const binding = matchKeybinding(input, key);
      if (binding) {
        setIsProcessing(true);
        Promise.resolve(binding.handler())
          .catch((error) => {
            console.error(`Keybinding error for ${binding.key}:`, error);
          })
          .finally(() => {
            setIsProcessing(false);
          });
      }
    },
    { isActive: !disabled }
  );

  return {
    keybindings: allKeybindings,
    stashedPrompt: stashedPromptRef.current,
    editorError, // v2.1.6: 编辑器错误信息
    clearEditorError: () => setEditorError(null), // 手动清除错误信息
    // v2.1.18: keybindings 配置
    keybindingsConfig,
    keybindingsReloaded,
    keybindingsWarnings: keybindingsConfig.warnings,
  };
}

// 解析自定义键绑定配置
function parseCustomKeybindings(
  config: Record<string, string>
): GlobalKeybinding[] {
  const bindings: GlobalKeybinding[] = [];

  for (const [action, keyString] of Object.entries(config)) {
    const parsed = parseKeyString(keyString);
    if (parsed) {
      bindings.push({
        ...parsed,
        handler: createActionHandler(action),
        description: `Custom: ${action}`,
        category: 'Custom',
      });
    }
  }

  return bindings;
}

// 解析键盘字符串 (e.g., "ctrl+shift+k")
function parseKeyString(keyString: string): {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
} | null {
  const parts = keyString.toLowerCase().split('+');
  const key = parts[parts.length - 1];

  if (!key) return null;

  return {
    key,
    ctrl: parts.includes('ctrl') || parts.includes('control'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta') || parts.includes('cmd'),
  };
}

/**
 * 自定义动作注册表
 * 存储已注册的自定义动作处理器
 */
const customActionRegistry: Map<string, () => void | Promise<void>> = new Map();

/**
 * 注册自定义动作处理器
 * @param actionName 动作名称
 * @param handler 处理器函数
 */
export function registerCustomAction(
  actionName: string,
  handler: () => void | Promise<void>
): void {
  customActionRegistry.set(actionName, handler);
}

/**
 * 注销自定义动作处理器
 * @param actionName 动作名称
 */
export function unregisterCustomAction(actionName: string): boolean {
  return customActionRegistry.delete(actionName);
}

/**
 * 获取所有已注册的自定义动作
 */
export function getRegisteredActions(): string[] {
  return Array.from(customActionRegistry.keys());
}

/**
 * 内置动作映射表
 * 支持的内置动作及其描述
 */
const builtinActions: Record<string, { description: string; handler: () => void }> = {
  // 剪贴板操作
  'copy': {
    description: 'Copy selected content',
    handler: () => {
      // 复制操作由终端原生支持，此处仅作占位
      process.stdout.write('\x1b[?1004h'); // 启用焦点报告
    },
  },
  'paste': {
    description: 'Paste clipboard content',
    handler: () => {
      // 粘贴操作由终端原生支持，此处仅作占位
      process.stdout.write('\x1b[?1004l'); // 禁用焦点报告
    },
  },

  // 导航操作
  'scroll_up': {
    description: 'Scroll up',
    handler: () => {
      process.stdout.write('\x1b[1S'); // 向上滚动一行
    },
  },
  'scroll_down': {
    description: 'Scroll down',
    handler: () => {
      process.stdout.write('\x1b[1T'); // 向下滚动一行
    },
  },
  'scroll_page_up': {
    description: 'Page up',
    handler: () => {
      process.stdout.write('\x1b[10S'); // 向上滚动10行
    },
  },
  'scroll_page_down': {
    description: 'Page down',
    handler: () => {
      process.stdout.write('\x1b[10T'); // 向下滚动10行
    },
  },

  // 历史记录操作
  'history_prev': {
    description: 'Previous history entry',
    handler: () => {
      process.stdin.emit('keypress', '', { name: 'up' });
    },
  },
  'history_next': {
    description: 'Next history entry',
    handler: () => {
      process.stdin.emit('keypress', '', { name: 'down' });
    },
  },

  // 光标操作
  'cursor_home': {
    description: 'Move cursor to line start',
    handler: () => {
      process.stdout.write('\x1b[H');
    },
  },
  'cursor_end': {
    description: 'Move cursor to line end',
    handler: () => {
      process.stdout.write('\x1b[F');
    },
  },

  // 编辑操作
  'clear_line': {
    description: 'Clear current line',
    handler: () => {
      process.stdout.write('\x1b[2K\r');
    },
  },
  'clear_screen': {
    description: 'Clear screen',
    handler: () => {
      process.stdout.write('\x1b[2J\x1b[H');
    },
  },

  // 会话操作
  'new_session': {
    description: 'New session',
    handler: () => {
      // 触发新会话事件（需要上层组件监听）
      process.emit('AXON_NEW_SESSION' as any);
    },
  },
  'save_session': {
    description: 'Save current session',
    handler: () => {
      process.emit('AXON_SAVE_SESSION' as any);
    },
  },

  // 输出操作
  'toggle_output': {
    description: 'Toggle output display mode',
    handler: () => {
      process.emit('AXON_TOGGLE_OUTPUT' as any);
    },
  },
  'expand_output': {
    description: 'Expand all output',
    handler: () => {
      process.emit('AXON_EXPAND_OUTPUT' as any);
    },
  },
  'collapse_output': {
    description: 'Collapse all output',
    handler: () => {
      process.emit('AXON_COLLAPSE_OUTPUT' as any);
    },
  },

  // 外部编辑器操作 (v2.1.6)
  'external_editor': {
    description: 'Edit current input in external editor (Ctrl+G)',
    handler: () => {
      // 触发外部编辑器事件（由上层组件处理）
      (process as any).emit('AXON_EXTERNAL_EDITOR');
    },
  },
};

/**
 * 创建动作处理器
 * 根据 action 字符串查找并返回对应的处理函数
 *
 * 动作查找优先级:
 * 1. 用户自定义注册的动作 (customActionRegistry)
 * 2. 内置动作 (builtinActions)
 * 3. shell 命令执行 (以 "shell:" 前缀开头)
 * 4. 事件触发 (以 "emit:" 前缀开头)
 * 5. 未知动作（输出警告）
 */
function createActionHandler(action: string): () => void {
  return () => {
    // 1. 查找用户自定义注册的动作
    const customHandler = customActionRegistry.get(action);
    if (customHandler) {
      try {
        const result = customHandler();
        // 如果是 Promise，添加错误处理
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error(`[Keybinding] Custom action execution failed "${action}":`, err);
          });
        }
      } catch (err) {
        console.error(`[Keybinding] Custom action execution failed "${action}":`, err);
      }
      return;
    }

    // 2. 查找内置动作
    const builtinAction = builtinActions[action];
    if (builtinAction) {
      try {
        builtinAction.handler();
      } catch (err) {
        console.error(`[Keybinding] Built-in action execution failed "${action}":`, err);
      }
      return;
    }

    // 3. 处理 shell 命令 (以 "shell:" 前缀开头)
    // 格式: shell:command args
    // 示例: shell:git status
    if (action.startsWith('shell:')) {
      const command = action.slice(6).trim();
      if (command) {
        // 触发 shell 命令执行事件（由上层组件处理）
        // 使用类型断言绕过 process.emit 的类型检查
        (process as any).emit('AXON_SHELL_COMMAND', command);
        return;
      }
    }

    // 4. 处理事件触发 (以 "emit:" 前缀开头)
    // 格式: emit:EVENT_NAME[:payload]
    // 示例: emit:CUSTOM_EVENT:data
    if (action.startsWith('emit:')) {
      const parts = action.slice(5).split(':');
      const eventName = parts[0];
      const payload = parts.slice(1).join(':') || undefined;

      if (eventName) {
        // 使用类型断言绕过 process.emit 的类型检查
        (process as any).emit(eventName, payload);
        return;
      }
    }

    // 5. 处理 URL 打开 (以 "open:" 前缀开头)
    // 格式: open:https://example.com
    if (action.startsWith('open:')) {
      const url = action.slice(5).trim();
      if (url) {
        // 使用类型断言绕过 process.emit 的类型检查
        (process as any).emit('AXON_OPEN_URL', url);
        return;
      }
    }

    // 6. 处理斜杠命令 (以 "/" 开头)
    // 格式: /command args
    // 示例: /help, /clear, /model opus
    if (action.startsWith('/')) {
      const command = action.trim();
      // 使用类型断言绕过 process.emit 的类型检查
      (process as any).emit('AXON_SLASH_COMMAND', command);
      return;
    }

    // 未知动作，输出警告
    console.warn(`[Keybinding] Unknown action: "${action}", please check keybinding configuration`);
    console.warn(
      `[Keybinding] Available built-in actions: ${Object.keys(builtinActions).join(', ')}`
    );
    console.warn(
      `[Keybinding] Registered custom actions: ${getRegisteredActions().join(', ') || '(none)'}`
    );
  };
}
