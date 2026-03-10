/**
 * 内置环境变量验证器
 *
 * 基于官方的验证规则
 */

import type { EnvVarValidator } from '../validator.js';

/**
 * BASH 输出长度限制验证器
 *
 * 默认: 30000
 * 最大: 150000
 */
export const BASH_MAX_OUTPUT_LENGTH: EnvVarValidator<number> = {
  name: 'BASH_MAX_OUTPUT_LENGTH',
  default: 30000,
  description: 'Maximum output length for bash commands',
  validate: (value) => {
    if (!value) {
      return { effective: 30000, status: 'valid' };
    }

    const parsed = parseInt(value, 10);

    if (isNaN(parsed) || parsed <= 0) {
      return {
        effective: 30000,
        status: 'invalid',
        message: `Invalid value "${value}" (using default: 30000)`,
      };
    }

    if (parsed > 150000) {
      return {
        effective: 150000,
        status: 'capped',
        message: `Capped from ${parsed} to 150000`,
      };
    }

    return { effective: parsed, status: 'valid' };
  },
};

/**
 * Claude 最大输出 token 数验证器
 *
 * 默认: 32000
 * 最大: 64000
 */
export const AXON_MAX_OUTPUT_TOKENS: EnvVarValidator<number> = {
  name: 'AXON_MAX_OUTPUT_TOKENS',
  default: 32000,
  description: 'Maximum output tokens for Claude API',
  validate: (value) => {
    if (!value) {
      return { effective: 32000, status: 'valid' };
    }

    const parsed = parseInt(value, 10);

    if (isNaN(parsed) || parsed <= 0) {
      return {
        effective: 32000,
        status: 'invalid',
        message: `Invalid value "${value}" (using default: 32000)`,
      };
    }

    if (parsed > 64000) {
      return {
        effective: 64000,
        status: 'capped',
        message: `Capped from ${parsed} to 64000`,
      };
    }

    return { effective: parsed, status: 'valid' };
  },
};

/**
 * API 密钥验证器
 *
 * 验证非空字符串
 */
export const ANTHROPIC_API_KEY: EnvVarValidator<string | undefined> = {
  name: 'ANTHROPIC_API_KEY',
  default: undefined,
  description: 'Anthropic API key',
  sensitive: true,
  validate: (value) => {
    if (!value || value.trim().length === 0) {
      return {
        effective: undefined,
        status: 'invalid',
        message: 'API key is required',
      };
    }

    return { effective: value.trim(), status: 'valid' };
  },
};

/**
 * 最大重试次数验证器
 *
 * 默认: 3
 * 范围: 0-10
 */
export const AXON_MAX_RETRIES: EnvVarValidator<number> = {
  name: 'AXON_MAX_RETRIES',
  default: 3,
  description: 'Maximum number of retries for API calls',
  validate: (value) => {
    if (!value) {
      return { effective: 3, status: 'valid' };
    }

    const parsed = parseInt(value, 10);

    if (isNaN(parsed) || parsed < 0) {
      return {
        effective: 3,
        status: 'invalid',
        message: `Invalid value "${value}" (using default: 3)`,
      };
    }

    if (parsed > 10) {
      return {
        effective: 10,
        status: 'capped',
        message: `Capped from ${parsed} to 10`,
      };
    }

    return { effective: parsed, status: 'valid' };
  },
};

/**
 * 请求超时验证器
 *
 * 默认: 300000 (5分钟)
 * 最小: 1000 (1秒)
 * 最大: 600000 (10分钟)
 */
export const AXON_REQUEST_TIMEOUT: EnvVarValidator<number> = {
  name: 'AXON_REQUEST_TIMEOUT',
  default: 300000,
  description: 'Request timeout in milliseconds',
  validate: (value) => {
    if (!value) {
      return { effective: 300000, status: 'valid' };
    }

    const parsed = parseInt(value, 10);

    if (isNaN(parsed) || parsed < 1000) {
      return {
        effective: 300000,
        status: 'invalid',
        message: `Invalid value "${value}" (using default: 300000)`,
      };
    }

    if (parsed > 600000) {
      return {
        effective: 600000,
        status: 'capped',
        message: `Capped from ${parsed} to 600000`,
      };
    }

    return { effective: parsed, status: 'valid' };
  },
};

/**
 * 最大并发任务数验证器
 *
 * 默认: 10
 * 范围: 1-100
 */
