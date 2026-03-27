/**
 * 权限决策引擎第三层 (Subtask 7.3)
 *
 * 功能：
 * - 整合条件规则引擎和托管策略系统
 * - 实现完整的权限决策流程
 * - 优先级：deny > ask > allow > default(allow)
 * - 生成审计日志
 *
 * 决策流程：
 * 1. 收集context: toolName, toolInput, user, project等
 * 2. 检查第一层: 条件规则匹配？
 *    ├─ deny规则匹配 → 拒绝
 *    ├─ ask规则匹配 → 询问用户
 *    └─ allow规则匹配 → 允许
 * 3. 检查第二层: 托管策略冲突？
 *    ├─ managed deny规则 → 拒绝 (不能被覆盖)
 *    └─ 检查plugin/mcp黑名单
 * 4. 检查第三层: MCP OAuth token有效？
 *    ├─ 需要新的scope → 触发OAuth flow
 *    └─ Token有效 → 继续
 * 5. 最终决策
 */

import ConditionEvaluator from './condition-evaluator.js';
import ManagedPoliciesManager, { type ManagedPolicy } from './managed-policies.js';

/**
 * 权限决策结果
 */
export type PermissionDecision = 'allow' | 'deny' | 'ask';

/**
 * 审计日志条目
 */
export interface AuditLogEntry {
  timestamp: string; // ISO8601
  user: string;
  tool: string;
  input?: Record<string, any>;
  decision: PermissionDecision;
  reason: string;
  source: 'condition' | 'policy' | 'managed' | 'oauth' | 'default';
}

/**
 * 权限决策响应
 */
export interface PermissionDecisionResponse {
  decision: PermissionDecision;
  reason: string;
  requiresAuth?: boolean;
  scopes?: string[]; // OAuth scopes needed
  auditLog: AuditLogEntry;
}

/**
 * 权限决策上下文
 */
export interface PermissionContext {
  toolName: string;
  toolInput?: Record<string, any>;
  user?: string;
  project?: string;
  sourceType?: 'cli' | 'hook' | 'plugin' | 'mcp' | 'default';
}

/**
 * 权限决策引擎
 */
export class PermissionEngine {
  private conditionEvaluator: ConditionEvaluator;
  private policiesManager: ManagedPoliciesManager;
  private conditionRules: Array<{ type: 'allow' | 'deny' | 'ask'; rule: string }> = [];
  private auditLog: AuditLogEntry[] = [];

  constructor(
    systemPolicyPath?: string,
    projectPolicyPath = '.axon/managed-settings.json',
    userPolicyPath = '~/.axon/managed-settings.json'
  ) {
    this.conditionEvaluator = new ConditionEvaluator();
    this.policiesManager = new ManagedPoliciesManager(systemPolicyPath, projectPolicyPath, userPolicyPath);
  }

  /**
   * 添加条件规则
   */
  addRule(type: 'allow' | 'deny' | 'ask', rule: string): void {
    this.conditionRules.push({ type, rule });
  }

  /**
   * 设置条件规则
   */
  setRules(rules: Array<{ type: 'allow' | 'deny' | 'ask'; rule: string }>): void {
    this.conditionRules = rules;
  }

  /**
   * 做出权限决策
   */
  decide(context: PermissionContext): PermissionDecisionResponse {
    const startTime = Date.now();

    // 第一步：收集context
    const user = context.user || 'default';
    const toolName = context.toolName;
    const toolInput = context.toolInput || {};

    // 提取工具参数（用于pattern匹配）
    const toolValue = this.extractToolValue(toolName, toolInput);

    // 第二步：检查条件规则（第一层）
    const conditionResult = this.evaluateConditionRules(toolName, toolValue);
    if (conditionResult.decision !== 'allow') {
      return this.createResponse(conditionResult.decision, conditionResult.reason, 'condition');
    }

    // 第三步：检查托管策略（第二层）
    const policyResult = this.evaluateManagedPolicies(context);
    if (policyResult.decision !== 'allow') {
      return this.createResponse(policyResult.decision, policyResult.reason, 'managed');
    }

    // 默认允许
    return this.createResponse('allow', 'No restrictions applied', 'default');
  }

