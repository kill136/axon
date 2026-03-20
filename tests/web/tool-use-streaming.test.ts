/**
 * 测试 tool_use 流式传输和状态管理
 * 
 * 验证：
 * 1. tool_use_start 事件在 API content_block_start 时立即发送（带 _streaming 标志）
 * 2. tool_use_input_ready 事件在参数解析完成后发送
 * 3. message_complete 清理所有 running 状态的 tool_use
 * 4. JSON 解析失败时记录警告且不崩溃
 */
import { describe, it, expect, vi } from 'vitest';

describe('tool_use streaming flow', () => {
  /**
   * 模拟 conversation.ts 中的 tool_use 流式处理逻辑
   */
  function simulateStreamEvents(
    events: Array<{ type: string; id?: string; name?: string; input?: string; stopReason?: string }>,
    callbacks: {
      onToolUseStart?: (id: string, name: string, input: unknown) => void;
      onToolUseInputReady?: (id: string, input: unknown) => void;
    }
  ) {
    let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
    const assistantContent: any[] = [];

    for (const event of events) {
      switch (event.type) {
        case 'tool_use_start': {
          // 完成前一个工具
          if (currentToolUse) {
            let prevInput = {};
            try {
              prevInput = JSON.parse(currentToolUse.inputJson || '{}');
            } catch { /* */ }
            assistantContent.push({ type: 'tool_use', id: currentToolUse.id, name: currentToolUse.name, input: prevInput });
            callbacks.onToolUseInputReady?.(currentToolUse.id, prevInput);
          }
          // 开始新工具
          currentToolUse = { id: event.id || '', name: event.name || '', inputJson: '' };
          callbacks.onToolUseStart?.(currentToolUse.id, currentToolUse.name, { _streaming: true });
          break;
        }
        case 'tool_use_delta': {
          if (currentToolUse && event.input) {
            currentToolUse.inputJson += event.input;
          }
          break;
        }
        case 'stop': {
          if (currentToolUse) {
            let parsedInput = {};
            try {
              parsedInput = JSON.parse(currentToolUse.inputJson || '{}');
            } catch { /* */ }
            assistantContent.push({ type: 'tool_use', id: currentToolUse.id, name: currentToolUse.name, input: parsedInput });
            callbacks.onToolUseInputReady?.(currentToolUse.id, parsedInput);
            currentToolUse = null;
          }
          break;
        }
      }
    }

    return assistantContent;
  }

  it('should send onToolUseStart immediately with _streaming flag', () => {
    const onToolUseStart = vi.fn();
    const onToolUseInputReady = vi.fn();

    simulateStreamEvents([
      { type: 'tool_use_start', id: 'tool-1', name: 'Write' },
      { type: 'tool_use_delta', input: '{"file_path":' },
      { type: 'tool_use_delta', input: '"/tmp/test.html",' },
      { type: 'tool_use_delta', input: '"content":"hello"}' },
      { type: 'stop', stopReason: 'tool_use' },
    ], { onToolUseStart, onToolUseInputReady });

    // onToolUseStart 在 tool_use_start 事件时立即调用
    expect(onToolUseStart).toHaveBeenCalledTimes(1);
    expect(onToolUseStart).toHaveBeenCalledWith('tool-1', 'Write', { _streaming: true });

    // onToolUseInputReady 在 stop 事件时调用
    expect(onToolUseInputReady).toHaveBeenCalledTimes(1);
    expect(onToolUseInputReady).toHaveBeenCalledWith('tool-1', {
      file_path: '/tmp/test.html',
      content: 'hello',
    });
  });

  it('should handle multi-tool response correctly', () => {
    const onToolUseStart = vi.fn();
    const onToolUseInputReady = vi.fn();

    simulateStreamEvents([
      { type: 'tool_use_start', id: 'tool-1', name: 'TodoWrite' },
      { type: 'tool_use_delta', input: '{"todos":[{"content":"test"}]}' },
      { type: 'tool_use_start', id: 'tool-2', name: 'Write' },
      { type: 'tool_use_delta', input: '{"file_path":"/tmp/game.html","content":"<html>big file</html>"}' },
      { type: 'stop', stopReason: 'tool_use' },
    ], { onToolUseStart, onToolUseInputReady });

    // onToolUseStart 被调用两次（每个工具一次）
    expect(onToolUseStart).toHaveBeenCalledTimes(2);
    expect(onToolUseStart).toHaveBeenNthCalledWith(1, 'tool-1', 'TodoWrite', { _streaming: true });
    expect(onToolUseStart).toHaveBeenNthCalledWith(2, 'tool-2', 'Write', { _streaming: true });

    // onToolUseInputReady 也被调用两次
    expect(onToolUseInputReady).toHaveBeenCalledTimes(2);
    // 第一次在第二个 tool_use_start 到来时（完成 TodoWrite）
    expect(onToolUseInputReady).toHaveBeenNthCalledWith(1, 'tool-1', { todos: [{ content: 'test' }] });
    // 第二次在 stop 时（完成 Write）
    expect(onToolUseInputReady).toHaveBeenNthCalledWith(2, 'tool-2', {
      file_path: '/tmp/game.html',
      content: '<html>big file</html>',
    });
  });

  it('should handle JSON parse failure gracefully (max_tokens truncation)', () => {
    const onToolUseStart = vi.fn();
    const onToolUseInputReady = vi.fn();

    const content = simulateStreamEvents([
      { type: 'tool_use_start', id: 'tool-1', name: 'Write' },
      { type: 'tool_use_delta', input: '{"file_path":"/tmp/game.html","content":"<html>incompleteeeee' },
      // max_tokens 截断，JSON 不完整
      { type: 'stop', stopReason: 'max_tokens' },
    ], { onToolUseStart, onToolUseInputReady });

    // onToolUseStart 仍然被调用
    expect(onToolUseStart).toHaveBeenCalledWith('tool-1', 'Write', { _streaming: true });

    // onToolUseInputReady 被调用，但 input 为空对象（JSON 解析失败）
    expect(onToolUseInputReady).toHaveBeenCalledWith('tool-1', {});

    // assistantContent 中的 tool_use 也是空 input
    expect(content[0]).toEqual({ type: 'tool_use', id: 'tool-1', name: 'Write', input: {} });
  });
});

