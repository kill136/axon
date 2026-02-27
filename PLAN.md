# Browser Tool Reliability Fix Plan

## 问题清单（按优先级）

### P0-1: 端口冲突导致 start 反复失败
**根因**: `findAvailableCdpPort()` 只检查 CDP 端口（如 9222）是否可用，但不检查 relay 端口（cdpPort+1，如 9223）也可用。当其他进程（daemon、orphan Chrome）占了中间端口时，选到的 cdpPort 看起来可用，但 relay 端口被占。

**修复方案**: 
- `findAvailableCdpPort()` 需要同时检查 `port` 和 `port+1` 都可用才选中
- 文件: `src/browser/manager.ts` 行 71-79

```typescript
async function findAvailableCdpPort(preferredPort?: number): Promise<number> {
  if (preferredPort) {
    // Must check both CDP port AND relay port (cdpPort+1)
    if (await isPortAvailable(preferredPort) && await isPortAvailable(preferredPort + 1)) {
      return preferredPort;
    }
  }
  for (let port = CDP_PORT_RANGE_START; port <= CDP_PORT_RANGE_END; port += 2) {
    // Allocate in pairs: even=CDP, odd=relay
    if (await isPortAvailable(port) && await isPortAvailable(port + 1)) {
      return port;
    }
  }
  throw new Error(`No available CDP+relay port pair found in range ${CDP_PORT_RANGE_START}-${CDP_PORT_RANGE_END}.`);
}
```

### P0-2: stop 不彻底 — orphan 进程
**根因**: BrowserTool 的 `stop` action 只关闭 session tab，不关 Chrome 进程和 relay server。当最后一个 session 关闭时，Chrome 和 relay 变成孤儿。

**修复方案**:
- 在 BrowserTool 的 `stop` 中，关闭 session tab 后检查是否还有活跃 session：如果 `controllers.size === 0`，调用 `manager.stop()` 彻底关闭
- 文件: `src/tools/browser.ts` 行 246-252

```typescript
case 'stop': {
  const stopSessionId = getSessionId();
  await this.removeController(stopSessionId);
  
  // If no more active sessions, fully shut down browser
  if (this.controllers.size === 0) {
    await manager.stop();
    return this.success('Browser stopped. All sessions closed, Chrome and relay shut down.');
  }
  return this.success('Session browser tab closed. Browser process remains running for other sessions.');
}
```

### P0-3: Orphan Chrome 检测与清理
**根因**: 当进程异常退出（SelfEvolve 重启、崩溃）时，之前启动的 Chrome 进程成为孤儿，占着 CDP 端口。下次 start 时这些端口不可用但 Chrome 不在我们管控范围内。

**修复方案**: 
在 `start()` 中，如果发现目标端口不可用，尝试检测是否是我们自己启动的 Chrome（通过 user-data-dir 路径判断），如果是就 kill 掉。

- 文件: `src/browser/manager.ts`，在 `start()` 方法中添加

```typescript
// Before findAvailableCdpPort, kill any orphan Chrome processes using our user-data-dirs
await killOrphanChromes();
```

```typescript
async function killOrphanChromes(): Promise<void> {
  if (process.platform !== 'win32') return; // Linux/macOS 有进程组管理
  try {
    // Find Chrome processes with our user-data-dir pattern
    const output = execSync(
      'wmic process where "name=\'chrome.exe\'" get commandline,processid /format:csv',
      { encoding: 'utf-8', timeout: 5000, windowsHide: true }
    );
    const browserDir = path.join(os.homedir(), '.claude', 'browser');
    for (const line of output.split('\n')) {
      if (line.includes(browserDir) && line.includes('--remote-debugging-port')) {
        const pidMatch = line.match(/,(\d+)\s*$/);
        if (pidMatch) {
          const pid = parseInt(pidMatch[1], 10);
          console.log(`[BrowserManager] Killing orphan Chrome PID ${pid}`);
          try {
            execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore', windowsHide: true });
          } catch { /* best effort */ }
        }
      }
    }
  } catch { /* best effort */ }
}
```

