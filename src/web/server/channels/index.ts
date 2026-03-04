/**
 * IM 通道管理器
 *
 * 管理所有 IM 通道的生命周期：注册、启动、停止、配置更新。
 * 是 channels/ 模块的唯一对外入口。
 */

import * as fs from 'fs';
import type { ConversationManager } from '../conversation.js';
import type {
  ChannelAdapter,
  ChannelConfig,
  ChannelsConfig,
  ChannelStatusInfo,
  ChannelServerMessage,
  PairingRequest,
} from './types.js';
import { IMBridge } from './bridge.js';
import { TelegramAdapter } from './adapters/telegram.js';
import { FeishuAdapter } from './adapters/feishu.js';
import { SlackBotAdapter } from './adapters/slack-bot.js';
import { WhatsAppAdapter } from './adapters/whatsapp.js';
import { configManager } from '../../../config/index.js';

// ============================================================================
// 适配器注册表
// ============================================================================

/**
 * 已知的通道适配器工厂
 * 新增通道只需在这里加一行
 */
const ADAPTER_FACTORIES: Record<string, () => ChannelAdapter> = {
  telegram: () => new TelegramAdapter(),
  feishu: () => new FeishuAdapter(),
  'slack-bot': () => new SlackBotAdapter(),
  whatsapp: () => new WhatsAppAdapter(),
};

/**
 * 通道的配置引导提示
 */
const CONFIG_HINTS: Record<string, string> = {
  telegram: 'Get a Bot Token from @BotFather on Telegram, then set channels.telegram.credentials.botToken',
  feishu: 'Create a bot in Feishu Developer Console, then set channels.feishu.credentials.appId and appSecret',
  'slack-bot': 'Create a Slack App with Bot Token, then set channels.slack-bot.credentials.botToken',
  whatsapp: 'Create a Meta App with WhatsApp API, set accessToken, phoneNumberId, and verifyToken. Webhook URL: /webhook/whatsapp',
};

// ============================================================================
// ChannelManager
// ============================================================================

export class ChannelManager {
  private adapters = new Map<string, ChannelAdapter>();
  private bridge: IMBridge;
  private broadcast?: (msg: ChannelServerMessage) => void;

  constructor(
    private conversationManager: ConversationManager,
    private defaultModel: string = 'sonnet',
    private cwd: string = process.cwd(),
  ) {
    this.bridge = new IMBridge(
      conversationManager,
      (channelId) => this.adapters.get(channelId),
      (msg) => this.broadcast?.(msg),
      defaultModel,
      cwd,
      (channelId) => this.getChannelConfig(channelId),
      (channelId, allowList) => this.updateChannelAllowList(channelId, allowList),
    );
  }

  /**
   * 设置广播函数（向所有 WebSocket 客户端推送通道事件）
   */
  setBroadcast(fn: (msg: ChannelServerMessage) => void): void {
    this.broadcast = fn;
  }

  /**
   * 初始化：从配置中读取已启用的通道并自动启动
   */
  async initialize(): Promise<void> {
    const channelsConfig = this.getChannelsConfig();
    if (!channelsConfig || Object.keys(channelsConfig).length === 0) {
      console.log('[ChannelManager] No channels configured');
      return;
    }

    for (const [channelId, config] of Object.entries(channelsConfig)) {
      if (!config.enabled) continue;

      if (!ADAPTER_FACTORIES[channelId]) {
        console.warn(`[ChannelManager] Unknown channel: ${channelId}, skipping`);
        continue;
      }

      try {
        await this.startChannel(channelId, config);
      } catch (error) {
        console.error(`[ChannelManager] Failed to start channel ${channelId}:`, error);
      }
    }
  }

  /**
   * 启动单个通道
   */
  async startChannel(channelId: string, config?: ChannelConfig): Promise<void> {
    // 如果已经在运行，先停止
    if (this.adapters.has(channelId)) {
      await this.stopChannel(channelId);
    }

    const factory = ADAPTER_FACTORIES[channelId];
    if (!factory) {
      throw new Error(`Unknown channel: ${channelId}. Supported: ${Object.keys(ADAPTER_FACTORIES).join(', ')}`);
    }

    // 从配置中读取（如果没传入 config）
    if (!config) {
      const channelsConfig = this.getChannelsConfig();
      config = channelsConfig?.[channelId];
      if (!config) {
        throw new Error(`No configuration found for channel: ${channelId}`);
      }
    }

    const adapter = factory();
    this.adapters.set(channelId, adapter);

    console.log(`[ChannelManager] Starting channel: ${channelId}`);

    await adapter.start(config, (msg) => {
      // 入站消息 → IMBridge 处理
      this.bridge.handleInboundMessage(msg).catch(err => {
        console.error(`[ChannelManager] Error handling inbound message from ${channelId}:`, err);
      });
    });

    // 广播状态更新
    this.broadcastStatusUpdate(channelId);
  }

  /**
   * 停止单个通道
   */
  async stopChannel(channelId: string): Promise<void> {
    const adapter = this.adapters.get(channelId);
    if (!adapter) return;

    console.log(`[ChannelManager] Stopping channel: ${channelId}`);
    await adapter.stop();
    this.adapters.delete(channelId);
    this.broadcastStatusUpdate(channelId);
  }

  /**
   * 停止所有通道
   */
  async stopAll(): Promise<void> {
    const ids = [...this.adapters.keys()];
    for (const id of ids) {
      await this.stopChannel(id).catch(err => {
        console.error(`[ChannelManager] Error stopping channel ${id}:`, err);
      });
    }
  }

