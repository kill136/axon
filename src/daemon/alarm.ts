/**
 * 闹钟信号系统
 *
 * 核心思想：定时器 = 闹钟，不是 cron。
 * - 有活跃会话时，定时任务触发后写入"闹钟信号"，由前台会话检测并注入对话
 * - 没有活跃会话时，走后台 executor 执行
 *
 * 活跃会话标记：
 * - 主会话启动时写入 ~/.claude/active-session.json
 * - 关闭时删除
 * - 通过 PID 存活检测避免僵尸标记
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';


// ============================================================================
// 路径常量
// ============================================================================

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const ALARM_DIR = path.join(CLAUDE_DIR, 'alarm-signals');
const ACTIVE_SESSION_FILE = path.join(CLAUDE_DIR, 'active-session.json');

// ============================================================================
// 闹钟信号
// ============================================================================

export interface AlarmSignal {
  taskId: string;
  taskName: string;
  prompt: string;
  /** 创建任务时的对话上下文快照 */
  context?: string;
  /** 历史执行摘要链 */
  executionMemory?: string[];
  /** 触发时间 */
  triggeredAt: number;
  /** 工作目录 */
  workingDir: string;
  /** 任务类型 */
  taskType: 'once' | 'interval' | 'watch';
}

/**
 * 写入闹钟信号文件，通知前台会话
 */
export function writeAlarm(signal: AlarmSignal): void {
  ensureDir(ALARM_DIR);
  const filePath = path.join(ALARM_DIR, `${signal.taskId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(signal, null, 2), 'utf-8');
}

/**
 * 读取所有待处理的闹钟信号，按触发时间排序
 */
export function readAlarms(): AlarmSignal[] {
  ensureDir(ALARM_DIR);
  try {
    const files = fs.readdirSync(ALARM_DIR).filter(f => f.endsWith('.json'));
    const alarms: AlarmSignal[] = [];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(ALARM_DIR, file), 'utf-8');
        alarms.push(JSON.parse(raw));
      } catch {
        // 损坏的信号文件，跳过
      }
    }
    return alarms.sort((a, b) => a.triggeredAt - b.triggeredAt);
  } catch {
    return [];
  }
}

/**
 * 清除已处理的闹钟信号
 */
export function clearAlarm(taskId: string): void {
  const filePath = path.join(ALARM_DIR, `${taskId}.json`);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // 竞态条件，忽略
  }
}

// ============================================================================
// 活跃会话标记
// ============================================================================

export interface ActiveSessionInfo {
  pid: number;
  sessionId: string;
  startedAt: number;
}

/**
 * 注册活跃会话（主会话启动时调用）
 */
export function writeActiveSession(info: ActiveSessionInfo): void {
  ensureDir(CLAUDE_DIR);
  fs.writeFileSync(ACTIVE_SESSION_FILE, JSON.stringify(info, null, 2), 'utf-8');
}

/**
 * 清除活跃会话标记（主会话关闭时调用）
 */
export function clearActiveSession(): void {
  try {
    if (fs.existsSync(ACTIVE_SESSION_FILE)) {
      fs.unlinkSync(ACTIVE_SESSION_FILE);
    }
  } catch {
    // 忽略
  }
}

/**
 * 检查是否有活跃的前台会话
 * 通过读取标记文件 + PID 存活检测双重验证
 */
export function isSessionActive(): boolean {
  try {
    if (!fs.existsSync(ACTIVE_SESSION_FILE)) return false;
    const raw = fs.readFileSync(ACTIVE_SESSION_FILE, 'utf-8');
    const info: ActiveSessionInfo = JSON.parse(raw);
    return isProcessAlive(info.pid);
  } catch {
    return false;
  }
}

/**
 * 读取活跃会话信息
 */
export function getActiveSession(): ActiveSessionInfo | null {
  try {
    if (!fs.existsSync(ACTIVE_SESSION_FILE)) return null;
    const raw = fs.readFileSync(ACTIVE_SESSION_FILE, 'utf-8');
    const info: ActiveSessionInfo = JSON.parse(raw);
    if (isProcessAlive(info.pid)) return info;
    // PID 已死，清理僵尸标记
    clearActiveSession();
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 检查进程是否存活
 * Windows: tasklist /FI "PID eq xxx"
 * Linux/Mac: kill -0
 */
function isProcessAlive(pid: number): boolean {
  try {
    // kill(pid, 0) 不发送信号，仅检查进程是否存在，跨平台通用
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
