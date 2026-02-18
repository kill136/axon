/**
 * Prompt Snippets 管理器
 * 持久化到 ~/.claude/prompt-snippets/*.json
 * 在 buildSystemPrompt 时按优先级注入
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// 类型定义
// ============================================================================

export interface PromptSnippet {
  /** 唯一 ID（UUID 或 slug） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 片段内容（注入系统提示词的文本） */
  content: string;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级（数字越小越靠前） */
  priority: number;
  /** 注入位置 */
  position: 'prepend' | 'append';
  /** 创建时间 */
  createdAt: string;
  /** 最后修改时间 */
  updatedAt: string;
  /** 描述/备注 */
  description?: string;
  /** 标签 */
  tags?: string[];
}

export interface PromptSnippetCreateInput {
  name: string;
  content: string;
  enabled?: boolean;
  priority?: number;
  position?: 'prepend' | 'append';
  description?: string;
  tags?: string[];
}

export interface PromptSnippetUpdateInput {
  name?: string;
  content?: string;
  enabled?: boolean;
  priority?: number;
  position?: 'prepend' | 'append';
  description?: string;
  tags?: string[];
}

// ============================================================================
// 存储路径
// ============================================================================

function getSnippetsDir(): string {
  return path.join(os.homedir(), '.claude', 'prompt-snippets');
}

function ensureSnippetsDir(): string {
  const dir = getSnippetsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getSnippetPath(id: string): string {
  return path.join(getSnippetsDir(), `${id}.json`);
}

// ============================================================================
// 简单 ID 生成
// ============================================================================

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ============================================================================
// PromptSnippetsManager
// ============================================================================

export class PromptSnippetsManager {
  private snippets = new Map<string, PromptSnippet>();
  private loaded = false;

  /**
   * 加载所有片段（懒加载，首次调用时读磁盘）
   */
  load(): void {
    if (this.loaded) return;

    const dir = getSnippetsDir();
    if (!fs.existsSync(dir)) {
      this.loaded = true;
      return;
    }

    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          const snippet: PromptSnippet = JSON.parse(content);
          if (snippet.id) {
            this.snippets.set(snippet.id, snippet);
          }
        } catch {
          // 跳过损坏的文件
        }
      }
    } catch {
      // 目录读取失败
    }

    this.loaded = true;
  }

  /**
   * 获取所有片段（按优先级排序）
   */
  list(): PromptSnippet[] {
    this.load();
    return Array.from(this.snippets.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * 获取单个片段
   */
  get(id: string): PromptSnippet | undefined {
    this.load();
    return this.snippets.get(id);
  }

  /**
   * 创建片段
   */
  create(input: PromptSnippetCreateInput): PromptSnippet {
    this.load();
    ensureSnippetsDir();

    const id = generateId();
    const now = new Date().toISOString();
    const snippet: PromptSnippet = {
      id,
      name: input.name,
      content: input.content,
      enabled: input.enabled ?? true,
      priority: input.priority ?? this.getNextPriority(),
      position: input.position ?? 'append',
      createdAt: now,
      updatedAt: now,
      description: input.description,
      tags: input.tags,
    };

    this.snippets.set(id, snippet);
    this.save(snippet);
    return snippet;
  }

  /**
   * 更新片段
   */
  update(id: string, input: PromptSnippetUpdateInput): PromptSnippet | null {
    this.load();

    const existing = this.snippets.get(id);
    if (!existing) return null;

    const updated: PromptSnippet = {
      ...existing,
      ...input,
      id, // 不可变
      createdAt: existing.createdAt, // 不可变
      updatedAt: new Date().toISOString(),
    };

    this.snippets.set(id, updated);
    this.save(updated);
    return updated;
  }

  /**
   * 删除片段
   */
  delete(id: string): boolean {
    this.load();

    if (!this.snippets.has(id)) return false;

    this.snippets.delete(id);
    const filePath = getSnippetPath(id);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // 删除文件失败不影响内存状态
    }
    return true;
  }

  /**
   * 切换启用/禁用
   */
  toggle(id: string): PromptSnippet | null {
    const snippet = this.snippets.get(id);
    if (!snippet) return null;
    return this.update(id, { enabled: !snippet.enabled });
  }

  /**
   * 获取所有启用的片段文本，按优先级排序，分 prepend/append
   */
  getInjectionTexts(): { prepend: string; append: string } {
    this.load();

    const sorted = this.list().filter(s => s.enabled);
    const prependParts: string[] = [];
    const appendParts: string[] = [];

    for (const snippet of sorted) {
      if (snippet.position === 'prepend') {
        prependParts.push(snippet.content);
      } else {
        appendParts.push(snippet.content);
      }
    }

    return {
      prepend: prependParts.join('\n\n'),
      append: appendParts.join('\n\n'),
    };
  }

  /**
   * 重新从磁盘加载（用于外部修改后刷新）
   */
  reload(): void {
    this.snippets.clear();
    this.loaded = false;
    this.load();
  }

  // ============ 私有方法 ============

  private save(snippet: PromptSnippet): void {
    try {
      ensureSnippetsDir();
      fs.writeFileSync(getSnippetPath(snippet.id), JSON.stringify(snippet, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[PromptSnippets] Failed to save snippet ${snippet.id}:`, err);
    }
  }

  private getNextPriority(): number {
    const all = this.list();
    if (all.length === 0) return 100;
    return Math.max(...all.map(s => s.priority)) + 100;
  }
}

// 单例
export const promptSnippetsManager = new PromptSnippetsManager();