  /**
   * 更新通道配置（保存到 settings.json 并重启通道）
   */
  async updateChannelConfig(channelId: string, config: Partial<ChannelConfig>): Promise<void> {
    const channelsConfig = this.getChannelsConfig() || {};
    const existing = channelsConfig[channelId] || { enabled: false, credentials: {} };
    const merged = { ...existing, ...config };

    // 合并 credentials（不覆盖未传入的字段）
    if (config.credentials) {
      merged.credentials = { ...existing.credentials, ...config.credentials };
    }

    channelsConfig[channelId] = merged;
    configManager.save({ channels: channelsConfig } as any);

    // 如果正在运行，重启以应用新配置
    if (this.adapters.has(channelId) && merged.enabled) {
      await this.stopChannel(channelId);
      await this.startChannel(channelId, merged);
    } else if (!merged.enabled) {
      await this.stopChannel(channelId);
    }
  }

  /**
   * 获取所有通道的状态（供 Web UI 展示）
   */
  getAllStatus(): ChannelStatusInfo[] {
    const channelsConfig = this.getChannelsConfig() || {};
    const result: ChannelStatusInfo[] = [];

    for (const channelId of Object.keys(ADAPTER_FACTORIES)) {
      const config = channelsConfig[channelId];
      const adapter = this.adapters.get(channelId);
      const configured = !!(config?.credentials && Object.values(config.credentials).some(v => !!v));

      result.push({
        id: channelId,
        name: adapter?.name || channelId.charAt(0).toUpperCase() + channelId.slice(1),
        status: adapter?.getStatus() || 'disconnected',
        enabled: config?.enabled || false,
        configured,
        configureHint: !configured ? CONFIG_HINTS[channelId] : undefined,
      });
    }

    return result;
  }

  /**
   * 获取特定通道的适配器（供 bridge 使用）
   */
  getAdapter(channelId: string): ChannelAdapter | undefined {
    return this.adapters.get(channelId);
  }

  // ==========================================================================
  // Pairing 配对
  // ==========================================================================

  getPairingRequests(): PairingRequest[] {
    return this.bridge.getPairingRequests();
  }

  async approvePairing(code: string): Promise<{ success: boolean; error?: string }> {
    return this.bridge.approvePairing(code);
  }

  denyPairing(code: string): { success: boolean; error?: string } {
    return this.bridge.denyPairing(code);
  }

  // ==========================================================================
  // 内部方法
  // ==========================================================================

  private getChannelConfig(channelId: string): ChannelConfig | undefined {
    return this.getChannelsConfig()?.[channelId];
  }

  /**
   * 更新通道的 allowList（Pairing 审批后调用）
   */
  private async updateChannelAllowList(channelId: string, allowList: string[]): Promise<void> {
    const channelsConfig = this.getChannelsConfig() || {};
    const config = channelsConfig[channelId];
    if (!config) return;

    config.allowList = allowList;
    channelsConfig[channelId] = config;
    configManager.save({ channels: channelsConfig } as any);

    // 如果通道正在运行，需要让适配器知道新的 allowList
    // 适配器会在下次 checkAccess 时读取最新配置
  }

  /**
   * 设置 Webhook 路由（WhatsApp 等需要公网回调的通道）
   * 在 Express app 上挂载 /webhook/:channelId 路由
   */
  setupWebhookRoutes(app: any): void {
    // WhatsApp webhook
    app.get('/webhook/whatsapp', (req: any, res: any) => {
      const adapter = this.adapters.get('whatsapp') as WhatsAppAdapter | undefined;
      if (!adapter) {
        // 即使适配器未启动，也尝试用配置中的 verifyToken 做验证
        // 这样可以在 Meta 配置 webhook 时就通过验证
        const config = this.getChannelConfig('whatsapp');
        const verifyToken = config?.credentials?.verifyToken;
        if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken) {
          return res.status(200).send(req.query['hub.challenge']);
        }
        return res.status(403).send('Forbidden');
      }
      const result = adapter.handleWebhookVerify(req.query);
      res.status(result.status).send(result.body);
    });

    app.post('/webhook/whatsapp', (req: any, res: any) => {
      const adapter = this.adapters.get('whatsapp') as WhatsAppAdapter | undefined;
      if (!adapter) {
        return res.sendStatus(200); // Meta 要求始终返回 200
      }
      adapter.handleWebhookMessage(req.body);
      res.sendStatus(200); // 必须快速返回 200，否则 Meta 会重试
    });

    console.log('[ChannelManager] Webhook routes registered: /webhook/whatsapp');
  }

  private getChannelsConfig(): ChannelsConfig | undefined {
    // UserConfigSchema.parse() strips unknown fields (like 'channels') from mergedConfig,
    // so we read directly from settings.json to avoid the Zod stripping issue.
    try {
      const settingsPath = configManager.getConfigPaths().userSettings;
      if (fs.existsSync(settingsPath)) {
        const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        return raw.channels as ChannelsConfig | undefined;
      }
    } catch {
      // fall through
    }
    return undefined;
  }

  private broadcastStatusUpdate(channelId: string): void {
    const statuses = this.getAllStatus();
    const status = statuses.find(s => s.id === channelId);
    if (status) {
      this.broadcast?.({
        type: 'channel:status_update',
        payload: status,
      });
    }
  }
}
