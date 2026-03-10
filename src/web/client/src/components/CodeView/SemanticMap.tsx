import React from 'react';
import type { TourStep } from '../../api/ai-editor';
import { useLanguage } from '../../i18n';
import styles from './SemanticMap.module.css';

/**
 * SemanticMap Props
 */
export interface SemanticMapProps {
  /** 导游步骤数组 */
  steps: TourStep[];
  /** 编辑器当前可见中心行号 */
  currentLine: number;
  /** 点击区块时调用 */
  onNavigate: (line: number) => void;
  /** 文件总行数 */
  totalLines: number;
}

/**
 * 获取区块图标
 */
const getStepIcon = (step: TourStep): string => {
  // 导入声明
  if (step.name === 'Import Declarations' || step.name === '导入声明') {
    return '📦';
  }

  // interface/type 类型定义
  if (
    step.name.toLowerCase().includes('interface') ||
    step.name.toLowerCase().includes('type') ||
    (step.type === 'block' && /^[A-Z].*?(Props|Options)$/.test(step.name))
  ) {
    return '📐';
  }

  // React 组件（首字母大写）
  if (step.type === 'function' && /^[A-Z]/.test(step.name)) {
    return '🧩';
  }

  // 类
  if (step.type === 'class') {
    return '🏗️';
  }

  // 函数
  if (step.type === 'function') {
    return '⚡';
  }

  // 其他
  return '📄';
};

/**
 * SemanticMap - 语义地图组件
 * 在编辑器右侧显示文件结构
 */
export const SemanticMap: React.FC<SemanticMapProps> = ({
  steps,
  currentLine,
  onNavigate,
  totalLines,
}) => {
  const { t } = useLanguage();
  return (
    <div className={styles.semanticMap}>
      {/* 标题栏 */}
      <div className={styles.semanticMapHeader}>
        📋 {t('semanticMap.fileStructure')} ({steps.length})
      </div>

      {/* 区块列表 */}
      {steps.length === 0 ? (
        <div className={styles.semanticMapEmpty}>
          <div className={styles.semanticMapEmptyIcon}>📄</div>
          <div className={styles.semanticMapEmptyText}>{t('semanticMap.noStructure')}</div>
        </div>
      ) : (
        <div className={styles.semanticMapItems}>
          {steps.map((step, index) => {
            // 判断是否为当前激活区块
            const isActive =
              currentLine >= step.line &&
              (step.endLine ? currentLine <= step.endLine : true);

            return (
              <div
                key={index}
                className={`${styles.semanticMapItem} ${isActive ? styles.active : ''}`}
                onClick={() => onNavigate(step.line)}
              >
                {/* 图标 + 名称 */}
                <div className={styles.itemHeader}>
                  <span className={styles.itemIcon}>{getStepIcon(step)}</span>
                  <div className={styles.itemName}>{step.name}</div>
                </div>

                {/* 行号 */}
                <div className={styles.itemLine}>
                  L{step.line}{step.endLine ? `-${step.endLine}` : ''}
                </div>

                {/* 描述 */}
                {step.description && (
                  <div className={styles.itemDesc}>{step.description}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SemanticMap;