export const AXON_MAX_CONCURRENT_TASKS: EnvVarValidator<number> = {
  name: 'AXON_MAX_CONCURRENT_TASKS',
  default: 10,
  description: 'Maximum number of concurrent tasks',
  validate: (value) => {
    if (!value) {
      return { effective: 10, status: 'valid' };
    }

    const parsed = parseInt(value, 10);

    if (isNaN(parsed) || parsed < 1) {
      return {
        effective: 10,
        status: 'invalid',
        message: `Invalid value "${value}" (using default: 10)`,
      };
    }

    if (parsed > 100) {
      return {
        effective: 100,
        status: 'capped',
        message: `Capped from ${parsed} to 100`,
      };
    }

    return { effective: parsed, status: 'valid' };
  },
};

/**
 * 布尔型验证器工厂
 */
export function createBooleanValidator(
  name: string,
  defaultValue: boolean,
  description?: string
): EnvVarValidator<boolean> {
  return {
    name,
    default: defaultValue,
    description,
    validate: (value) => {
      if (!value) {
        return { effective: defaultValue, status: 'valid' };
      }

      const normalized = value.toLowerCase().trim();
      const trueValues = ['1', 'true', 'yes', 'on'];
      const falseValues = ['0', 'false', 'no', 'off'];

      if (trueValues.includes(normalized)) {
        return { effective: true, status: 'valid' };
      }

      if (falseValues.includes(normalized)) {
        return { effective: false, status: 'valid' };
      }

      return {
        effective: defaultValue,
        status: 'invalid',
        message: `Invalid boolean value "${value}" (using default: ${defaultValue})`,
      };
    },
  };
}

/**
 * 数值范围验证器工厂
 */
export function createNumberRangeValidator(
  name: string,
  defaultValue: number,
  min: number,
  max: number,
  description?: string
): EnvVarValidator<number> {
  return {
    name,
    default: defaultValue,
    description,
    validate: (value) => {
      if (!value) {
        return { effective: defaultValue, status: 'valid' };
      }

      const parsed = parseInt(value, 10);

      if (isNaN(parsed)) {
        return {
          effective: defaultValue,
          status: 'invalid',
          message: `Invalid value "${value}" (using default: ${defaultValue})`,
        };
      }

      if (parsed < min) {
        return {
          effective: min,
          status: 'capped',
          message: `Capped from ${parsed} to ${min}`,
        };
      }

      if (parsed > max) {
        return {
          effective: max,
          status: 'capped',
          message: `Capped from ${parsed} to ${max}`,
        };
      }

      return { effective: parsed, status: 'valid' };
    },
  };
}

/**
 * 字符串枚举验证器工厂
 */
export function createEnumValidator<T extends string>(
  name: string,
  defaultValue: T,
  allowedValues: readonly T[],
  description?: string
): EnvVarValidator<T> {
  return {
    name,
    default: defaultValue,
    description,
    validate: (value) => {
      if (!value) {
        return { effective: defaultValue, status: 'valid' };
      }

      const normalized = value.toLowerCase() as T;

      if (allowedValues.includes(normalized)) {
        return { effective: normalized, status: 'valid' };
      }

      return {
        effective: defaultValue,
        status: 'invalid',
        message: `Invalid value "${value}". Allowed: ${allowedValues.join(', ')} (using default: ${defaultValue})`,
      };
    },
  };
}

/**
 * 所有内置验证器
 * 注意：BASH_MAX_OUTPUT_LENGTH, AXON_MAX_OUTPUT_TOKENS, AXON_MAX_RETRIES, AXON_REQUEST_TIMEOUT,
 * AXON_MAX_CONCURRENT_TASKS, AXON_ENABLE_TELEMETRY, AXON_USE_BEDROCK, AXON_USE_VERTEX,
 * AXON_DISABLE_FILE_CHECKPOINTING 已迁移到 settings.json，不再通过环境变量配置
 */
export const BUILTIN_VALIDATORS: EnvVarValidator[] = [
  // 保留这些验证器定义以供向后兼容（某些代码可能仍引用它们的默认值），
  // 但运行时以 settings.json 为准
  BASH_MAX_OUTPUT_LENGTH,
  AXON_MAX_OUTPUT_TOKENS,
  AXON_MAX_RETRIES,
  AXON_REQUEST_TIMEOUT,
  AXON_MAX_CONCURRENT_TASKS,
];
