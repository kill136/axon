/**
 * AI 应用工厂 — 应用管理服务
 * 
 * 让普通人通过自然语言描述，生成可直接使用的 Web 应用。
 * 应用存储在 ~/.axon/apps/ 下，由 Express 静态 serve。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';

// ============ 类型定义 ============

export interface UserApp {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  icon: string;
  status: 'creating' | 'ready' | 'error';
  errorMessage?: string;
  sessionId: string;
  /** 用户指定的工作目录（AI 在此目录下创建文件） */
  workingDirectory: string;
  /** 本地预览 URL: /apps/{id}/index.html */
  previewUrl: string;
  /** 公网发布信息 */
  publish?: PublishInfo;
}

export interface PublishInfo {
  /** surge.sh 域名 */
  surgeUrl?: string;
  /** cloudflare tunnel 临时链接 */
  tunnelUrl?: string;
  /** 发布时间 */
  publishedAt: string;
}

interface AppsManifest {
  version: 1;
  apps: UserApp[];
}

// ============ 应用管理器 ============

export class AppFactory {
  private appsDir: string;
  private manifestPath: string;
  private manifest: AppsManifest;

  constructor(axonDir?: string) {
    const baseDir = axonDir || path.join(os.homedir(), '.axon');
    this.appsDir = path.join(baseDir, 'apps');
    this.manifestPath = path.join(this.appsDir, 'manifest.json');

    // 确保目录存在
    if (!fs.existsSync(this.appsDir)) {
      fs.mkdirSync(this.appsDir, { recursive: true });
    }

    this.manifest = this.loadManifest();
  }

  // ---- CRUD ----

  listApps(): UserApp[] {
    return [...this.manifest.apps].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  getApp(id: string): UserApp | undefined {
    return this.manifest.apps.find(a => a.id === id);
  }

  createApp(name: string, description: string, sessionId: string, icon?: string, workingDirectory?: string): UserApp {
    const id = this.generateId();
    const now = new Date().toISOString();
    
    // 如果指定了 workingDirectory，使用用户指定的目录；否则用默认的 ~/.axon/apps/{id}
    const resolvedWorkDir = workingDirectory || path.join(this.appsDir, id);
    
    // 确保目录存在
    if (!fs.existsSync(resolvedWorkDir)) {
      fs.mkdirSync(resolvedWorkDir, { recursive: true });
    }

    // 同时在 appsDir 下建目录存放元数据（如果使用自定义目录）
    const appMetaDir = path.join(this.appsDir, id);
    if (!fs.existsSync(appMetaDir)) {
      fs.mkdirSync(appMetaDir, { recursive: true });
    }

    const app: UserApp = {
      id,
      name,
      description,
      createdAt: now,
      updatedAt: now,
      icon: icon || this.pickIcon(description),
      status: 'creating',
      sessionId,
      workingDirectory: resolvedWorkDir,
      previewUrl: `/apps/${id}/index.html`,
    };

    this.manifest.apps.push(app);
    this.saveManifest();
    return app;
  }

  updateAppMeta(id: string, updates: Partial<Pick<UserApp, 'name' | 'icon' | 'status' | 'errorMessage' | 'publish'>>): UserApp | undefined {
    const app = this.manifest.apps.find(a => a.id === id);
    if (!app) return undefined;

    if (updates.name !== undefined) app.name = updates.name;
    if (updates.icon !== undefined) app.icon = updates.icon;
    if (updates.status !== undefined) app.status = updates.status;
    if (updates.errorMessage !== undefined) app.errorMessage = updates.errorMessage;
    if (updates.publish !== undefined) app.publish = updates.publish;
    app.updatedAt = new Date().toISOString();

    this.saveManifest();
    return app;
  }

  /**
   * 写入应用文件（AI 生成的 HTML 等）
   */
  writeAppFile(id: string, filename: string, content: string): boolean {
    const app = this.manifest.apps.find(a => a.id === id);
    if (!app) return false;

    const appDir = this.getAppDir(id);
    if (!fs.existsSync(appDir)) {
      fs.mkdirSync(appDir, { recursive: true });
    }

    // 安全检查：不允许路径穿越
    const resolved = path.resolve(appDir, filename);
    if (!resolved.startsWith(appDir)) {
      return false;
    }

    // 确保子目录存在
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolved, content, 'utf-8');

    app.updatedAt = new Date().toISOString();
    if (filename === 'index.html') {
      app.status = 'ready';
    }
    this.saveManifest();
    return true;
  }

