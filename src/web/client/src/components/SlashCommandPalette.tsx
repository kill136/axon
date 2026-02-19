import { useState, useEffect, useRef } from 'react';
import { getAllSlashCommands } from '../utils/constants';
import type { SlashCommand } from '../types';
import { useLanguage } from '../i18n';

// 命令图标映射
const COMMAND_ICONS: Record<string, string> = {
  '/help': '❓',
  '/clear': '🗑️',
  '/status': '📊',
  '/compact': '📦',
  '/cost': '💰',
  '/resume': '⏪',
  '/model': '🤖',
  '/config': '⚙️',
  '/mcp': '🔌',
  '/tasks': '📋',
  '/doctor': '🩺',
  '/plugin': '🧩',
  '/login': '🔑',
  '/logout': '🚪',
};

// 分类显示顺序
const CATEGORY_ORDER = ['general', 'session', 'config', 'utility', 'integration', 'auth', 'development', 'skill'];

interface SlashCommandPaletteProps {
  input: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export function SlashCommandPalette({ input, onSelect, onClose }: SlashCommandPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const paletteRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();

  const query = input.slice(1).toLowerCase();
  const allCommands = getAllSlashCommands();
  const filteredCommands = allCommands.filter(cmd =>
    cmd.name.slice(1).startsWith(query) ||
    cmd.aliases?.some(a => a.slice(1).startsWith(query))
  );

  // 按 category 分组
  const grouped: Record<string, SlashCommand[]> = {};
  for (const cmd of filteredCommands) {
    const cat = cmd.category || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(cmd);
  }

  // 按照预定顺序排列分组
  const orderedCategories = CATEGORY_ORDER.filter(cat => grouped[cat]?.length > 0);

  // 重置选中索引当过滤结果变化时
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (filteredCommands.length > 0) {
          e.preventDefault();
          onSelect(filteredCommands[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filteredCommands, selectedIndex, onSelect, onClose]);

  if (filteredCommands.length === 0) return null;

  let globalIndex = 0;

  return (
    <div ref={paletteRef} className="slash-command-palette">
      {orderedCategories.map(category => (
        <div key={category} className="slash-command-group">
          <div className="slash-command-category">
            <span className="category-line" />
            <span className="category-label">{t(`slashCommand.category.${category}`)}</span>
          </div>
          {grouped[category].map(cmd => {
            const idx = globalIndex++;
            const icon = cmd.category === 'skill' ? '✨' : (COMMAND_ICONS[cmd.name] || '•');
            return (
              <div
                key={cmd.name}
                className={`slash-command-item ${idx === selectedIndex ? 'selected' : ''}`}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="command-icon">{icon}</span>
                <span className="command-name">{cmd.name}</span>
                <span className="command-desc">{cmd.description}</span>
                {cmd.category === 'skill' && (
                  <span className="skill-badge">SKILL</span>
                )}
                {cmd.usage && <span className="command-usage">{cmd.usage}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
