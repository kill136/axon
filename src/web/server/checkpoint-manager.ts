/**
 * WebUI 文件检查点管理器
 * 提供文件快照保存和恢复功能
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';

/**
 * 检查点文件信息
 */
export interface CheckpointFile {
  /** 文件路径 */
  path: string;
  /** 文件内容 */
  content: string;
  /** 文件内容哈希值（用于快速比较） */
  hash: string;
  /** 文件大小（字节） */
  size: number;
  /** 创建时的修改时间 */
  mtime?: number;
}

/**
 * 检查点
 */
export interface Checkpoint {
  /** 检查点唯一ID */
  id: string;
  /** 创建时间戳 */
  timestamp: Date;
  /** 检查点描述 */
  description: string;
  /** 包含的文件 */
  files: CheckpointFile[];
  /** 工作目录 */
  workingDirectory: string;
  /** 元数据 */
  metadata?: {
    /** 创建者 */
    creator?: string;
    /** 标签 */
    tags?: string[];
    /** 自定义数据 */
    [key: string]: any;
  };
}

/**
 * 文件差异
 */
export interface FileDiff {
  /** 文件路径 */
  path: string;
  /** 差异类型 */
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  /** 检查点中的内容 */
  checkpointContent?: string;
  /** 当前内容 */
  currentContent?: string;
  /** 差异详情 */
  diff?: string;
}

/**
 * 检查点管理器
 */
export class CheckpointManager {
  private checkpoints: Map<string, Checkpoint>;
  private storageDir: string;

  constructor(storageDir?: string) {
    this.checkpoints = new Map();
    this.storageDir = storageDir || path.join(os.homedir(), '.axon', 'checkpoints');

    // 确保存储目录存在
    this.ensureStorageDir();

    // 加载已有的检查点
    this.loadCheckpoints();
  }

  /**
   * 确保存储目录存在
   */
  private ensureStorageDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * 加载所有检查点
   */
  private loadCheckpoints(): void {
    try {
      const files = fs.readdirSync(this.storageDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = path.join(this.storageDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const checkpoint: Checkpoint = JSON.parse(content);

          // 转换 timestamp 为 Date 对象
          checkpoint.timestamp = new Date(checkpoint.timestamp);

          this.checkpoints.set(checkpoint.id, checkpoint);
        } catch (error) {
          console.error(`[CheckpointManager] Failed to load checkpoint ${file}:`, error);
        }
      }

      console.log(`[CheckpointManager] Loaded ${this.checkpoints.size} checkpoints`);
    } catch (error) {
      console.error('[CheckpointManager] Failed to load checkpoints directory:', error);
    }
  }