  /**
   * 读取应用文件
   */
  readAppFile(id: string, filename: string): string | null {
    const appDir = this.getAppDir(id);
    const resolved = path.resolve(appDir, filename);
    if (!resolved.startsWith(appDir)) return null;
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved, 'utf-8');
  }

  /**
   * 获取应用工作目录路径
   * 优先返回用户指定的 workingDirectory，否则返回默认的 ~/.axon/apps/{id}
   */
  getAppDir(id: string): string {
    const app = this.manifest.apps.find(a => a.id === id);
    if (app?.workingDirectory) {
      return app.workingDirectory;
    }
    return path.join(this.appsDir, id);
  }

  /**
   * 获取 apps 根目录
   */
  getAppsDir(): string {
    return this.appsDir;
  }

  deleteApp(id: string): boolean {
    const index = this.manifest.apps.findIndex(a => a.id === id);
    if (index === -1) return false;

    // 删除元数据目录（~/.axon/apps/{id}）
    const appMetaDir = path.join(this.appsDir, id);
    if (fs.existsSync(appMetaDir)) {
      fs.rmSync(appMetaDir, { recursive: true, force: true });
    }
    // 注意：不删除用户指定的 workingDirectory，那是用户的项目目录

    this.manifest.apps.splice(index, 1);
    this.saveManifest();
    return true;
  }

  // ---- 发布 ----

  /**
   * 通过 surge.sh 发布应用到公网
   * 返回公网 URL
   */
  async publishToSurge(id: string): Promise<string> {
    const app = this.getApp(id);
    if (!app) throw new Error(`App not found: ${id}`);
    if (app.status !== 'ready') throw new Error('App is not ready for publishing');

    const appDir = this.getAppDir(id);
    // 域名：用 app id 的前 8 位 + axon 后缀
    const domain = `axon-app-${id.slice(0, 8)}.surge.sh`;

    const { execSync } = await import('child_process');

    try {
      // 检查 surge 是否安装
      try {
        execSync('npx surge --version', { stdio: 'pipe', timeout: 30000 });
      } catch {
        throw new Error('surge is not available. Install with: npm install -g surge');
      }

      // 发布
      execSync(`npx surge "${appDir}" ${domain}`, {
        stdio: 'pipe',
        timeout: 60000,
        env: { ...process.env },
      });

      const surgeUrl = `https://${domain}`;
      this.updateAppMeta(id, {
        publish: {
          surgeUrl,
          publishedAt: new Date().toISOString(),
        },
      });

      return surgeUrl;
    } catch (error: any) {
      throw new Error(`Surge publish failed: ${error.message}`);
    }
  }

  /**
   * 通过 Cloudflare Tunnel 临时分享
   * 需要 cloudflared 已安装
   * 返回临时公网 URL
   */
  async publishToTunnel(localPort: number): Promise<{ url: string; process: any }> {
    const { spawn } = await import('child_process');

    return new Promise((resolve, reject) => {
      const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${localPort}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let output = '';
      const timeout = setTimeout(() => {
        reject(new Error('Cloudflare tunnel timed out (30s)'));
      }, 30000);

      const handleData = (data: Buffer) => {
        output += data.toString();
        // cloudflared 会输出类似：
        // Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):
        // https://xxx-xxx-xxx.trycloudflare.com
        const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) {
          clearTimeout(timeout);
          resolve({ url: match[0], process: proc });
        }
      };

      proc.stdout.on('data', handleData);
      proc.stderr.on('data', handleData);

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`cloudflared not found: ${err.message}. Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`));
      });

      proc.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`cloudflared exited with code ${code}`));
        }
      });
    });
  }

  // ---- 内部方法 ----

  private generateId(): string {
    return randomBytes(8).toString('hex');
  }

  private pickIcon(description: string): string {
    // 简单的关键词匹配选 emoji
    const keywords: Array<[string[], string]> = [
      [['游戏', 'game', '玩'], '🎮'],
      [['计算', 'calculator', '算'], '🧮'],
      [['图表', 'chart', '数据', 'data', '看板', 'dashboard'], '📊'],
      [['工具', 'tool', '转换', 'convert'], '🔧'],
      [['天气', 'weather'], '🌤️'],
      [['音乐', 'music', '播放'], '🎵'],
      [['画', 'draw', 'art', '设计', 'design'], '🎨'],
      [['笔记', 'note', '记录', '日记'], '📝'],
      [['购物', 'shop', '商品', '价格'], '🛒'],
      [['健康', 'health', '运动', '健身'], '💪'],
      [['学习', 'study', '教育', '考试'], '📚'],
      [['地图', 'map', '位置', '导航'], '🗺️'],
      [['时间', 'time', '倒计时', '计时'], '⏰'],
      [['报告', '解读', '分析', 'report', 'analysis'], '🔍'],
      [['聊天', 'chat', '社交'], '💬'],
    ];

    const lower = description.toLowerCase();
    for (const [words, emoji] of keywords) {
      if (words.some(w => lower.includes(w))) {
        return emoji;
      }
    }
    return '✨';
  }

  private loadManifest(): AppsManifest {
    if (fs.existsSync(this.manifestPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
        if (data.version === 1 && Array.isArray(data.apps)) {
          return data;
        }
      } catch {
        // 损坏的 manifest，重建
      }
    }
    return { version: 1, apps: [] };
  }

  private saveManifest(): void {
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2), 'utf-8');
  }
}

