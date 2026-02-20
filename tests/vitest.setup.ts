/**
 * Vitest 全局 setup 文件
 * 
 * 为所有测试自动建立 cwd 上下文，解决 getCurrentCwd() 在测试环境中抛错的问题。
 */

import { beforeAll } from 'vitest';
import { runWithCwd } from '../src/core/cwd-context.js';

// 注意：vitest setup 文件中的 beforeAll 在每个测试文件级别执行。
// 但 AsyncLocalStorage 上下文不会跨 async 边界传播到测试用例中。
// 因此我们需要用另一种方式：让 getCurrentCwd 在非上下文时回退到 process.cwd()。

// 方案：在 setup 阶段修补 getCurrentCwd，使其在测试环境中有 fallback