### P0-4: Cloudflare Turnstile 无法通过
**根因**: Cloudflare Turnstile 检测到浏览器特征不正常，触发人机验证。我们的 Chrome 虽然使用了 extension relay（不直接暴露 CDP），但还有以下问题：
1. `--remote-debugging-port` 和 `--remote-debugging-pipe` 同时存在，某些检测脚本会通过 Chrome DevTools Protocol 暴露
2. 没有注入任何 stealth 脚本来隐藏 automation 特征
3. Turnstile widget 使用 shadow DOM，Playwright 的 `ariaSnapshot` 和 `click` 无法触及

**修复方案（分两步）**:

**Step A — Stealth 注入（在 extension background.js 中添加）:**
在每个 tab attach 时，通过 `chrome.debugger.sendCommand` 注入 stealth 脚本到页面，覆盖常见指纹检测点：
- `navigator.webdriver = false`（确认是否已生效）
- `navigator.plugins` 伪造
- `window.chrome.runtime` 伪造
- `Permissions.query` 覆盖（notification 权限）

文件: `src/browser/extension/background.js`，在 attach tab 的回调中注入。

**Step B — Turnstile 交互支持:**
在 controller 中添加 Cloudflare turnstile 专门处理：
- 检测 turnstile iframe（`challenges.cloudflare.com`）
- 切换到 turnstile iframe 的 frame
- 点击 checkbox
- 或者，提供 `frame_select` 后点击的流程

文件: `src/browser/controller.ts`，添加 turnstile 辅助方法

### P1-1: Screenshot 频繁超时
**根因**: Playwright 的 `page.screenshot()` 默认超时 30s，复杂页面（Twitter）字体加载可能超时。

**修复方案**:
- 给 screenshot 加 timeout 参数，默认设为 60s
- 如果超时，自动降级为不等待字体加载的截图
- 文件: `src/browser/controller.ts` 行 913-918

```typescript
async screenshot(options?: { fullPage?: boolean; timeout?: number }): Promise<Buffer> {
  const page = await this.getSessionPage();
  const timeout = options?.timeout ?? 60000;
  try {
    return await page.screenshot({ 
      fullPage: options?.fullPage ?? false,
      scale: 'css',
      timeout,
    });
  } catch (err: any) {
    if (err.message?.includes('Timeout') || err.message?.includes('timeout')) {
      // Fallback: disable font waiting via evaluate
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      return await page.screenshot({
        fullPage: options?.fullPage ?? false,
        scale: 'css',
        timeout: 10000,
        animations: 'disabled',
      });
    }
    throw err;
  }
}
```

### P1-2: Extension Service Worker 连接不稳定
**根因**: Extension 加载后 Service Worker 可能因多种原因不启动：
1. Chrome SW 缓存了旧版本的 background.js
2. SW 启动延迟
3. Relay server 的 auth token 不匹配

**修复方案**:
- 在 manager.start() 中，如果 extension 5s 内没连接，强制 reload extension
  （这个已有，但需要加强：用 `chrome.runtime.reload` 而不是 `loadUnpacked` 重复调用）
- 在 relay server 启动前清除旧的 SW 缓存
- 给 extension 的 background.js 加版本号，确保每次都是新 SW

文件: `src/browser/manager.ts` 行 552-601 (extension connection wait loop)
文件: `src/browser/extension/background.js` (版本号机制)

## 执行顺序

1. **P0-1**: 修复端口分配（同时检查 CDP+relay）—— 1个文件
2. **P0-2**: stop 彻底清理（无活跃 session 时关闭一切）—— 1个文件  
3. **P0-3**: Orphan Chrome 清理（start 前检测并杀死）—— 1个文件
4. **P1-1**: Screenshot 超时降级 —— 1个文件
5. **P1-2**: Extension 连接稳定性 —— 2个文件
6. **P0-4**: Cloudflare turnstile 支持 —— 2个文件（复杂度最高，放最后）

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/browser/manager.ts` | P0-1, P0-3, P1-2 |
| `src/tools/browser.ts` | P0-2 |
| `src/browser/controller.ts` | P1-1 |
| `src/browser/extension/background.js` | P0-4, P1-2 |
