/**
 * TruncatedBuffer - 截断缓冲区
 *
 * 与官方 Axon CLI 实现保持一致
 * 用于管理命令输出，当输出超过限制时自动截断并记录被删除的内容大小
 */

// 默认最大字节数：64MB (与官方一致)
const DEFAULT_MAX_BYTES = 67108736;

/**
 * 截断缓冲区类
 *
 * 特性：
 * - 流式收集输出数据
 * - 自动截断超过限制的内容
 * - 记录总共接收的字节数
 * - toString() 时显示被删除的内容大小
 */
export class TruncatedBuffer {
  private maxSize: number;
  private content: string = '';
  private isTruncated: boolean = false;
  private totalBytesReceived: number = 0;

  constructor(maxSize: number = DEFAULT_MAX_BYTES) {
    this.maxSize = maxSize;
  }

  /**
   * 追加数据到缓冲区
   * 如果超过限制，自动截断
   */
  append(data: string | Buffer): void {
    const str = typeof data === 'string' ? data : data.toString();
    this.totalBytesReceived += str.length;

    // 如果已经截断且内容已满，直接返回
    if (this.isTruncated && this.content.length >= this.maxSize) {
      return;
    }

    // 检查是否会超过限制
    if (this.content.length + str.length > this.maxSize) {
      const remaining = this.maxSize - this.content.length;
      if (remaining > 0) {
        this.content += str.slice(0, remaining);
      }
      this.isTruncated = true;
    } else {
      this.content += str;
    }
  }

  /**
   * 获取内容字符串
   * 如果被截断，会在末尾添加截断提示
   */
  toString(): string {
    if (!this.isTruncated) {
      return this.content;
    }
    const removed = this.totalBytesReceived - this.maxSize;
    const removedKB = Math.round(removed / 1024);
    return this.content + `\n... [output truncated - ${removedKB}KB removed]`;
  }

  /**
   * 清空缓冲区
   */
  clear(): void {
    this.content = '';
    this.isTruncated = false;
    this.totalBytesReceived = 0;
  }

  /**
   * 获取当前内容长度
   */
  get length(): number {
    return this.content.length;
  }

  /**
   * 是否已被截断
   */
  get truncated(): boolean {
    return this.isTruncated;
  }

  /**
   * 获取总共接收的字节数
   */
  get totalBytes(): number {
    return this.totalBytesReceived;
  }

  /**
   * 获取原始内容（不含截断提示）
   */
  get rawContent(): string {
    return this.content;
  }
}

/**
 * 截断字符串到指定长度
 * 与官方实现一致的简单截断函数
 *
 * @param str 要截断的字符串
 * @param maxLength 最大长度
 * @returns 截断后的字符串（如果被截断会添加提示）
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  const removed = str.length - maxLength;
  const removedKB = Math.round(removed / 1024);
  return str.substring(0, maxLength) + `\n... [output truncated - ${removedKB}KB removed]`;
}

/**
 * 截断行数
 *
 * @param str 要截断的字符串
 * @param maxLines 最大行数
 * @returns 截断后的字符串
 */
export function truncateLines(str: string, maxLines: number): string {
  const lines = str.split('\n');
  if (lines.length <= maxLines) {
    return str;
  }
  return lines.slice(0, maxLines).join('\n') + '…';
}
