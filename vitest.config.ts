import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // 排除使用旧版自定义测试框架的文件（它们用 process.exit() 和自定义 test()）
    exclude: [
      '**/node_modules/**',
      // 旧格式测试文件 - 使用自定义 runTests() 而不是 vitest
      'tests/config.test.ts',
      'tests/core/config.test.ts',
      'tests/core/context.test.ts',
      'tests/core/loop.test.ts',
      'tests/core/session.test.ts',
      'tests/e2e/cli-basic.test.ts',
      'tests/e2e/cli-session.test.ts',
      'tests/e2e/cli-tools.test.ts',
      'tests/e2e/example.test.ts',
      // src 内的旧格式测试
      'src/agents/communication.test.ts',
      'src/hooks/index.test.ts',
      'src/permissions/policy.test.ts',
      'src/permissions/rule-parser.test.ts',
      'src/permissions/tools.test.ts',
      'src/context/__tests__/enhanced.test.ts',
      // 可视化渲染测试脚本（非 vitest 格式，无 describe/it）
      'src/ui/components/StatusBar.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.test.ts',
        '**/*.config.ts',
        '**/*.d.ts',
      ],
    },
    mockReset: true,
    restoreMocks: true,
    clearMocks: true,
  },
});
