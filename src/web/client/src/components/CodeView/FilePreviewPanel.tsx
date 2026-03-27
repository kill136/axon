import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { renderAsync } from 'docx-preview';
import styles from './CodeEditor.module.css';

export interface FilePreviewPanelProps {
  filePath: string;
  fileType: 'image' | 'pdf' | 'excel' | 'word';
  content: string;  // blob URL (for excel/word) or empty (for image/pdf)
  projectPath?: string;
}

/**
 * 办公文档预览面板
 * 支持：图片、PDF、Excel、Word
 */
export const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  filePath,
  fileType,
  content,
  projectPath,
}) => {
  const [excelHtml, setExcelHtml] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wordContainerRef = useRef<HTMLDivElement>(null);

  const downloadUrl = `/api/files/download?inline=1&path=${encodeURIComponent(filePath)}${projectPath ? `&root=${encodeURIComponent(projectPath)}` : ''}`;

  // ============ Excel 预览逻辑 ============
  useEffect(() => {
    if (fileType !== 'excel' || !content) return;

    const loadExcel = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(content);
        const arrayBuffer = await response.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        // 获取第一个 sheet
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // 转换为 HTML
        const html = XLSX.utils.sheet_to_html(worksheet);
        setExcelHtml(html);
      } catch (err) {
        console.error('[FilePreviewPanel] Excel 解析失败:', err);
        setError(`Failed to load Excel file: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };

    loadExcel();
  }, [fileType, content]);

  // ============ Word 预览逻辑 ============
  useEffect(() => {
    if (fileType !== 'word' || !content || !wordContainerRef.current) return;

    const loadWord = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(content);
        const arrayBuffer = await response.arrayBuffer();

        // 清空容器
        if (wordContainerRef.current) {
          wordContainerRef.current.innerHTML = '';
          // 使用 docx-preview 渲染到容器
          await renderAsync(arrayBuffer, wordContainerRef.current);
        }
      } catch (err) {
        console.error('[FilePreviewPanel] Word 解析失败:', err);
        setError(`Failed to load Word file: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };

    loadWord();
  }, [fileType, content]);

  // ============ 图片预览 ============
  if (fileType === 'image') {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        backgroundColor: '#1e1e1e',
        padding: '20px',
      }}>
        <img
          src={downloadUrl}
          alt="Image Preview"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
          }}
        />
      </div>
    );
  }

  // ============ PDF 预览 ============
  if (fileType === 'pdf') {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        backgroundColor: '#1e1e1e',
      }}>
        <iframe
          src={downloadUrl}
          title="PDF Preview"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
          }}
        />
      </div>
    );
  }

  // ============ Excel 预览 ============
  if (fileType === 'excel') {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        backgroundColor: '#1e1e1e',
        color: '#ccc',
        padding: '20px',
      }}>
        {loading && (
          <div style={{ textAlign: 'center', paddingTop: '40px' }}>
            ⏳ Loading Excel...
          </div>
        )}
        {error && (
          <div style={{ color: '#f38ba8', padding: '20px' }}>
            ❌ Error: {error}
          </div>
        )}
        {excelHtml && !loading && (
          <div
            dangerouslySetInnerHTML={{ __html: excelHtml }}
            style={{
              fontSize: '12px',
              lineHeight: '1.6',
            }}
          />
        )}
      </div>
    );
  }

  // ============ Word 预览 ============
  if (fileType === 'word') {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        backgroundColor: '#2a2a2a',
        color: '#ccc',
        padding: '20px',
      }}>
        {loading && (
          <div style={{ textAlign: 'center', paddingTop: '40px' }}>
            ⏳ Loading Word document...
          </div>
        )}
        {error && (
          <div style={{ color: '#f38ba8', padding: '20px' }}>
            ❌ Error: {error}
          </div>
        )}
        <div
          ref={wordContainerRef}
          style={{
            backgroundColor: '#fff',
            color: '#000',
            padding: '20px',
            borderRadius: '4px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', color: '#f38ba8' }}>
      Unknown file type
    </div>
  );
};

export default FilePreviewPanel;
