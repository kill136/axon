/**
 * Input 组件
 * 用户输入框 - 仿官方 Claude Code 风格
 * 支持斜杠命令、文件路径、@mention 自动补全
 *
 * v2.1.6: 添加 Kitty 键盘协议支持
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { getCompletions, applyCompletion, type CompletionItem, truncateDescription, getCompletionIcon } from '../autocomplete/index.js';
import { getHistoryManager } from '../utils/history-manager.js';
import { HistorySearch } from './HistorySearch.js';
import {
  isShiftEnter,
  isShiftTab,
  parseKittyKey,
} from '../utils/kitty-keyboard.js';
import { t } from '../../i18n/index.js';

// 官方 claude 颜色
const CLAUDE_COLOR = '#D77757';

// 权限快捷模式类型 - 官方 v2.1.2
export type QuickPermissionMode = 'default' | 'acceptEdits' | 'plan';

interface InputProps {
  prompt?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  suggestion?: string;
  /** 双击 ESC 触发 Rewind 的回调 */
  onRewindRequest?: () => void;
  /** Shift+Tab 权限模式切换回调 - 官方 v2.1.2 */
  onPermissionModeChange?: (mode: QuickPermissionMode) => void;
  /** 当前权限模式 */
  permissionMode?: QuickPermissionMode;
}

// 双击检测间隔（毫秒）
const DOUBLE_PRESS_INTERVAL = 300;

