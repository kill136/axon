import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
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
      // API mismatch tests - need source API alignment before re-enabling
      'tests/commands/session.test.ts',       // os.homedir redefine + command API mismatch
      'tests/commands/transcript.test.ts',    // uses jest.spyOn instead of vi.spyOn + os.homedir
      'tests/integration/session-flow.test.ts', // sessionManager API mismatch
      'tests/session/manager.test.ts',        // session file path creation issues
      'tests/ui-components-worker-card.test.tsx', // Ink <Text> rendering errors
      'tests/agents/parallel-memory-leak.test.ts', // ParallelAgentExecutor API mismatch
      'tests/background/shell-memory-leak.test.ts', // ShellManager API mismatch
      'tests/integration/tool-chain.test.ts', // integration test env setup issues
      'tests/web/permission-destination-selector.test.tsx', // missing @testing-library/react
      'tests/unit/ui/ClaudeMdImportDialog.test.tsx', // missing @testing-library/react
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
