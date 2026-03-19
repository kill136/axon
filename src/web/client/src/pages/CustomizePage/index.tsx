import React, { useState } from 'react';
import { useLanguage } from '../../i18n';
import ConnectorsPanel from './ConnectorsPanel';
import SkillsPanel from './SkillsPanel';
import McpServerPanel from './McpServerPanel';
import CapabilitiesPanel from './CapabilitiesPanel';
import SchedulePage from '../SchedulePage';
import ChannelsPanel from '../../components/ChannelsPanel';
import PerceptionPanel from '../../components/PerceptionPanel';
import ProxyPanel from '../../components/ProxyPanel';
import DocsPanel from './DocsPanel';
import NetworkPanel from './NetworkPanel';
import TunnelPanel from './TunnelPanel';
import styles from './CustomizePage.module.css';

type ActiveSection = 'capabilities' | 'skills' | 'mcp' | 'connectors' | 'channels' | 'schedule' | 'perception' | 'proxy' | 'network' | 'tunnel' | 'aiprofile';

interface CustomizePageProps {
  onNavigateBack?: () => void;
  onSendMessage?: (message: any) => void;
  addMessageHandler?: (handler: (msg: any) => void) => () => void;
  sessionId?: string;
}

// SVG Icons
const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 12L6 8l4-4" />
  </svg>
);

const SkillsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2l1.5 4.5H14l-3.5 2.5 1.5 4.5L8 11l-3.5 2.5 1.5-4.5L2 6.5h4.5z" />
  </svg>
);

const McpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2v4M8 10v4" />
    <path d="M4 6h8" />
    <path d="M4 10h8" />
    <circle cx="8" cy="8" r="6" />
  </svg>
);

const ConnectorsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2h3v3M6 14H3v-3" />
    <path d="M14 2l-5.5 5.5M2 14l5.5-5.5" />
    <circle cx="8.5" cy="7.5" r="1" fill="currentColor" />
  </svg>
);

const ChannelsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4h3l2 8h2l2-8h3" />
    <circle cx="4" cy="4" r="1.5" />
    <circle cx="12" cy="4" r="1.5" />
    <circle cx="8" cy="12" r="1.5" />
  </svg>
);

const ScheduleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4v4l3 2" />
  </svg>
);

const PerceptionIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="6" r="3" />
    <path d="M2 6c0-3.3 2.7-4 6-4s6 .7 6 4" />
    <path d="M4 10c0 2 1.8 4 4 4s4-2 4-4" />
  </svg>
);

const ProxyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 8h4M10 8h4" />
    <rect x="6" y="5" width="4" height="6" rx="1" />
    <path d="M1 8h1M14 8h1" />
    <circle cx="3" cy="8" r="0.5" fill="currentColor" />
    <circle cx="13" cy="8" r="0.5" fill="currentColor" />
  </svg>
);

const CapabilitiesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="2" />
    <circle cx="8" cy="8" r="6" />
    <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
  </svg>
);

const NetworkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="3" r="2" />
    <circle cx="3" cy="13" r="2" />
    <circle cx="13" cy="13" r="2" />
    <path d="M8 5v3M6 10l-2 1M10 10l2 1" />
    <circle cx="8" cy="9" r="1" fill="currentColor" />
  </svg>
);

const TunnelIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 8c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <path d="M4 8c0-2.2 1.8-4 4-4s4 1.8 4 4" />
    <circle cx="8" cy="8" r="1.5" fill="currentColor" />
    <path d="M8 9.5v4.5" />
    <path d="M6 14h4" />
  </svg>
);

const AiProfileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="5" r="3" />
    <path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5" />
    <path d="M11 3l1.5 1.5" />
    <circle cx="12.5" cy="2" r="1" />
  </svg>
);

/**
 * CustomizePage - 自定义页面（Skills + MCP + Connectors）
 * 
 * 三栏布局：
 * - 左栏（220px）：导航菜单（← 自定义 / 技能 / MCP 服务器 / 连接器）
 * - 中栏和右栏：由各子面板渲染
 */