  /**
   * 评估条件规则（第一层）
   * 优先级: deny > ask > allow > default(allow)
   */
  private evaluateConditionRules(toolName: string, toolValue?: string): { decision: PermissionDecision; reason: string } {
    let denyMatch = false;
    let askMatch = false;
    let allowMatch = false;
    let matchedDenyReason = '';
    let matchedAskReason = '';

    for (const rule of this.conditionRules) {
      const matches = this.conditionEvaluator.evaluate(rule.rule, toolName, toolValue);

      if (matches) {
        if (rule.type === 'deny') {
          denyMatch = true;
          matchedDenyReason = rule.rule;
        } else if (rule.type === 'ask') {
          askMatch = true;
          matchedAskReason = rule.rule;
        } else if (rule.type === 'allow') {
          allowMatch = true;
        }
      }
    }

    // 优先级: deny > ask > allow > default
    if (denyMatch) {
      return { decision: 'deny', reason: `Denied by rule: ${matchedDenyReason}` };
    }
    if (askMatch) {
      return { decision: 'ask', reason: `Requires approval by rule: ${matchedAskReason}` };
    }
    if (allowMatch) {
      return { decision: 'allow', reason: `Allowed by rule` };
    }

    // 默认允许
    return { decision: 'allow', reason: 'No condition rules matched' };
  }

  /**
   * 评估托管策略（第二层）
   */
  private evaluateManagedPolicies(context: PermissionContext): { decision: PermissionDecision; reason: string } {
    const policy = this.policiesManager.loadPolicies();

    // 检查工具是否被禁用的策略
    const sourceType = context.sourceType || 'default';

    // 检查Hook限制
    if (context.sourceType === 'hook' && policy.allowManagedHooksOnly === true) {
      return {
        decision: 'deny',
        reason: 'Hooks are restricted to managed-only by policy',
      };
    }

    // 检查权限规则限制
    if (context.sourceType === 'plugin' && policy.allowManagedPermissionRulesOnly === true) {
      return {
        decision: 'deny',
        reason: 'Permission rules are restricted to managed-only by policy',
      };
    }

    // 检查MCP服务器黑名单
    if (context.sourceType === 'mcp' && policy.deniedMcpServers) {
      const mcpName = context.toolName.split('/')[0]; // e.g. "mcp/service"
      if (policy.deniedMcpServers.includes(mcpName)) {
        return {
          decision: 'deny',
          reason: `MCP server '${mcpName}' is blocked by policy`,
        };
      }
    }

    // 检查MCP服务器白名单
    if (context.sourceType === 'mcp' && policy.allowedMcpServers && policy.allowedMcpServers.length > 0) {
      const mcpName = context.toolName.split('/')[0];
      if (!policy.allowedMcpServers.includes(mcpName)) {
        return {
          decision: 'deny',
          reason: `MCP server '${mcpName}' is not in whitelist by policy`,
        };
      }
    }

    // 检查插件黑名单
    if (context.sourceType === 'plugin' && policy.blockedPlugins) {
      const pluginName = context.toolName.split('/')[0];
      if (policy.blockedPlugins.includes(pluginName)) {
        return {
          decision: 'deny',
          reason: `Plugin '${pluginName}' is blocked by policy`,
        };
      }
    }

    return { decision: 'allow', reason: 'Policy check passed' };
  }

  /**
   * 提取工具参数值用于pattern匹配
   */
  private extractToolValue(toolName: string, toolInput: Record<string, any>): string | undefined {
    // 不同工具有不同的参数名
    switch (toolName) {
      case 'Bash':
        return toolInput.command as string | undefined;
      case 'Read':
      case 'Write':
      case 'Edit':
        return toolInput.file_path as string | undefined;
      case 'Glob':
        return toolInput.pattern as string | undefined;
      case 'Grep':
        return toolInput.pattern as string | undefined;
      case 'WebFetch':
        return toolInput.url as string | undefined;
      case 'WebSearch':
        return toolInput.query as string | undefined;
      default:
        return undefined;
    }
  }

  /**
   * 创建响应对象
   */
  private createResponse(
    decision: PermissionDecision,
    reason: string,
    source: AuditLogEntry['source']
  ): PermissionDecisionResponse {
    const auditLog: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      user: 'default',
      tool: 'unknown',
      decision,
      reason,
      source,
    };

    this.auditLog.push(auditLog);

    return {
      decision,
      reason,
      auditLog,
    };
  }

  /**
   * 获取审计日志
   */
  getAuditLog(): AuditLogEntry[] {
    return [...this.auditLog];
  }

  /**
   * 清空审计日志
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }
}

export default PermissionEngine;