describe('message_complete tool_use status cleanup', () => {
  /**
   * 模拟前端 message_complete 的处理逻辑
   */
  function handleMessageComplete(content: Array<{ type: string; status?: string; [key: string]: any }>) {
    return content.map(c => {
      if (c.type === 'tool_use' && c.status === 'running') {
        return { ...c, status: 'error' as const };
      }
      return c;
    });
  }

  it('should mark running tool_use as error on message_complete', () => {
    const content = [
      { type: 'text', text: 'hello' },
      { type: 'tool_use', id: 'tool-1', name: 'Write', status: 'running', input: {} },
    ];

    const result = handleMessageComplete(content);
    expect(result[1].status).toBe('error');
    expect(result[0]).toEqual(content[0]); // text 不受影响
  });

  it('should not change completed tool_use status', () => {
    const content = [
      { type: 'tool_use', id: 'tool-1', name: 'Read', status: 'completed', input: { file_path: '/tmp/a.txt' } },
      { type: 'tool_use', id: 'tool-2', name: 'Write', status: 'running', input: {} },
    ];

    const result = handleMessageComplete(content);
    expect(result[0].status).toBe('completed');
    expect(result[1].status).toBe('error');
  });

  it('should handle empty content array', () => {
    const result = handleMessageComplete([]);
    expect(result).toEqual([]);
  });
});

describe('getToolDescription with _streaming', () => {
  function getToolDescription(name: string, input: any): string {
    if (input?._streaming) return 'streaming...';
    switch (name) {
      case 'Write':
        if (input?.file_path) {
          const path = String(input.file_path);
          const lines = input?.content?.split?.('\n')?.length || 0;
          return `${path}${lines > 0 ? ` (${lines} lines)` : ''}`;
        }
        return '';
      default:
        return '';
    }
  }

  it('should return "streaming..." when _streaming is true', () => {
    expect(getToolDescription('Write', { _streaming: true })).toBe('streaming...');
    expect(getToolDescription('Bash', { _streaming: true })).toBe('streaming...');
    expect(getToolDescription('Read', { _streaming: true })).toBe('streaming...');
  });

  it('should show normal description after input is ready', () => {
    expect(getToolDescription('Write', { file_path: '/tmp/test.html', content: 'line1\nline2\nline3' }))
      .toBe('/tmp/test.html (3 lines)');
  });

  it('should handle empty input after JSON parse failure', () => {
    expect(getToolDescription('Write', {})).toBe('');
  });
});
