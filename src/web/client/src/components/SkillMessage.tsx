/**
 * Skill 消息组件
 * 解析和渲染 <command-message> 和 <skill> 标签
 */

import { useState, useRef, useEffect } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import { sanitizeHtml } from '../utils/sanitize';
import './SkillMessage.css';

/**
 * 解析 XML 标签内容
 */
function parseXmlTag(content: string, tagName: string): { content: string; attributes: Record<string, string> } | null {
  const regex = new RegExp(`<${tagName}([^>]*)>([\\s\\S]*?)<\/${tagName}>`, 'i');
  const match = content.match(regex);

  if (!match) return null;

  const attributesStr = match[1] || '';
  const innerContent = match[2] || '';

  // 解析属性
  const attributes: Record<string, string> = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let attrMatch;
  while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
    attributes[attrMatch[1]] = attrMatch[2];
  }

  return { content: innerContent, attributes };
}

/**
 * 检查文本是否包含 Skill 消息标签或系统提醒
 */
export function isSkillMessage(text: string): boolean {
  return text.includes('<command-message>') || text.includes('<skill') || text.includes('<system-reminder>');
}

/**
 * Skill 消息组件属性
 */
interface SkillMessageProps {
  text: string;
}

/**
 * Markdown 渲染组件（内部使用）
 */
function MarkdownRenderer({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && content) {
      ref.current.innerHTML = sanitizeHtml(marked.parse(content) as string);
      ref.current.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block as HTMLElement);
      });
    }
  }, [content]);

  return <div ref={ref} className="skill-markdown-content" />;
}

/**
 * Skill 消息组件
 */
export function SkillMessage({ text }: SkillMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // 解析 command-message
  const commandMessage = parseXmlTag(text, 'command-message');

  // 解析 skill 标签
  const skillInfo = parseXmlTag(text, 'skill');

  // 解析 system-reminder（附件）
  const systemReminder = parseXmlTag(text, 'system-reminder');

  // 如果是纯 system-reminder（附件），使用简化渲染
  if (systemReminder && !commandMessage && !skillInfo) {
    return (
      <div className="skill-message attachment-message">
        <div className="attachment-header">
          <button
            className="attachment-toggle-btn"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            <span className="attachment-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
            <span className="attachment-label">📎 System Context</span>
          </button>
        </div>
        {isExpanded && (
          <div className="attachment-content">
            <MarkdownRenderer content={systemReminder.content} />
          </div>
        )}
      </div>
    );
  }

  if (!commandMessage && !skillInfo) {
    // 如果没有任何标签，返回普通文本
    return <div className="skill-message-fallback">{text}</div>;
  }

  return (
    <div className="skill-message">
      {/* 命令消息头部 */}
      {commandMessage && (
        <div className="skill-message-header">
          <div className="skill-loading-indicator">
            <span className="skill-spinner"></span>
            <span className="skill-loading-text">{commandMessage.content}</span>
          </div>
        </div>
      )}

      {/* Skill 内容区域 */}
      {skillInfo && (
        <div className="skill-content-wrapper">
          {/* Skill 元信息 */}
          <div className="skill-meta">
            <button
              className="skill-toggle-btn"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              <span className="skill-toggle-icon">{isExpanded ? '▼' : '▶'}</span>
              <span className="skill-name">{skillInfo.attributes.name || 'Skill'}</span>
            </button>

            <div className="skill-badges">
              {skillInfo.attributes.location && (
                <span className="skill-badge skill-badge-location">
                  {skillInfo.attributes.location}
                </span>
              )}
              {skillInfo.attributes.version && (
                <span className="skill-badge skill-badge-version">
                  v{skillInfo.attributes.version}
                </span>
              )}
              {skillInfo.attributes.model && (
                <span className="skill-badge skill-badge-model">
                  {skillInfo.attributes.model}
                </span>
              )}
            </div>
          </div>

          {/* Skill 内容（可折叠）*/}
          {isExpanded && (
            <div className="skill-content">
              <MarkdownRenderer content={skillInfo.content} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
