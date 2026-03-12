/**
 * CapabilitiesPanel - 能力全景面板
 *
 * 聚合展示 AI 的所有能力来源：
 * - 内置工具（active / deferred）
 * - Skills（已安装的技能）
 * - MCP Servers（enabled / disabled）
 *
 * 让用户一眼看到"AI 此刻能做什么"。
 */

import { useState, useEffect } from 'react';
import { useLanguage } from '../../i18n';
import styles from './CapabilitiesPanel.module.css';

interface CapabilityItem {
  name: string;
  description: string;
  source: 'builtin' | 'skill' | 'mcp';
  status: 'active' | 'disabled';
  deferred?: boolean;
  tools?: string[];
}

interface CapabilitySummary {
  totalBuiltin: number;
  activeBuiltin: number;
  deferredBuiltin: number;
  totalSkills: number;
  mcpEnabled: number;
  mcpDisabled: number;
}

interface CapabilitiesData {
  builtin: CapabilityItem[];
  skills: CapabilityItem[];
  mcp: {
    enabled: CapabilityItem[];
    disabled: CapabilityItem[];
  };
  summary: CapabilitySummary;
}

export default function CapabilitiesPanel() {
  const { t } = useLanguage();
  const [data, setData] = useState<CapabilitiesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/capabilities')
      .then(res => res.json())
      .then(json => {
        setData(json);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className={styles.loading}>{t('common.loading') || 'Loading...'}</div>;
  }

  if (error || !data) {
    return <div className={styles.error}>{error || 'Failed to load capabilities'}</div>;
  }

  const { builtin, skills, mcp, summary } = data;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2>{t('customize.capabilities') || 'Capabilities'}</h2>
        <p>{t('customize.capabilitiesDesc') || 'Everything I can do right now — built-in tools, installed skills, and connected services.'}</p>
      </div>

      {/* Summary cards */}
      <div className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryNumber}>{summary.activeBuiltin}</span>
          <span className={styles.summaryLabel}>{t('customize.cap.activeTools') || 'Active Tools'}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryNumber}>{summary.deferredBuiltin}</span>
          <span className={styles.summaryLabel}>{t('customize.cap.deferredTools') || 'Deferred Tools'}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryNumber}>{summary.totalSkills}</span>
          <span className={styles.summaryLabel}>{t('customize.cap.skills') || 'Skills'}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryNumber}>{summary.mcpEnabled + summary.mcpDisabled}</span>
          <span className={styles.summaryLabel}>{t('customize.cap.mcpServers') || 'MCP Servers'}</span>
        </div>
      </div>

      {/* Built-in Tools */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>{t('customize.cap.builtinTools') || 'Built-in Tools'}</h3>
          <span className={styles.sectionCount}>{summary.totalBuiltin}</span>
        </div>
        <div className={styles.itemGrid}>
          {builtin.map(item => (
            <div key={item.name} className={styles.item}>
              <span className={`${styles.itemIcon} ${item.deferred ? styles.deferred : styles.active}`} />
              <div>
                <div className={styles.itemName}>{item.name}</div>
                <div className={styles.itemDesc}>{item.description}</div>
              </div>
              {item.deferred && <span className={styles.badge}>deferred</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Skills */}
      {skills.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>{t('customize.cap.skillsSection') || 'Installed Skills'}</h3>
            <span className={styles.sectionCount}>{skills.length}</span>
          </div>
          <div className={styles.itemGrid}>
            {skills.map(item => (
              <div key={item.name} className={styles.item}>
                <span className={`${styles.itemIcon} ${styles.active}`} />
                <div>
                  <div className={styles.itemName}>{item.name}</div>
                  <div className={styles.itemDesc}>{item.description}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MCP Servers */}
      {(mcp.enabled.length > 0 || mcp.disabled.length > 0) && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>{t('customize.cap.mcpSection') || 'MCP Servers'}</h3>
            <span className={styles.sectionCount}>{mcp.enabled.length + mcp.disabled.length}</span>
          </div>
          <div className={styles.itemGrid}>
            {mcp.enabled.map(item => (
              <div key={item.name} className={styles.item}>
                <span className={`${styles.itemIcon} ${styles.active}`} />
                <div>
                  <div className={styles.itemName}>{item.name}</div>
                  <div className={styles.itemDesc}>
                    {item.description}
                    {item.tools && item.tools.length > 0 && (
                      <span> ({item.tools.length} tools)</span>
                    )}
                  </div>
                </div>
                <span className={styles.badge}>active</span>
              </div>
            ))}
            {mcp.disabled.map(item => (
              <div key={item.name} className={styles.item}>
                <span className={`${styles.itemIcon} ${styles.disabled}`} />
                <div>
                  <div className={styles.itemName}>{item.name}</div>
                  {item.description && (
                    <div className={styles.itemDesc}>{item.description}</div>
                  )}
                </div>
                <span className={styles.badge}>disabled</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
