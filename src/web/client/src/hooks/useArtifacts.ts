import { useState, useMemo, useEffect, useRef } from 'react';
import type { ChatMessage, ToolStatus } from '../types';
import { getEditOperations, getToolResultText } from '../utils/editTool';
import type { EditOperation } from '../utils/editTool';

export interface FileArtifact {
  id: string;
  filePath: string;
  toolName: 'Edit' | 'Write' | 'MultiEdit';
  timestamp: number;
  messageId: string;
  toolUseId: string;
  status: ToolStatus;
  oldString?: string;
  newString?: string;
  content?: string;
  editOperations?: EditOperation[];
  resultText?: string;
}

export interface ArtifactGroup {
  filePath: string;
  artifacts: FileArtifact[];
  latestTimestamp: number;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeToolStatus(status: string): ToolStatus {
  if (status === 'running') return 'running';
  if (status === 'error') return 'error';
  return 'completed';
}

function createEditArtifact({
  id,
  input,
  messageId,
  resultText,
  status,
  timestamp,
  toolName,
  toolUseId,
}: {
  id: string;
  input: any;
  messageId: string;
  resultText?: string;
  status: ToolStatus;
  timestamp: number;
  toolName: 'Edit' | 'MultiEdit';
  toolUseId: string;
}): FileArtifact {
  const editOperations = getEditOperations(input);

  return {
    id,
    filePath: normalizePath(input.file_path),
    toolName,
    timestamp,
    messageId,
    toolUseId,
    status,
    oldString: typeof input?.old_string === 'string' ? input.old_string : undefined,
    newString: typeof input?.new_string === 'string' ? input.new_string : undefined,
    editOperations: editOperations.length > 0 ? editOperations : undefined,
    resultText: resultText || undefined,
  };
}

export function useArtifacts(messages: ChatMessage[]) {
  const artifacts = useMemo(() => {
    const result: FileArtifact[] = [];

    for (const msg of messages) {
      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;

        const toolUse = block as any;
        const input = toolUse.input as any;
        const resultText = getToolResultText(toolUse.result);

        if ((toolUse.name === 'Edit' || toolUse.name === 'MultiEdit') && input?.file_path) {
          result.push(createEditArtifact({
            id: `${msg.id}-${toolUse.id}`,
            input,
            messageId: msg.id,
            resultText,
            status: toolUse.status,
            timestamp: msg.timestamp,
            toolName: toolUse.name,
            toolUseId: toolUse.id,
          }));
        } else if (toolUse.name === 'Write' && input?.file_path) {
          result.push({
            id: `${msg.id}-${toolUse.id}`,
            filePath: normalizePath(input.file_path),
            toolName: 'Write',
            timestamp: msg.timestamp,
            messageId: msg.id,
            toolUseId: toolUse.id,
            status: toolUse.status,
            content: input.content,
          });
        }

        // 递归扫描 Task / ScheduleTask 工具的 subagentToolCalls
        if ((toolUse.name === 'Task' || toolUse.name === 'ScheduleTask') && toolUse.subagentToolCalls) {
          for (const sub of toolUse.subagentToolCalls) {
            const subInput = sub.input as any;
            if (!subInput?.file_path) continue;
            const subStatus = normalizeToolStatus(sub.status);
            const subResultText = getToolResultText(sub.result) || (typeof sub.error === 'string' ? sub.error : '');

            if (sub.name === 'Edit' || sub.name === 'MultiEdit') {
              result.push(createEditArtifact({
                id: `${msg.id}-${sub.id}`,
                input: subInput,
                messageId: msg.id,
                resultText: subResultText,
                status: subStatus,
                timestamp: sub.startTime || msg.timestamp,
                toolName: sub.name,
                toolUseId: sub.id,
              }));
            } else if (sub.name === 'Write') {
              result.push({
                id: `${msg.id}-${sub.id}`,
                filePath: normalizePath(subInput.file_path),
                toolName: 'Write',
                timestamp: sub.startTime || msg.timestamp,
                messageId: msg.id,
                toolUseId: sub.id,
                status: subStatus,
                content: subInput.content,
              });
            }
          }
        }
      }
    }

    return result;
  }, [messages]);

  // 按文件路径分组
  const groups = useMemo(() => {
    const map = new Map<string, ArtifactGroup>();
    for (const a of artifacts) {
      const existing = map.get(a.filePath);
      if (existing) {
        existing.artifacts.push(a);
        existing.latestTimestamp = Math.max(existing.latestTimestamp, a.timestamp);
      } else {
        map.set(a.filePath, {
          filePath: a.filePath,
          artifacts: [a],
          latestTimestamp: a.timestamp,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  }, [artifacts]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // 新产物出现时自动打开面板
  const prevCountRef = useRef(artifacts.length);
  useEffect(() => {
    if (artifacts.length > prevCountRef.current && artifacts.length > 0) {
      setIsPanelOpen(true);
    }
    prevCountRef.current = artifacts.length;
  }, [artifacts.length]);

  const selectedArtifact = useMemo(
    () => artifacts.find(a => a.id === selectedId) || null,
    [artifacts, selectedId]
  );

  return {
    artifacts,
    groups,
    selectedId,
    setSelectedId,
    selectedArtifact,
    isPanelOpen,
    setIsPanelOpen,
  };
}
