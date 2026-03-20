/**
 * GoalStore — 目标持久化存储
 * 使用 JSON 文件存储（与 daemon TaskStore 模式一致）
 * 路径: ~/.axon/goals.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { Goal, GoalStrategy, GoalStep, GoalLog, CreateGoalInput } from './types.js';

const AXON_DIR = path.join(os.homedir(), '.axon');
const GOALS_FILE = path.join(AXON_DIR, 'goals.json');
const GOALS_LOG_DIR = path.join(AXON_DIR, 'goal-logs');

interface GoalsData {
  version: number;
  goals: Goal[];
}

export class GoalStore {
  private data: GoalsData;

  constructor() {
    this.ensureDirs();
    this.data = this.loadFromDisk();
  }

  // ===========================================================================
  // Goal CRUD
  // ===========================================================================

  createGoal(input: CreateGoalInput, workingDir: string, authSnapshot?: Goal['authSnapshot']): Goal {
    const now = Date.now();
    const goal: Goal = {
      id: uuidv4(),
      name: input.name,
      description: input.description,
      status: 'active',
      metrics: input.metrics,
      strategies: [],
      checkIntervalMs: input.checkIntervalMs ?? 30 * 60 * 1000, // 默认 30 分钟
      humanApprovalRequired: input.humanApprovalRequired ?? ['spend_money', 'create_account', 'sign_contract'],
      notify: input.notify ?? ['desktop'],
      feishuChatId: input.feishuChatId,
      workingDir,
      model: input.model ?? 'sonnet',
      authSnapshot,
      nextCheckAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.data.goals.push(goal);
    this.saveToDisk();
    this.appendLog(goal.id, 'info', `Goal created: ${goal.name}`);
    return goal;
  }

  getGoal(id: string): Goal | undefined {
    return this.data.goals.find(g => g.id === id);
  }

  listGoals(status?: Goal['status']): Goal[] {
    if (status) return this.data.goals.filter(g => g.status === status);
    return [...this.data.goals];
  }

  updateGoal(id: string, updates: Partial<Pick<Goal, 'status' | 'metrics' | 'checkIntervalMs' | 'lastCheckAt' | 'nextCheckAt' | 'model' | 'notify' | 'authSnapshot'>>): Goal | undefined {
    const goal = this.data.goals.find(g => g.id === id);
    if (!goal) return undefined;
    Object.assign(goal, updates, { updatedAt: Date.now() });
    this.saveToDisk();
    return goal;
  }

  deleteGoal(id: string): boolean {
    const idx = this.data.goals.findIndex(g => g.id === id);
    if (idx < 0) return false;
    this.data.goals.splice(idx, 1);
    this.saveToDisk();
    return true;
  }

  // ===========================================================================
  // Strategy CRUD
  // ===========================================================================

  addStrategy(goalId: string, input: Omit<GoalStrategy, 'id' | 'goalId' | 'createdAt' | 'updatedAt'>): GoalStrategy | undefined {
    const goal = this.getGoal(goalId);
    if (!goal) return undefined;
    const now = Date.now();
    const strategy: GoalStrategy = {
      ...input,
      id: uuidv4(),
      goalId,
      createdAt: now,
      updatedAt: now,
    };
    goal.strategies.push(strategy);
    goal.updatedAt = now;
    this.saveToDisk();
    this.appendLog(goalId, 'plan', `Strategy added: ${strategy.name}`, { strategyId: strategy.id });
    return strategy;
  }

  updateStrategy(goalId: string, strategyId: string, updates: Partial<Pick<GoalStrategy, 'status' | 'score' | 'scoreReason' | 'priority' | 'metricContributions'>>): GoalStrategy | undefined {
    const goal = this.getGoal(goalId);
    if (!goal) return undefined;
    const strategy = goal.strategies.find(s => s.id === strategyId);
    if (!strategy) return undefined;
    Object.assign(strategy, updates, { updatedAt: Date.now() });
    goal.updatedAt = Date.now();
    this.saveToDisk();
    return strategy;
  }

  // ===========================================================================
  // Step CRUD
  // ===========================================================================

  addStep(goalId: string, strategyId: string, input: Omit<GoalStep, 'id' | 'strategyId' | 'createdAt' | 'updatedAt' | 'retryCount'>): GoalStep | undefined {
    const goal = this.getGoal(goalId);
    if (!goal) return undefined;
    const strategy = goal.strategies.find(s => s.id === strategyId);
    if (!strategy) return undefined;
    const now = Date.now();
    const step: GoalStep = {
      ...input,
      id: uuidv4(),
      strategyId,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    strategy.steps.push(step);
    strategy.updatedAt = now;
    goal.updatedAt = now;
    this.saveToDisk();
    return step;
  }

  updateStep(goalId: string, strategyId: string, stepId: string, updates: Partial<Pick<GoalStep, 'status' | 'result' | 'error' | 'retryCount' | 'needsHuman' | 'humanNote'>>): GoalStep | undefined {
    const goal = this.getGoal(goalId);
    if (!goal) return undefined;
    const strategy = goal.strategies.find(s => s.id === strategyId);
    if (!strategy) return undefined;
    const step = strategy.steps.find(s => s.id === stepId);
    if (!step) return undefined;
    Object.assign(step, updates, { updatedAt: Date.now() });
    strategy.updatedAt = Date.now();
    goal.updatedAt = Date.now();
    this.saveToDisk();
    return step;
  }

  // ===========================================================================
  // Logging
  // ===========================================================================

  appendLog(goalId: string, type: GoalLog['type'], message: string, data?: Record<string, unknown>): void {
    const log: GoalLog = {
      id: uuidv4(),
      goalId,
      type,
      message,
      data,
      createdAt: Date.now(),
    };
    const logFile = path.join(GOALS_LOG_DIR, `${goalId}.jsonl`);
    try {
      fs.appendFileSync(logFile, JSON.stringify(log) + '\n', 'utf-8');
    } catch {
      // 日志写入失败不影响主流程
    }
  }

  readLogs(goalId: string, limit = 50): GoalLog[] {
    const logFile = path.join(GOALS_LOG_DIR, `${goalId}.jsonl`);
    try {
      if (!fs.existsSync(logFile)) return [];
      const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
      return lines.slice(-limit).map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  // ===========================================================================
  // Daemon 集成
  // ===========================================================================

  /** 获取所有需要检查的活跃目标 */
  getDueGoals(): Goal[] {
    const now = Date.now();
    return this.data.goals.filter(g =>
      g.status === 'active' &&
      (g.nextCheckAt === undefined || g.nextCheckAt <= now)
    );
  }

  /** 标记目标为正在检查（防止重复执行） */
  markChecking(goalId: string): void {
    const goal = this.getGoal(goalId);
    if (!goal) return;
    goal.lastCheckAt = Date.now();
    goal.nextCheckAt = Date.now() + goal.checkIntervalMs;
    this.saveToDisk();
  }

  /** 重新从磁盘加载 */
  reload(): void {
    this.data = this.loadFromDisk();
  }

  // ===========================================================================
  // 内部方法
  // ===========================================================================

  private ensureDirs(): void {
    if (!fs.existsSync(AXON_DIR)) fs.mkdirSync(AXON_DIR, { recursive: true });
    if (!fs.existsSync(GOALS_LOG_DIR)) fs.mkdirSync(GOALS_LOG_DIR, { recursive: true });
  }

  private loadFromDisk(): GoalsData {
    try {
      if (!fs.existsSync(GOALS_FILE)) return { version: 1, goals: [] };
      const raw = fs.readFileSync(GOALS_FILE, 'utf-8');
      const data = JSON.parse(raw) as GoalsData;
      if (!data.goals || !Array.isArray(data.goals)) return { version: 1, goals: [] };
      return data;
    } catch {
      return { version: 1, goals: [] };
    }
  }

  private saveToDisk(): void {
    const json = JSON.stringify(this.data, null, 2);
    const tmpFile = GOALS_FILE + '.tmp';
    fs.writeFileSync(tmpFile, json, 'utf-8');
    try {
      fs.renameSync(tmpFile, GOALS_FILE);
    } catch {
      fs.writeFileSync(GOALS_FILE, json, 'utf-8');
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }
}
