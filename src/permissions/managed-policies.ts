/**
 * 托管策略系统第二层 (Subtask 7.2)
 *
 * 功能：
 * - 加载系统级、项目级、用户级策略文件
 * - 级联合并规则：系统级 → 项目级 → 用户级
 * - Deny规则不被覆盖
 * - 支持 managed-settings.d/ 目录（按字母顺序加载）
 *
 * 策略文件位置：
 * - 系统级: /path/to/claude-code/managed-settings.json (全局)
 * - 项目级: .axon/managed-settings.json (项目)
 * - 用户级: ~/.axon/managed-settings.json (用户)
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  enabled: boolean;
  excludedDirs?: string[];
  excludedCommands?: string[];
}

/**
 * 托管策略接口
 */
export interface ManagedPolicy {
  // 禁用用户Hook
  allowManagedHooksOnly?: boolean;

  // 禁用用户权限规则
  allowManagedPermissionRulesOnly?: boolean;

  // MCP白名单
  allowedMcpServers?: string[];

  // MCP黑名单
  deniedMcpServers?: string[];

  // 禁用插件
  blockedPlugins?: string[];

  // 仅允许已知marketplace
  strictKnownMarketplaces?: boolean;

  // 沙箱配置
  sandbox?: SandboxConfig;
}

/**
 * 策略验证结果
 */
export interface PolicyValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 托管策略管理器
 */
export class ManagedPoliciesManager {
  private systemPolicyPath?: string;
  private projectPolicyPath: string;
  private userPolicyPath: string;
  private cachedPolicy?: ManagedPolicy;
  private lastLoadTime?: number;

  constructor(
    systemPolicyPath?: string,
    projectPolicyPath = '.axon/managed-settings.json',
    userPolicyPath = '~/.axon/managed-settings.json'
  ) {
    this.systemPolicyPath = systemPolicyPath;
    this.projectPolicyPath = projectPolicyPath;
    this.userPolicyPath = this.expandUserPath(userPolicyPath);
  }

  /**
   * 展开用户路径 (~)
   */
  private expandUserPath(filePath: string): string {
    if (filePath.startsWith('~')) {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      return path.join(home, filePath.slice(1));
    }
    return filePath;
  }