// ============ 应用生成 System Prompt ============

export function getAppGeneratorSystemPrompt(appDir: string, appName: string): string {
  return `你是一个 Web 应用生成器。用户会用自然语言描述他想要的工具或应用，你的任务是生成一个完整的、可直接在浏览器中运行的应用。

## 核心要求

1. **生成一个完整的 index.html 文件**，包含所有 HTML、CSS 和 JavaScript
2. **使用 CDN 引入外部库**（如 Tailwind CSS、Vue.js、Chart.js 等），不需要 npm/构建工具
3. **中文界面**，现代美观的 UI 设计
4. **响应式布局**，同时支持手机和电脑
5. **纯前端实现**，不需要任何后端服务器
6. 数据可以存在 localStorage 中实现持久化

## 生成流程

1. 先理解用户需求，如果需求模糊，简短询问关键信息（最多问一个问题）
2. 直接生成完整应用代码
3. 使用 Write 工具将文件写入：${appDir}/index.html

## UI 设计规范

- 使用 Tailwind CSS (CDN)：\`<script src="https://cdn.tailwindcss.com"></script>\`
- 配色方案：现代、简洁，使用渐变和圆角
- 加入适当的 emoji 让界面更友好
- 移动端优先的响应式设计
- 空状态要有友好提示

## 禁止

- 不要输出代码块让用户自己复制 — 必须通过 Write 工具直接写入文件
- 不要生成需要构建步骤的项目
- 不要生成多个文件（MVP 阶段只要一个 index.html）
- 不要使用 Node.js/npm 等后端技术
- 不要读取用户电脑上的其他文件

## 当前应用信息

- 应用名称：${appName}
- 文件写入目录：${appDir}

用户描述需求后，直接开始生成应用。`;
}
