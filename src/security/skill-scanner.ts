/**
 * Skill 安全扫描器
 * 检测 skill markdown 文件中的危险模式，防止恶意代码执行
 */

export interface SkillScanWarning {
  level: 'warn' | 'critical';
  rule: string;
  detail: string;
}

export interface SkillScanResult {
  safe: boolean;
  warnings: SkillScanWarning[];
}

/**
 * 危险模式规则定义
 */
const CRITICAL_PATTERNS = [
  {
    pattern: /child_process/i,
    rule: 'child_process_usage',
    detail: 'Detected child_process module usage - can execute arbitrary commands',
  },
  {
    pattern: /\bexec\s*\(/i,
    rule: 'exec_usage',
    detail: 'Detected exec() function call - can execute arbitrary commands',
  },
  {
    pattern: /\bspawn\s*\(/i,
    rule: 'spawn_usage',
    detail: 'Detected spawn() function call - can execute arbitrary commands',
  },
  {
    pattern: /\beval\s*\(/i,
    rule: 'eval_usage',
    detail: 'Detected eval() function call - can execute arbitrary code',
  },
  {
    pattern: /stratum\+tcp/i,
    rule: 'crypto_mining_stratum',
    detail: 'Detected crypto-mining stratum protocol reference',
  },
  {
    pattern: /\bxmrig\b/i,
    rule: 'crypto_mining_xmrig',
    detail: 'Detected XMRig crypto-miner reference',
  },
  {
    pattern: /\bcoinhive\b/i,
    rule: 'crypto_mining_coinhive',
    detail: 'Detected Coinhive crypto-miner reference',
  },
];

const WARN_PATTERNS = [
  {
    pattern: /process\.env\.[A-Z_]{3,}/g,
    rule: 'env_harvesting',
    detail: 'Detected potential environment variable harvesting (multiple env accesses)',
  },
  {
    pattern: /[A-Za-z0-9+/]{100,}={0,2}/,
    rule: 'suspicious_base64',
    detail: 'Detected suspicious long base64-encoded string (>100 chars)',
  },
];

/**
 * 从 markdown 内容中剥离代码块和行内代码引用
 * 这些区域中的关键词是文档说明，不是可执行指令
 */
function stripMarkdownCode(content: string): string {
  // 先移除 fenced code blocks (```...```)
  let stripped = content.replace(/```[\s\S]*?```/g, '');
  // 再移除 inline code (`...`)
  stripped = stripped.replace(/`[^`]+`/g, '');
  return stripped;
}

/**
 * 扫描 skill 内容，检测危险模式
 */
export function scanSkillContent(content: string): SkillScanResult {
  const warnings: SkillScanWarning[] = [];

  // 剥离 markdown 代码块后再扫描，避免文档描述中的关键词被误报
  const strippedContent = stripMarkdownCode(content);

  // 检查 critical 级别的模式（只扫描非代码区域）
  for (const { pattern, rule, detail } of CRITICAL_PATTERNS) {
    if (pattern.test(strippedContent)) {
      warnings.push({
        level: 'critical',
        rule,
        detail,
      });
    }
  }

  // 检查 warn 级别的模式（扫描完整内容，因为 warn 不阻断加载）
  for (const { pattern, rule, detail } of WARN_PATTERNS) {
    if (rule === 'env_harvesting') {
      // 特殊处理：检测是否访问了多个环境变量（>=3个）
      const matches = content.match(pattern);
      if (matches && matches.length >= 3) {
        warnings.push({
          level: 'warn',
          rule,
          detail: `${detail} (found ${matches.length} accesses)`,
        });
      }
    } else {
      if (pattern.test(content)) {
        warnings.push({
          level: 'warn',
          rule,
          detail,
        });
      }
    }
  }

  // 判断是否安全：没有 critical 级别的警告
  const safe = !warnings.some(w => w.level === 'critical');

  return {
    safe,
    warnings,
  };
}