  /**
   * 从目录加载所有策略文件（按字母顺序）
   */
  private loadPoliciesFromDirectory(dirPath: string): ManagedPolicy[] {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const policies: ManagedPolicy[] = [];
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json')).sort();

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const policy = JSON.parse(content) as ManagedPolicy;
        policies.push(policy);
      } catch (err) {
        // 忽略加载失败的文件
        console.warn(`Failed to load policy from ${filePath}:`, err);
      }
    }

    return policies;
  }

  /**
   * 读取单个策略文件
   */
  private loadPolicyFile(filePath: string): ManagedPolicy | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as ManagedPolicy;
    } catch (err) {
      console.warn(`Failed to load policy from ${filePath}:`, err);
      return null;
    }
  }

  /**
   * 加载所有策略（系统、项目、用户）
   */
  loadPolicies(): ManagedPolicy {
    // 检查缓存是否有效（5秒）
    if (this.cachedPolicy && this.lastLoadTime && Date.now() - this.lastLoadTime < 5000) {
      return this.cachedPolicy;
    }

    const policies: Array<{ level: string; policy: ManagedPolicy }> = [];

    // 加载系统级策略
    if (this.systemPolicyPath) {
      const sysPolicy = this.loadPolicyFile(this.systemPolicyPath);
      if (sysPolicy) {
        policies.push({ level: 'system', policy: sysPolicy });
      }
      // 加载系统级策略目录
      const sysPolicyDir = this.systemPolicyPath.replace(/\.json$/, '.d');
      const sysDirPolicies = this.loadPoliciesFromDirectory(sysPolicyDir);
      sysDirPolicies.forEach(p => policies.push({ level: 'system', policy: p }));
    }

    // 加载项目级策略
    const projPolicy = this.loadPolicyFile(this.projectPolicyPath);
    if (projPolicy) {
      policies.push({ level: 'project', policy: projPolicy });
    }
    const projPolicyDir = this.projectPolicyPath.replace(/\.json$/, '.d');
    const projDirPolicies = this.loadPoliciesFromDirectory(projPolicyDir);
    projDirPolicies.forEach(p => policies.push({ level: 'project', policy: p }));

    // 加载用户级策略
    const userPolicy = this.loadPolicyFile(this.userPolicyPath);
    if (userPolicy) {
      policies.push({ level: 'user', policy: userPolicy });
    }
    const userPolicyDir = this.userPolicyPath.replace(/\.json$/, '.d');
    const userDirPolicies = this.loadPoliciesFromDirectory(userPolicyDir);
    userDirPolicies.forEach(p => policies.push({ level: 'user', policy: p }));

    // 合并所有策略
    const merged = this.mergePolicies(...policies.map(p => p.policy));

    // 缓存结果
    this.cachedPolicy = merged;
    this.lastLoadTime = Date.now();

    return merged;
  }

  /**
   * 合并多个策略
   * 优先级：系统级 (最高) > 项目级 > 用户级 (最低)
   * Deny规则不被覆盖
   */
  mergePolicies(...policies: ManagedPolicy[]): ManagedPolicy {
    const merged: ManagedPolicy = {};

    // 处理boolean字段
    const booleanFields: (keyof ManagedPolicy)[] = [
      'allowManagedHooksOnly',
      'allowManagedPermissionRulesOnly',
      'strictKnownMarketplaces',
    ];

    // 处理字符串数组字段（白名单/黑名单）
    const arrayFields: (keyof ManagedPolicy)[] = ['allowedMcpServers', 'deniedMcpServers', 'blockedPlugins'];

    for (const policy of policies) {
      // 合并boolean字段 - 仅当未设置时才被覆盖
      for (const field of booleanFields) {
        if (policy[field] !== undefined && merged[field] === undefined) {
          merged[field] = policy[field];
        }
      }

      // 合并白名单 - 并集（允许更多）
      if (policy.allowedMcpServers) {
        merged.allowedMcpServers = Array.from(
          new Set([...(merged.allowedMcpServers || []), ...policy.allowedMcpServers])
        );
      }

      // 合并黑名单 - 并集（禁止更多，但不覆盖）
      if (policy.deniedMcpServers) {
        merged.deniedMcpServers = Array.from(
          new Set([...(merged.deniedMcpServers || []), ...policy.deniedMcpServers])
        );
      }

      // 合并禁用插件列表 - 并集（禁止更多）
      if (policy.blockedPlugins) {
        merged.blockedPlugins = Array.from(
          new Set([...(merged.blockedPlugins || []), ...policy.blockedPlugins])
        );
      }

      // 合并沙箱配置
      if (policy.sandbox) {
        if (!merged.sandbox) {
          merged.sandbox = policy.sandbox;
        } else {
          merged.sandbox.enabled = policy.sandbox.enabled ?? merged.sandbox.enabled;
          if (policy.sandbox.excludedDirs) {
            merged.sandbox.excludedDirs = Array.from(
              new Set([...(merged.sandbox.excludedDirs || []), ...policy.sandbox.excludedDirs])
            );
          }
          if (policy.sandbox.excludedCommands) {
            merged.sandbox.excludedCommands = Array.from(
              new Set([...(merged.sandbox.excludedCommands || []), ...policy.sandbox.excludedCommands])
            );
          }
        }
      }
    }

    return merged;
  }

  /**
   * 验证策略格式和逻辑
   */
  validatePolicy(policy: ManagedPolicy): PolicyValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 检查矛盾配置
    if (
      policy.allowedMcpServers &&
      policy.allowedMcpServers.length > 0 &&
      policy.deniedMcpServers &&
      policy.deniedMcpServers.length > 0
    ) {
      const overlap = policy.allowedMcpServers.filter(s => policy.deniedMcpServers?.includes(s));
      if (overlap.length > 0) {
        warnings.push(`MCP servers ${overlap.join(', ')} are both allowed and denied`);
      }
    }

    // 检查字段类型
    if (policy.allowManagedHooksOnly !== undefined && typeof policy.allowManagedHooksOnly !== 'boolean') {
      errors.push('allowManagedHooksOnly must be boolean');
    }

    if (policy.allowManagedPermissionRulesOnly !== undefined && typeof policy.allowManagedPermissionRulesOnly !== 'boolean') {
      errors.push('allowManagedPermissionRulesOnly must be boolean');
    }

    if (policy.strictKnownMarketplaces !== undefined && typeof policy.strictKnownMarketplaces !== 'boolean') {
      errors.push('strictKnownMarketplaces must be boolean');
    }

    if (policy.allowedMcpServers && !Array.isArray(policy.allowedMcpServers)) {
      errors.push('allowedMcpServers must be an array');
    }

    if (policy.deniedMcpServers && !Array.isArray(policy.deniedMcpServers)) {
      errors.push('deniedMcpServers must be an array');
    }

    if (policy.blockedPlugins && !Array.isArray(policy.blockedPlugins)) {
      errors.push('blockedPlugins must be an array');
    }

    if (policy.sandbox && typeof policy.sandbox !== 'object') {
      errors.push('sandbox must be an object');
    }

    if (policy.sandbox?.enabled !== undefined && typeof policy.sandbox.enabled !== 'boolean') {
      errors.push('sandbox.enabled must be boolean');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * 检查策略是否生效
   */
  isPolicyEnforced(policyName: keyof ManagedPolicy): boolean {
    const policies = this.loadPolicies();
    return policies[policyName] !== undefined && policies[policyName] !== false;
  }

  /**
   * 清空缓存（用于测试或动态重加载）
   */
  clearCache(): void {
    this.cachedPolicy = undefined;
    this.lastLoadTime = undefined;
  }
}

export default ManagedPoliciesManager;