export default function CustomizePage({
  onNavigateBack,
  onSendMessage,
  addMessageHandler,
  sessionId,
}: CustomizePageProps) {
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState<ActiveSection>('capabilities');

  return (
    <div className={styles.customizePage}>
      {/* 左侧导航栏 */}
      <div className={styles.leftNav}>
        {/* 返回按钮 */}
        <button
          className={styles.backButton}
          onClick={() => onNavigateBack?.()}
          title={t('nav.chat')}
        >
          <BackIcon />
          <span>{t('customize.title')}</span>
        </button>

        {/* 导航菜单 */}
        <nav className={styles.navMenu}>
          <button
            className={`${styles.navItem} ${activeSection === 'capabilities' ? styles.active : ''}`}
            onClick={() => setActiveSection('capabilities')}
          >
            <span className={styles.navIcon}>
              <CapabilitiesIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.capabilities') || 'Capabilities'}</span>
          </button>

          <button
            className={`${styles.navItem} ${activeSection === 'skills' ? styles.active : ''}`}
            onClick={() => setActiveSection('skills')}
          >
            <span className={styles.navIcon}>
              <SkillsIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.skills')}</span>
          </button>

          <button
            className={`${styles.navItem} ${activeSection === 'mcp' ? styles.active : ''}`}
            onClick={() => setActiveSection('mcp')}
          >
            <span className={styles.navIcon}>
              <McpIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.mcp')}</span>
          </button>

          <button
            className={`${styles.navItem} ${activeSection === 'connectors' ? styles.active : ''}`}
            onClick={() => setActiveSection('connectors')}
          >
            <span className={styles.navIcon}>
              <ConnectorsIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.connectors')}</span>
          </button>

          <button
            className={`${styles.navItem} ${activeSection === 'channels' ? styles.active : ''}`}
            onClick={() => setActiveSection('channels')}
          >
            <span className={styles.navIcon}>
              <ChannelsIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.channels') || 'IM Channels'}</span>
          </button>

          <button
            className={`${styles.navItem} ${activeSection === 'schedule' ? styles.active : ''}`}
            onClick={() => setActiveSection('schedule')}
          >
            <span className={styles.navIcon}>
              <ScheduleIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.schedule')}</span>
          </button>

          <button
            className={`${styles.navItem} ${activeSection === 'perception' ? styles.active : ''}`}
            onClick={() => setActiveSection('perception')}
          >
            <span className={styles.navIcon}>
              <PerceptionIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.perception')}</span>
          </button>

          <button
            className={`${styles.navItem} ${activeSection === 'proxy' ? styles.active : ''}`}
            onClick={() => setActiveSection('proxy')}
          >
            <span className={styles.navIcon}>
              <ProxyIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.proxy')}</span>
          </button>

          <button
            className={`${styles.navItem} ${activeSection === 'network' ? styles.active : ''}`}
            onClick={() => setActiveSection('network')}
          >
            <span className={styles.navIcon}>
              <NetworkIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.network') || 'Agent Network'}</span>
          </button>

          <button
            className={`${styles.navItem} ${activeSection === 'tunnel' ? styles.active : ''}`}
            onClick={() => setActiveSection('tunnel')}
          >
            <span className={styles.navIcon}>
              <TunnelIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.tunnel')}</span>
          </button>

          <button
            className={`${styles.navItem} ${activeSection === 'aiprofile' ? styles.active : ''}`}
            onClick={() => setActiveSection('aiprofile')}
          >
            <span className={styles.navIcon}>
              <AiProfileIcon />
            </span>
            <span className={styles.navLabel}>{t('customize.aiProfile')}</span>
          </button>
        </nav>
      </div>

      {/* 右侧内容区（中栏 + 右栏由子组件渲染） */}
      <div className={styles.contentArea}>
        {activeSection === 'capabilities' && (
          <CapabilitiesPanel />
        )}
        {activeSection === 'skills' && (
          <SkillsPanel
            onSendMessage={onSendMessage}
            addMessageHandler={addMessageHandler}
          />
        )}
        {activeSection === 'mcp' && (
          <McpServerPanel
            onSendMessage={onSendMessage}
            addMessageHandler={addMessageHandler}
          />
        )}
        {activeSection === 'connectors' && (
          <ConnectorsPanel />
        )}
        {activeSection === 'channels' && (
          <ChannelsPanel
            onSendMessage={onSendMessage}
            addMessageHandler={addMessageHandler}
            webUiSessionId={sessionId}
          />
        )}
        {activeSection === 'schedule' && (
          <SchedulePage />
        )}
        {activeSection === 'perception' && (
          <PerceptionPanel
            onSendMessage={onSendMessage}
            addMessageHandler={addMessageHandler}
          />
        )}
        {activeSection === 'proxy' && (
          <ProxyPanel
            onSendMessage={onSendMessage}
            addMessageHandler={addMessageHandler}
          />
        )}
        {activeSection === 'network' && (
          <NetworkPanel
            onSendMessage={onSendMessage}
            addMessageHandler={addMessageHandler}
          />
        )}
        {activeSection === 'tunnel' && (
          <TunnelPanel />
        )}
        {activeSection === 'aiprofile' && (
          <DocsPanel />
        )}
      </div>
    </div>
  );
}