  /**
   * 保存检查点到磁盘
   */
  private saveCheckpointToDisk(checkpoint: Checkpoint): void {
    const filePath = path.join(this.storageDir, `${checkpoint.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  }

  /**
   * 从磁盘删除检查点
   */
  private deleteCheckpointFromDisk(id: string): void {
    const filePath = path.join(this.storageDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /**
   * 计算文件内容的哈希值
   */
  private calculateHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * 读取文件内容
   */
  private readFile(filePath: string): CheckpointFile | null {
    try {
      const absolutePath = path.resolve(filePath);

      if (!fs.existsSync(absolutePath)) {
        console.warn(`[CheckpointManager] File does not exist: ${absolutePath}`);
        return null;
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');
      const hash = this.calculateHash(content);
      const stats = fs.statSync(absolutePath);

      return {
        path: absolutePath,
        content,
        hash,
        size: content.length,
        mtime: stats.mtimeMs,
      };
    } catch (error) {
      console.error(`[CheckpointManager] Failed to read file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * 创建检查点
   */
  async createCheckpoint(
    description: string,
    filePaths: string[],
    workingDirectory?: string,
    metadata?: Checkpoint['metadata']
  ): Promise<Checkpoint> {
    const id = randomUUID();
    const files: CheckpointFile[] = [];

    // 读取所有文件
    for (const filePath of filePaths) {
      const file = this.readFile(filePath);
      if (file) {
        files.push(file);
      }
    }

    if (files.length === 0) {
      throw new Error('没有有效的文件可以创建检查点');
    }

    const checkpoint: Checkpoint = {
      id,
      timestamp: new Date(),
      description,
      files,
      workingDirectory: workingDirectory || process.cwd(),
      metadata,
    };

    // 保存到内存和磁盘
    this.checkpoints.set(id, checkpoint);
    this.saveCheckpointToDisk(checkpoint);

    console.log(`[CheckpointManager] Created checkpoint: ${id} (${files.length} files)`);

    return checkpoint;
  }

  /**
   * 列出所有检查点
   */
  listCheckpoints(options?: {
    limit?: number;
    sortBy?: 'timestamp' | 'description';
    sortOrder?: 'asc' | 'desc';
  }): Checkpoint[] {
    let checkpoints = Array.from(this.checkpoints.values());

    // 排序
    const sortBy = options?.sortBy || 'timestamp';
    const sortOrder = options?.sortOrder || 'desc';

    checkpoints.sort((a, b) => {
      let comparison = 0;

      if (sortBy === 'timestamp') {
        comparison = a.timestamp.getTime() - b.timestamp.getTime();
      } else if (sortBy === 'description') {
        comparison = a.description.localeCompare(b.description);
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    // 限制数量
    if (options?.limit) {
      checkpoints = checkpoints.slice(0, options.limit);
    }

    return checkpoints;
  }

  /**
   * 获取检查点
   */
  getCheckpoint(id: string): Checkpoint | undefined {
    return this.checkpoints.get(id);
  }

  /**
   * 恢复检查点
   */
  async restoreCheckpoint(id: string, options?: {
    dryRun?: boolean;
    skipBackup?: boolean;
  }): Promise<{
    success: boolean;
    restored: string[];
    failed: string[];
    errors: Array<{ path: string; error: string }>;
  }> {
    const checkpoint = this.checkpoints.get(id);

    if (!checkpoint) {
      throw new Error(`检查点 ${id} 不存在`);
    }

    const restored: string[] = [];
    const failed: string[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    // 如果是 dry run，只返回将要恢复的文件列表
    if (options?.dryRun) {
      return {
        success: true,
        restored: checkpoint.files.map(f => f.path),
        failed: [],
        errors: [],
      };
    }

    // 恢复每个文件
    for (const file of checkpoint.files) {
      try {
        const dir = path.dirname(file.path);

        // 确保目录存在
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // 备份当前文件（如果存在且未跳过备份）
        if (!options?.skipBackup && fs.existsSync(file.path)) {
          const backupPath = `${file.path}.backup-${Date.now()}`;
          fs.copyFileSync(file.path, backupPath);
        }

        // 写入检查点内容
        fs.writeFileSync(file.path, file.content, 'utf-8');
        restored.push(file.path);

        console.log(`[CheckpointManager] Restoring file: ${file.path}`);
      } catch (error) {
        console.error(`[CheckpointManager] Failed to restore file ${file.path}:`, error);
        failed.push(file.path);
        errors.push({
          path: file.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const success = failed.length === 0;

    console.log(
      `[CheckpointManager] 恢复检查点 ${id}: ` +
      `成功 ${restored.length}/${checkpoint.files.length} 个文件`
    );

    return {
      success,
      restored,
      failed,
      errors,
    };
  }

  /**
   * 删除检查点
   */
  deleteCheckpoint(id: string): boolean {
    const checkpoint = this.checkpoints.get(id);

    if (!checkpoint) {
      return false;
    }

    this.checkpoints.delete(id);
    this.deleteCheckpointFromDisk(id);

    console.log(`[CheckpointManager] Deleted checkpoint: ${id}`);

    return true;
  }

  /**
   * 清除所有检查点
   */
  clearCheckpoints(): number {
    const count = this.checkpoints.size;

    // 删除所有检查点文件
    for (const id of this.checkpoints.keys()) {
      this.deleteCheckpointFromDisk(id);
    }

    this.checkpoints.clear();

    console.log(`[CheckpointManager] Cleared all checkpoints: ${count}`);

    return count;
  }

  /**
   * 比较检查点与当前文件状态
   */
  async diffCheckpoint(id: string): Promise<FileDiff[]> {
    const checkpoint = this.checkpoints.get(id);

    if (!checkpoint) {
      throw new Error(`检查点 ${id} 不存在`);
    }

    const diffs: FileDiff[] = [];

    for (const checkpointFile of checkpoint.files) {
      try {
        if (!fs.existsSync(checkpointFile.path)) {
          // 文件已被删除
          diffs.push({
            path: checkpointFile.path,
            type: 'removed',
            checkpointContent: checkpointFile.content,
          });
          continue;
        }

        const currentContent = fs.readFileSync(checkpointFile.path, 'utf-8');
        const currentHash = this.calculateHash(currentContent);

        if (currentHash === checkpointFile.hash) {
          // 文件未改变
          diffs.push({
            path: checkpointFile.path,
            type: 'unchanged',
          });
        } else {
          // 文件已修改
          diffs.push({
            path: checkpointFile.path,
            type: 'modified',
            checkpointContent: checkpointFile.content,
            currentContent,
            diff: this.createSimpleDiff(checkpointFile.content, currentContent),
          });
        }
      } catch (error) {
        console.error(`[CheckpointManager] Failed to compare file ${checkpointFile.path}:`, error);
      }
    }

    return diffs;
  }

  /**
   * 创建简单的文本差异
   */
  private createSimpleDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let diff = '';
    const maxLines = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine === newLine) {
        diff += `  ${oldLine || ''}\n`;
      } else if (oldLine === undefined) {
        diff += `+ ${newLine || ''}\n`;
      } else if (newLine === undefined) {
        diff += `- ${oldLine || ''}\n`;
      } else {
        diff += `- ${oldLine}\n`;
        diff += `+ ${newLine}\n`;
      }
    }

    return diff;
  }

  /**
   * 获取存储目录路径
   */
  getStorageDir(): string {
    return this.storageDir;
  }

  /**
   * 获取检查点统计信息
   */
  getStats(): {
    total: number;
    totalFiles: number;
    totalSize: number;
    oldest?: Date;
    newest?: Date;
  } {
    const checkpoints = Array.from(this.checkpoints.values());

    const stats = {
      total: checkpoints.length,
      totalFiles: 0,
      totalSize: 0,
      oldest: undefined as Date | undefined,
      newest: undefined as Date | undefined,
    };

    if (checkpoints.length === 0) {
      return stats;
    }

    for (const checkpoint of checkpoints) {
      stats.totalFiles += checkpoint.files.length;

      for (const file of checkpoint.files) {
        stats.totalSize += file.size;
      }

      if (!stats.oldest || checkpoint.timestamp < stats.oldest) {
        stats.oldest = checkpoint.timestamp;
      }

      if (!stats.newest || checkpoint.timestamp > stats.newest) {
        stats.newest = checkpoint.timestamp;
      }
    }

    return stats;
  }
}