export const Input: React.FC<InputProps> = ({
  prompt = '> ',
  placeholder = '',
  onSubmit,
  disabled = false,
  suggestion,
  onRewindRequest,
  onPermissionModeChange,
  permissionMode = 'default',
}) => {
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedCompletionIndex, setSelectedCompletionIndex] = useState(0);
  const [completions, setCompletions] = useState<CompletionItem[]>([]);
  const [completionType, setCompletionType] = useState<'command' | 'file' | 'mention' | 'directory' | 'bash-history' | 'none'>('none');

  // Vim 模式支持
  const [vimModeEnabled, setVimModeEnabled] = useState(process.env.CLAUDE_CODE_VIM_MODE === 'true');
  const [vimNormalMode, setVimNormalMode] = useState(vimModeEnabled);
  const [undoStack, setUndoStack] = useState<Array<{ value: string; cursor: number }>>([]);
  const [lastDeletedText, setLastDeletedText] = useState('');
  const [pendingCommand, setPendingCommand] = useState(''); // For multi-key commands like dd, >>, etc.
  const [yankRegister, setYankRegister] = useState<string>(''); // Yank register for y/p
  const [replaceMode, setReplaceMode] = useState(false); // For 'r' command
  const [lastFind, setLastFind] = useState<{ type: 'f' | 'F' | 't' | 'T'; char: string } | null>(null); // For ; and , repeat

  // IME (输入法编辑器) 组合状态支持
  const [isComposing, setIsComposing] = useState(false);
  const compositionTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  // Ctrl+R 反向历史搜索
  const [reverseSearchMode, setReverseSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<string[]>([]);
  const [searchIndex, setSearchIndex] = useState(0);
  // 双击 ESC 检测
  const lastEscPressTimeRef = React.useRef<number>(0);

  const [searchOriginalValue, setSearchOriginalValue] = useState('');
  const historyManager = useMemo(() => getHistoryManager(), []);

  // 初始化：从持久化存储加载历史记录
  useEffect(() => {
    const loadedHistory = historyManager.getHistory();
    setHistory(loadedHistory);
  }, [historyManager]);

  // 监听环境变量变化（通过轮询检测）
  useEffect(() => {
    const checkVimMode = () => {
      const newVimMode = process.env.CLAUDE_CODE_VIM_MODE === 'true';
      if (newVimMode !== vimModeEnabled) {
        setVimModeEnabled(newVimMode);
        setVimNormalMode(newVimMode); // 启用时默认进入 Normal 模式
      }
    };

    const interval = setInterval(checkVimMode, 500); // 每500ms检查一次
    return () => clearInterval(interval);
  }, [vimModeEnabled]);

  // 反向搜索：当搜索查询变化时更新匹配结果
  useEffect(() => {
    if (reverseSearchMode) {
      const matches = historyManager.search(searchQuery);
      setSearchMatches(matches);
      setSearchIndex(0);
    }
  }, [searchQuery, reverseSearchMode, historyManager]);

  // 获取自动补全建议
  useEffect(() => {
    const fetchCompletions = async () => {
      const result = await getCompletions({
        fullText: value,
        cursorPosition: cursor,
        cwd: process.cwd(),
        enableFileCompletion: true,
        enableMentionCompletion: true,
      });

      setCompletions(result.items);
      setCompletionType(result.type);
      setSelectedCompletionIndex(0);
    };

    fetchCompletions();
  }, [value, cursor]);

  // 显示补全列表
  const showCompletionList = completions.length > 0 && completionType !== 'none';

  // IME 辅助函数
  // 检测字符是否为 CJK（中日韩）字符
  const isCJKChar = (char: string): boolean => {
    if (!char || char.length === 0) return false;
    const code = char.charCodeAt(0);
    // CJK 统一表意文字: U+4E00-U+9FFF
    // CJK 扩展 A: U+3400-U+4DBF
    // 日文假名: U+3040-U+309F (平假名), U+30A0-U+30FF (片假名)
    // 韩文音节: U+AC00-U+D7AF
    return (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x309f) ||
      (code >= 0x30a0 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    );
  };

  // 开始组合输入（检测到 CJK 字符输入时）
  const startComposition = () => {
    setIsComposing(true);
    // 清除之前的定时器
    if (compositionTimerRef.current) {
      clearTimeout(compositionTimerRef.current);
    }
  };

  // 延迟结束组合（等待可能的后续输入）
  const scheduleEndComposition = () => {
    if (compositionTimerRef.current) {
      clearTimeout(compositionTimerRef.current);
    }
    // 500ms 后自动结束组合状态
    compositionTimerRef.current = setTimeout(() => {
      setIsComposing(false);
    }, 500);
  };

  // 立即结束组合
  const endComposition = () => {
    if (compositionTimerRef.current) {
      clearTimeout(compositionTimerRef.current);
      compositionTimerRef.current = null;
    }
    setIsComposing(false);
  };

  // 清理定时器
  useEffect(() => {
    return () => {
      if (compositionTimerRef.current) {
        clearTimeout(compositionTimerRef.current);
      }
    };
  }, []);

  // Vim 辅助函数
  const saveToUndoStack = () => {
    setUndoStack(prev => [...prev, { value, cursor }].slice(-50)); // 保留最近50个状态
  };

  const undo = () => {
    if (undoStack.length > 0) {
      const lastState = undoStack[undoStack.length - 1];
      setValue(lastState.value);
      setCursor(lastState.cursor);
      setUndoStack(prev => prev.slice(0, -1));
    }
  };

  // 单词导航辅助函数
  const findNextWordStart = (text: string, pos: number): number => {
    let i = pos;
    // 跳过当前单词
    while (i < text.length && /\S/.test(text[i])) i++;
    // 跳过空格
    while (i < text.length && /\s/.test(text[i])) i++;
    return Math.min(i, text.length);
  };

  const findPrevWordStart = (text: string, pos: number): number => {
    let i = pos - 1;
    // 跳过空格
    while (i >= 0 && /\s/.test(text[i])) i--;
    // 跳过单词
    while (i >= 0 && /\S/.test(text[i])) i--;
    return Math.max(0, i + 1);
  };

  const findWordEnd = (text: string, pos: number): number => {
    let i = pos;
    // 如果在空格上，先跳到下一个单词
    if (i < text.length && /\s/.test(text[i])) {
      while (i < text.length && /\s/.test(text[i])) i++;
    }
    // 跳到单词末尾
    while (i < text.length && /\S/.test(text[i])) i++;
    return Math.min(i - 1, text.length - 1);
  };

  // f/F/t/T 字符查找
  const findChar = (text: string, pos: number, char: string, forward: boolean, till: boolean): number => {
    if (forward) {
      // f or t - 向前查找
      const startPos = pos + 1;
      const foundIndex = text.indexOf(char, startPos);
      if (foundIndex === -1) return pos;
      return till ? foundIndex - 1 : foundIndex;
    } else {
      // F or T - 向后查找
      const beforeText = text.slice(0, pos);
      const foundIndex = beforeText.lastIndexOf(char);
      if (foundIndex === -1) return pos;
      return till ? foundIndex + 1 : foundIndex;
    }
  };

  // Text object 查找
  const findTextObject = (
    text: string,
    cursor: number,
    type: 'i' | 'a', // inner or around
    boundary: 'w' | 'W' | '"' | "'" | '(' | '[' | '{'
  ): { start: number; end: number } | null => {
    // 处理单词 text objects
    if (boundary === 'w') {
      // 查找当前单词边界
      let start = cursor;
      let end = cursor;

      // 向前查找单词开始
      while (start > 0 && /\S/.test(text[start - 1])) start--;
      // 向后查找单词结束
      while (end < text.length && /\S/.test(text[end])) end++;

      if (type === 'a') {
        // a word - 包括后面的空格
        while (end < text.length && /\s/.test(text[end])) end++;
      }

      return { start, end };
    }

    if (boundary === 'W') {
      // WORD (空格分隔)
      let start = cursor;
      let end = cursor;

      while (start > 0 && !/\s/.test(text[start - 1])) start--;
      while (end < text.length && !/\s/.test(text[end])) end++;

      if (type === 'a') {
        while (end < text.length && /\s/.test(text[end])) end++;
      }

      return { start, end };
    }

    // 处理引号和括号 text objects
    const pairs: Record<string, { open: string; close: string }> = {
      '"': { open: '"', close: '"' },
      "'": { open: "'", close: "'" },
      '(': { open: '(', close: ')' },
      '[': { open: '[', close: ']' },
      '{': { open: '{', close: '}' }
    };

    const pair = pairs[boundary];
    if (!pair) return null;

    // 查找匹配的括号/引号对
    let start = -1;
    let end = -1;

    if (pair.open === pair.close) {
      // 引号类型 - 找到包围光标的引号对
      let firstQuote = -1;
      let inQuote = false;

      for (let i = 0; i <= cursor; i++) {
        if (text[i] === pair.open) {
          if (!inQuote) {
            firstQuote = i;
            inQuote = true;
          } else {
            inQuote = false;
          }
        }
      }

      if (inQuote) {
        start = firstQuote;
        // 查找匹配的结束引号
        for (let i = start + 1; i < text.length; i++) {
          if (text[i] === pair.close) {
            end = i;
            break;
          }
        }
      }
    } else {
      // 括号类型 - 找到最近的包围光标的括号对
      let depth = 0;
      let found = false;

      // 先向左查找开括号
      for (let i = cursor; i >= 0; i--) {
        if (text[i] === pair.close) depth++;
        if (text[i] === pair.open) {
          if (depth === 0) {
            start = i;
            found = true;
            break;
          }
          depth--;
        }
      }

      if (found) {
        // 向右查找对应的闭括号
        depth = 0;
        for (let i = start + 1; i < text.length; i++) {
          if (text[i] === pair.open) depth++;
          if (text[i] === pair.close) {
            if (depth === 0) {
              end = i;
              break;
            }
            depth--;
          }
        }
      }
    }

    if (start === -1 || end === -1) return null;

    if (type === 'i') {
      // inner - 不包括括号/引号
      return { start: start + 1, end };
    } else {
      // around - 包括括号/引号
      return { start, end: end + 1 };
    }
  };

  useInput(
    (input, key) => {
      if (disabled) return;

      // 检测 Shift+Enter 的转义序列
      // v2.1.6: 支持 Kitty 键盘协议 (CSI 13;2 u) 和传统格式 (\x1b\r)
      // 需要终端配置支持（详见 /terminal-setup 命令）
      if (isShiftEnter(input) || (input === '\x1b' && key.return)) {
        // 插入换行符而非提交
        if (vimModeEnabled) saveToUndoStack();
        setValue((prev) => {
          const before = prev.slice(0, cursor);
          const after = prev.slice(cursor);
          return before + '\n' + after;
        });
        setCursor((prev) => prev + 1);
        return;
      }

      // ===== Shift+Tab 权限模式快捷切换 (官方 v2.1.2) =====
      // v2.1.6: 支持 Kitty 键盘协议 (CSI 9;2 u) 和传统格式 (\x1b[Z)
      // 循环切换：default → acceptEdits → plan → default
      if ((key.tab && key.shift) || isShiftTab(input)) {
        if (onPermissionModeChange) {
          // 根据当前模式切换到下一个模式（循环）
          const nextMode: QuickPermissionMode =
            permissionMode === 'default' ? 'acceptEdits' :
            permissionMode === 'acceptEdits' ? 'plan' :
            'default';
          onPermissionModeChange(nextMode);
        }
        return;
      }

      // ===== Ctrl+R 反向历史搜索模式处理 =====
      if (reverseSearchMode) {
        // ESC - 退出搜索模式，恢复原始值
        if (key.escape) {
          setValue(searchOriginalValue);
          setCursor(searchOriginalValue.length);
          setReverseSearchMode(false);
          setSearchQuery('');
          setSearchMatches([]);
          setSearchIndex(0);
          return;
        }

        // Enter - 选择当前匹配项
        if (key.return) {
          if (searchMatches.length > 0) {
            const selected = searchMatches[searchIndex];
            setValue(selected);
            setCursor(selected.length);
          }
          setReverseSearchMode(false);
          setSearchQuery('');
          setSearchMatches([]);
          setSearchIndex(0);
          return;
        }

        // Ctrl+R - 下一个匹配项（向后搜索）
        if (key.ctrl && input === 'r') {
          if (searchMatches.length > 0) {
            setSearchIndex((prev) => (prev + 1) % searchMatches.length);
          }
          return;
        }

        // Ctrl+S - 上一个匹配项（向前搜索）
        if (key.ctrl && input === 's') {
          if (searchMatches.length > 0) {
            setSearchIndex((prev) => (prev - 1 + searchMatches.length) % searchMatches.length);
          }
          return;
        }

        // Backspace - 删除搜索查询的最后一个字符
        if (key.backspace || key.delete) {
          setSearchQuery((prev) => prev.slice(0, -1));
          return;
        }

        // 其他字符 - 添加到搜索查询
        if (input && !key.ctrl && !key.meta) {
          setSearchQuery((prev) => prev + input);
          return;
        }

        return; // 在搜索模式下忽略其他按键
      }

      // Ctrl+R - 进入反向历史搜索模式（非搜索模式下）
      if (key.ctrl && input === 'r' && !reverseSearchMode) {
        setReverseSearchMode(true);
        setSearchOriginalValue(value);
        setSearchQuery('');
        const allMatches = historyManager.search('');
        setSearchMatches(allMatches);
        setSearchIndex(0);
        return;
      }

      // 在补全列表显示时的特殊处理
      if (showCompletionList && !vimNormalMode) {
        if (key.upArrow) {
          setSelectedCompletionIndex(prev =>
            prev > 0 ? prev - 1 : completions.length - 1
          );
          return;
        }
        if (key.downArrow) {
          setSelectedCompletionIndex(prev =>
            prev < completions.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (key.tab || key.return) {
          // Tab 或 Enter 补全选中的项
          const selectedCompletion = completions[selectedCompletionIndex];
          if (selectedCompletion) {
            // 应用补全
            const startPos = completionType === 'command' ? 0 :
              (value.lastIndexOf(' ', cursor - 1) + 1);
            const result = applyCompletion(
              value,
              selectedCompletion,
              startPos,
              cursor
            );

            // 如果是命令补全且按的是 Enter，应用后直接提交
            // v2.1.32: 修复当有前置文本时按 Enter 不应触发命令补全
            // 只有当文本以 / 开头（纯斜杠命令）时才自动提交
            if (key.return && completionType === 'command' && value.trimStart().startsWith('/')) {
              // IME 组合期间：先结束组合，然后继续提交
              if (isComposing) {
                endComposition();
              }
              const finalValue = result.newText.trim();
              if (finalValue) {
                onSubmit(finalValue);
                historyManager.addCommand(finalValue);
                setHistory(prev => [finalValue, ...prev.slice(0, 99)]);
                setValue('');
                setCursor(0);
                setHistoryIndex(-1);
                if (vimModeEnabled) {
                  setVimNormalMode(true);
                  setUndoStack([]);
                }
              }
            } else {
              // Tab 键或其他类型的补全：只应用补全不提交
              setValue(result.newText);
              setCursor(result.newCursor);
            }
            return;
          }
          // 没有选中的补全项时，如果是 Enter 键，不 return，让后面的提交逻辑处理
          if (key.tab) {
            return;
          }
          // 如果是 Enter 键且没有有效的补全项，继续执行后面的提交逻辑
        }
      }

      // ===== VIM 模式处理 =====
      if (vimModeEnabled && vimNormalMode) {
        // Normal 模式键绑定

        // ESC - 保持在 Normal 模式
        if (key.escape) {
          setPendingCommand('');
          return;
        }

        // 箭头键历史导航 (官方 2.1.20)
        // 当光标无法继续移动时，使用箭头键进行历史导航
        if (key.upArrow && !showCompletionList) {
          // 上箭头：当光标在行首或无法向上时，进行历史向上导航
          if (cursor === 0 || !value.includes('\n')) {
            if (history.length > 0 && historyIndex < history.length - 1) {
              const newIndex = historyIndex + 1;
              setHistoryIndex(newIndex);
              setValue(history[newIndex]);
              setCursor(Math.min(cursor, history[newIndex].length));
            }
            return;
          }
        }
        if (key.downArrow && !showCompletionList) {
          // 下箭头：当光标在行尾或无法向下时，进行历史向下导航
          if (cursor >= value.length - 1 || !value.includes('\n')) {
            if (historyIndex > 0) {
              const newIndex = historyIndex - 1;
              setHistoryIndex(newIndex);
              setValue(history[newIndex]);
              setCursor(Math.min(cursor, history[newIndex].length));
            } else if (historyIndex === 0) {
              setHistoryIndex(-1);
              setValue('');
              setCursor(0);
            }
            return;
          }
        }
        if (key.leftArrow) {
          // 左箭头：移动光标，同 h 键
          setCursor(prev => Math.max(0, prev - 1));
          return;
        }
        if (key.rightArrow) {
          // 右箭头：移动光标，同 l 键
          setCursor(prev => Math.min(value.length - 1, prev + 1));
          return;
        }

        // 处理多键命令（如 dd, yy, diw, ci", 等）
        if (pendingCommand === 'd') {
          if (input === 'd') {
            // dd - 删除整行
            saveToUndoStack();
            setLastDeletedText(value);
            setYankRegister(value); // 删除的内容也会被 yank
            setValue('');
            setCursor(0);
            setPendingCommand('');
            return;
          }
          // d + i/a (text objects)
          if (input === 'i' || input === 'a') {
            setPendingCommand('d' + input);
            return;
          }
          setPendingCommand('');
        }

        if (pendingCommand === 'y') {
          if (input === 'y') {
            // yy - 复制整行
            setYankRegister(value);
            setPendingCommand('');
            return;
          }
          // y + i/a (text objects)
          if (input === 'i' || input === 'a') {
            setPendingCommand('y' + input);
            return;
          }
          setPendingCommand('');
        }

        if (pendingCommand === 'c') {
          if (input === 'c') {
            // cc - 修改整行
            saveToUndoStack();
            setYankRegister(value);
            setValue('');
            setCursor(0);
            setVimNormalMode(false);
            setPendingCommand('');
            return;
          }
          // c + i/a (text objects)
          if (input === 'i' || input === 'a') {
            setPendingCommand('c' + input);
            return;
          }
          setPendingCommand('');
        }

        // 处理 text objects (diw, daw, di", da", ci(, ca[, etc.)
        if (pendingCommand.startsWith('d') && (pendingCommand === 'di' || pendingCommand === 'da')) {
          const type = pendingCommand[1] as 'i' | 'a';
          const boundary = input as 'w' | 'W' | '"' | "'" | '(' | '[' | '{';

          if (['w', 'W', '"', "'", '(', '[', '{'].includes(boundary)) {
            const range = findTextObject(value, cursor, type, boundary);
            if (range) {
              saveToUndoStack();
              const deletedText = value.slice(range.start, range.end);
              setLastDeletedText(deletedText);
              setYankRegister(deletedText);
              setValue(value.slice(0, range.start) + value.slice(range.end));
              setCursor(Math.max(0, Math.min(range.start, value.length - deletedText.length - 1)));
            }
            setPendingCommand('');
            return;
          }
          setPendingCommand('');
        }

        if (pendingCommand.startsWith('y') && (pendingCommand === 'yi' || pendingCommand === 'ya')) {
          const type = pendingCommand[1] as 'i' | 'a';
          const boundary = input as 'w' | 'W' | '"' | "'" | '(' | '[' | '{';

          if (['w', 'W', '"', "'", '(', '[', '{'].includes(boundary)) {
            const range = findTextObject(value, cursor, type, boundary);
            if (range) {
              const yankedText = value.slice(range.start, range.end);
              setYankRegister(yankedText);
            }
            setPendingCommand('');
            return;
          }
          setPendingCommand('');
        }

        if (pendingCommand.startsWith('c') && (pendingCommand === 'ci' || pendingCommand === 'ca')) {
          const type = pendingCommand[1] as 'i' | 'a';
          const boundary = input as 'w' | 'W' | '"' | "'" | '(' | '[' | '{';

          if (['w', 'W', '"', "'", '(', '[', '{'].includes(boundary)) {
            const range = findTextObject(value, cursor, type, boundary);
            if (range) {
              saveToUndoStack();
              const deletedText = value.slice(range.start, range.end);
              setYankRegister(deletedText);
              setValue(value.slice(0, range.start) + value.slice(range.end));
              setCursor(range.start);
              setVimNormalMode(false); // 进入插入模式
            }
            setPendingCommand('');
            return;
          }
          setPendingCommand('');
        }

        if (pendingCommand === 'r') {
          // r{char} - 替换当前字符
          if (input && input.length === 1 && cursor < value.length) {
            saveToUndoStack();
            setValue(value.slice(0, cursor) + input + value.slice(cursor + 1));
            setPendingCommand('');
          }
          return;
        }

        // f/F/t/T 字符查找
        if (pendingCommand === 'f' || pendingCommand === 'F' || pendingCommand === 't' || pendingCommand === 'T') {
          if (input && input.length === 1) {
            const forward = pendingCommand === 'f' || pendingCommand === 't';
            const till = pendingCommand === 't' || pendingCommand === 'T';
            const newPos = findChar(value, cursor, input, forward, till);
            if (newPos !== cursor) {
              setCursor(newPos);
              setLastFind({ type: pendingCommand, char: input });
            }
            setPendingCommand('');
          }
          return;
        }

        // 撤销
        if (input === 'u') {
          undo();
          return;
        }

        // 导航 - h, j, k, l
        if (input === 'h') {
          setCursor(prev => Math.max(0, prev - 1));
          return;
        }
        if (input === 'l') {
          setCursor(prev => Math.min(value.length - 1, prev + 1));
          return;
        }
        if (input === 'j' && !showCompletionList) {
          // j - 历史记录向下
          if (history.length > 0 && historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setValue(history[newIndex]);
            setCursor(Math.min(cursor, history[newIndex].length - 1));
          }
          return;
        }
        if (input === 'k' && !showCompletionList) {
          // k - 历史记录向上
          if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setValue(history[newIndex]);
            setCursor(Math.min(cursor, history[newIndex].length - 1));
          } else if (historyIndex === 0) {
            setHistoryIndex(-1);
            setValue('');
            setCursor(0);
          }
          return;
        }

        // 单词导航 - w, b, e
        if (input === 'w') {
          setCursor(findNextWordStart(value, cursor));
          return;
        }
        if (input === 'b') {
          setCursor(findPrevWordStart(value, cursor));
          return;
        }
        if (input === 'e') {
          setCursor(findWordEnd(value, cursor));
          return;
        }

        // 字符查找 - f, F, t, T
        if (input === 'f' || input === 'F' || input === 't' || input === 'T') {
          setPendingCommand(input);
          return;
        }

        // Indent/Dedent - >>, <<
        if (input === '>') {
          if (pendingCommand === '>') {
            // >> - 向右缩进（添加2个空格）
            saveToUndoStack();
            setValue('  ' + value);
            setCursor(cursor + 2);
            setPendingCommand('');
            return;
          }
          setPendingCommand('>');
          return;
        }
        if (input === '<') {
          if (pendingCommand === '<') {
            // << - 向左缩进（删除最多2个前导空格）
            saveToUndoStack();
            let newValue = value;
            let removed = 0;
            if (value.startsWith('  ')) {
              newValue = value.slice(2);
              removed = 2;
            } else if (value.startsWith(' ')) {
              newValue = value.slice(1);
              removed = 1;
            } else if (value.startsWith('\t')) {
              newValue = value.slice(1);
              removed = 1;
            }
            setValue(newValue);
            setCursor(Math.max(0, cursor - removed));
            setPendingCommand('');
            return;
          }
          setPendingCommand('<');
          return;
        }

        // 重复字符查找 - ; 和 ,
        if (input === ';' && lastFind) {
          // 重复上一次查找（正向）
          const forward = lastFind.type === 'f' || lastFind.type === 't';
          const till = lastFind.type === 't' || lastFind.type === 'T';
          const newPos = findChar(value, cursor, lastFind.char, forward, till);
          if (newPos !== cursor) {
            setCursor(newPos);
          }
          return;
        }
        if (input === ',' && lastFind) {
          // 重复上一次查找（反向）
          const forward = !(lastFind.type === 'f' || lastFind.type === 't');
          const till = lastFind.type === 't' || lastFind.type === 'T';
          const newPos = findChar(value, cursor, lastFind.char, forward, till);
          if (newPos !== cursor) {
            setCursor(newPos);
          }
          return;
        }

        // 行导航 - 0, $, ^
        if (input === '0') {
          setCursor(0);
          return;
        }
        if (input === '$') {
          setCursor(Math.max(0, value.length - 1));
          return;
        }
        if (input === '^') {
          // 移动到第一个非空白字符
          let pos = 0;
          while (pos < value.length && /\s/.test(value[pos])) pos++;
          setCursor(pos);
          return;
        }

        // Yank 操作 - y, yy
        if (input === 'y') {
          // y - 开始 yank 命令（等待第二个按键）
          setPendingCommand('y');
          return;
        }

        // Paste 操作 - p, P
        if (input === 'p') {
          // p - 在光标后粘贴
          if (yankRegister) {
            saveToUndoStack();
            const newValue = value.slice(0, cursor + 1) + yankRegister + value.slice(cursor + 1);
            setValue(newValue);
            setCursor(cursor + yankRegister.length);
          }
          return;
        }
        if (input === 'P') {
          // P - 在光标前粘贴
          if (yankRegister) {
            saveToUndoStack();
            const newValue = value.slice(0, cursor) + yankRegister + value.slice(cursor);
            setValue(newValue);
            setCursor(cursor + yankRegister.length - 1);
          }
          return;
        }

        // Replace 操作 - r
        if (input === 'r') {
          // r - 开始替换命令（等待字符）
          setPendingCommand('r');
          return;
        }

        // Join lines - J
        if (input === 'J') {
          // J - 合并当前行和下一行（如果有换行符）
          const newlineIndex = value.indexOf('\n', cursor);
          if (newlineIndex !== -1) {
            saveToUndoStack();
            // 删除换行符,并用空格连接
            const before = value.slice(0, newlineIndex);
            const after = value.slice(newlineIndex + 1);
            // 删除下一行的前导空格
            const afterTrimmed = after.replace(/^\s+/, '');
            setValue(before + (afterTrimmed ? ' ' + afterTrimmed : ''));
            setCursor(cursor);
          }
          return;
        }

        // Change 操作 - c, C
        if (input === 'c') {
          // c - 开始修改命令（等待第二个按键）
          setPendingCommand('c');
          return;
        }
        if (input === 'C') {
          // C - 修改到行尾（删除到行尾并进入插入模式）
          saveToUndoStack();
          setLastDeletedText(value.slice(cursor));
          setYankRegister(value.slice(cursor));
          setValue(value.slice(0, cursor));
          setVimNormalMode(false);
          return;
        }

        // 删除操作 - x, d, D
        if (input === 'x') {
          // x - 删除当前字符
          if (value.length > 0 && cursor < value.length) {
            saveToUndoStack();
            setLastDeletedText(value[cursor]);
            setYankRegister(value[cursor]);
            setValue(value.slice(0, cursor) + value.slice(cursor + 1));
            if (cursor >= value.length - 1 && cursor > 0) {
              setCursor(cursor - 1);
            }
          }
          return;
        }
        if (input === 'd') {
          // d - 开始删除命令（等待第二个按键）
          setPendingCommand('d');
          return;
        }
        if (input === 'D') {
          // D - 删除到行尾
          saveToUndoStack();
          setLastDeletedText(value.slice(cursor));
          setYankRegister(value.slice(cursor));
          setValue(value.slice(0, cursor));
          if (cursor > 0 && cursor >= value.length) {
            setCursor(cursor - 1);
          }
          return;
        }

        // 插入模式切换 - i, a, I, A, o, O
        if (input === 'i') {
          // i - 在光标前插入
          setVimNormalMode(false);
          return;
        }
        if (input === 'a') {
          // a - 在光标后插入
          setCursor(Math.min(value.length, cursor + 1));
          setVimNormalMode(false);
          return;
        }
        if (input === 'I') {
          // I - 在行首插入
          setCursor(0);
          setVimNormalMode(false);
          return;
        }
        if (input === 'A') {
          // A - 在行尾插入
          setCursor(value.length);
          setVimNormalMode(false);
          return;
        }
        if (input === 'o') {
          // o - 在下方新建行（对于单行输入，等同于 A）
          setCursor(value.length);
          setVimNormalMode(false);
          return;
        }
        if (input === 'O') {
          // O - 在上方新建行（对于单行输入，等同于 I）
          setCursor(0);
          setVimNormalMode(false);
          return;
        }

        // Enter - 提交
        if (key.return) {
          // IME 组合期间：先结束组合，然后继续提交（不再 return）
          if (isComposing) {
            endComposition();
          }
          if (value.trim()) {
            const trimmedValue = value.trim();
            onSubmit(trimmedValue);
            historyManager.addCommand(trimmedValue);
            setHistory(prev => [trimmedValue, ...prev.slice(0, 99)]);
            setValue('');
            setCursor(0);
            setHistoryIndex(-1);
            setUndoStack([]);
          }
          return;
        }

        return; // 在 Normal 模式下忽略其他输入
      }

      // ===== INSERT 模式或非 VIM 模式处理 =====

      // ESC 或 Ctrl+[ - 退出插入模式
      if (vimModeEnabled && !vimNormalMode) {
        if (key.escape || (key.ctrl && input === '[')) {
          setVimNormalMode(true);
          // Vim 惯例：退出插入模式时光标左移一位
          if (cursor > 0) {
            setCursor(cursor - 1);
          }
          return;
        }
      } else if (!vimModeEnabled && key.escape) {
        // 非 Vim 模式下 ESC: 检测双击触发 Rewind
        const now = Date.now();
        const timeSinceLastEsc = now - lastEscPressTimeRef.current;
        lastEscPressTimeRef.current = now;

        if (timeSinceLastEsc < DOUBLE_PRESS_INTERVAL && onRewindRequest) {
          // 双击 ESC - 触发 Rewind
          onRewindRequest();
          return;
        }

        // 单击 ESC - 清除输入
        setValue('');
        setCursor(0);
        setHistoryIndex(-1);
        return;
      }

      if (key.return) {
        // IME 组合期间：先结束组合，然后继续提交（不再 return）
        if (isComposing) {
          endComposition();
        }
        if (value.trim()) {
          const trimmedValue = value.trim();
          onSubmit(trimmedValue);
          historyManager.addCommand(trimmedValue);
          setHistory(prev => [trimmedValue, ...prev.slice(0, 99)]);
          setValue('');
          setCursor(0);
          setHistoryIndex(-1);
          if (vimModeEnabled) {
            setVimNormalMode(true);
            setUndoStack([]);
          }
        }
      } else if (key.backspace || key.delete) {
        if (cursor > 0) {
          if (vimModeEnabled) saveToUndoStack();
          setValue((prev) => prev.slice(0, cursor - 1) + prev.slice(cursor));
          setCursor((prev) => prev - 1);
        }
      } else if (key.leftArrow) {
        setCursor((prev) => Math.max(0, prev - 1));
      } else if (key.rightArrow) {
        setCursor((prev) => Math.min(value.length, prev + 1));
      } else if (key.upArrow && !showCompletionList) {
        // 历史记录向上
        if (history.length > 0 && historyIndex < history.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          setValue(history[newIndex]);
          setCursor(history[newIndex].length);
        }
      } else if (key.downArrow && !showCompletionList) {
        // 历史记录向下
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          setValue(history[newIndex]);
          setCursor(history[newIndex].length);
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          setValue('');
          setCursor(0);
        }
      } else if (key.ctrl && input === 'a') {
        // Ctrl+A: 移动到行首
        setCursor(0);
      } else if (key.ctrl && input === 'e') {
        // Ctrl+E: 移动到行尾
        setCursor(value.length);
      } else if (key.ctrl && input === 'u') {
        // Ctrl+U: 清除到行首
        if (vimModeEnabled) saveToUndoStack();
        setValue(value.slice(cursor));
        setCursor(0);
      } else if (key.ctrl && input === 'k') {
        // Ctrl+K: 清除到行尾
        if (vimModeEnabled) saveToUndoStack();
        setValue(value.slice(0, cursor));
      } else if (!key.ctrl && !key.meta && input) {
        if (vimModeEnabled && input.length === 1) saveToUndoStack();

        // IME 支持：检测 CJK 字符输入
        if (input.length > 0) {
          const hasCJK = Array.from(input).some(char => isCJKChar(char));
          if (hasCJK) {
            startComposition();
            scheduleEndComposition(); // 延迟结束组合状态
          }
        }

        setValue((prev) => prev.slice(0, cursor) + input + prev.slice(cursor));
        setCursor((prev) => prev + input.length);
      }
    },
    { isActive: !disabled }
  );

  // 显示建议文本
  const showSuggestion = !value && suggestion && !disabled;

  // Vim 模式指示器
  const modeIndicator = vimModeEnabled
    ? vimNormalMode
      ? '[N] '
      : '[I] '
    : '';

  // 显示待处理命令
  const commandIndicator = pendingCommand ? `[${pendingCommand}] ` : '';

  // IME 组合状态指示器
  const imeIndicator = isComposing ? '[组合中] ' : '';

  // 权限模式指示器 - 官方 v2.1.2
  const permissionModeIndicator = permissionMode !== 'default'
    ? permissionMode === 'acceptEdits'
      ? '[Auto-Accept] '
      : '[Plan] '
    : '';

  return (
    <Box flexDirection="column">
      {/* Ctrl+R 反向历史搜索界面 */}
      {reverseSearchMode && (
        <HistorySearch
          query={searchQuery}
          matches={searchMatches}
          selectedIndex={searchIndex}
          visible={reverseSearchMode}
        />
      )}

      {/* 补全建议列表 - v2.1.6: 添加图标支持 */}
      {showCompletionList && !reverseSearchMode && (
        <Box flexDirection="column" marginBottom={1}>
          {completions.map((item, index) => {
            // v2.1.6: 获取图标（优先使用项目自带的 icon，否则根据类型生成）
            const icon = item.icon || getCompletionIcon(item.type, item.label);
            return (
              <Box key={`${item.type}-${item.label}-${index}`}>
                <Text
                  backgroundColor={index === selectedCompletionIndex ? 'gray' : undefined}
                  color={index === selectedCompletionIndex ? 'white' : undefined}
                >
                  {/* v2.1.6: 显示图标 */}
                  {icon && <Text>{icon} </Text>}
                  <Text color={CLAUDE_COLOR} bold={index === selectedCompletionIndex}>
                    {item.label}
                  </Text>
                  {item.aliases && item.aliases.length > 0 && (
                    <Text dimColor> ({item.aliases.join(', ')})</Text>
                  )}
                  {item.description && (
                    <Text dimColor> - {truncateDescription(item.description)}</Text>
                  )}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* 输入行 */}
      <Box>
        {/* Vim 模式指示器 */}
        {vimModeEnabled && (
          <Text color={vimNormalMode ? 'yellow' : 'green'} bold>
            {modeIndicator}
          </Text>
        )}
        {/* 待处理命令指示器 */}
        {commandIndicator && (
          <Text color="cyan" bold>
            {commandIndicator}
          </Text>
        )}
        {/* IME 组合状态指示器 */}
        {imeIndicator && (
          <Text color="magenta" bold>
            {imeIndicator}
          </Text>
        )}
        {/* 权限模式指示器 - 官方 v2.1.2 */}
        {permissionModeIndicator && (
          <Text color={permissionMode === 'acceptEdits' ? 'green' : 'cyan'} bold>
            {permissionModeIndicator}
          </Text>
        )}
        <Text color="white" bold>
          {prompt}
        </Text>
        {/* 显示建议文本或实际输入 */}
        {showSuggestion ? (
          <Text dimColor>
            {t('input.trySuggestion', { suggestion })}
          </Text>
        ) : !disabled && value === '' ? (
          <Text backgroundColor="gray" color="black">
            {' '}
          </Text>
        ) : (
          <>
            <Text>
              {value.slice(0, cursor)}
            </Text>
            {!disabled && (
              <Text backgroundColor="gray" color="black">
                {value[cursor] || ' '}
              </Text>
            )}
            <Text>{value.slice(cursor + 1)}</Text>
          </>
        )}
      </Box>
    </Box>
  );
};

export default Input;
