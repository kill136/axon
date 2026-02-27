/**
 * Email MCP Server - IMAP/SMTP 邮件操作
 *
 * 基于 jdickey1/imap-email-mcp (MIT) 改写为 TypeScript
 * 使用与 chrome-mcp 相同的 JSON-RPC stdio 传输模式
 *
 * 环境变量配置:
 *   IMAP_USER      - 邮箱账号 (必需)
 *   IMAP_PASSWORD   - 邮箱密码/应用密码 (必需)
 *   IMAP_HOST      - IMAP 服务器地址 (必需)
 *   IMAP_PORT      - IMAP 端口 (默认 993)
 *   SMTP_HOST      - SMTP 服务器地址 (默认与 IMAP_HOST 相同)
 *   SMTP_PORT      - SMTP 端口 (默认 465)
 *   SMTP_USER      - SMTP 用户名 (默认与 IMAP_USER 相同)
 *   SMTP_PASSWORD   - SMTP 密码 (默认与 IMAP_PASSWORD 相同)
 */

import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';

import { EMAIL_MCP_TOOLS } from './tools.js';

// ============ 类型 ============

interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

interface ImapBoxes {
  [key: string]: {
    children?: ImapBoxes;
    [key: string]: unknown;
  };
}

// ============ 配置 ============

const IMAP_CONFIG = {
  imap: {
    user: process.env.IMAP_USER || '',
    password: process.env.IMAP_PASSWORD || '',
    host: process.env.IMAP_HOST || '',
    port: parseInt(process.env.IMAP_PORT || '993', 10),
    tls: process.env.IMAP_TLS !== 'false',
    authTimeout: parseInt(process.env.IMAP_AUTH_TIMEOUT || '10000', 10),
    tlsOptions: {
      rejectUnauthorized: process.env.IMAP_TLS_REJECT_UNAUTHORIZED !== 'false',
    },
  },
};

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || process.env.IMAP_HOST || '',
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE !== 'false',
  auth: {
    user: process.env.SMTP_USER || process.env.IMAP_USER || '',
    pass: process.env.SMTP_PASSWORD || process.env.IMAP_PASSWORD || '',
  },
};

// ============ 验证 ============

function validateConfig(): void {
  const required = ['IMAP_USER', 'IMAP_PASSWORD', 'IMAP_HOST'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    console.error('Please set these variables before starting the server.');
    process.exit(1);
  }
}

// ============ IMAP 辅助 ============

async function connectIMAP(): Promise<imaps.ImapSimple> {
  if (!IMAP_CONFIG.imap.password) {
    throw new Error('IMAP_PASSWORD environment variable is not set');
  }
  return await imaps.connect(IMAP_CONFIG);
}

async function findDraftsFolder(connection: imaps.ImapSimple): Promise<string> {
  const boxes = (await connection.getBoxes()) as ImapBoxes;

  const draftNames = [
    'Drafts', 'INBOX.Drafts', '[Gmail]/Drafts',
    '[Google Mail]/Drafts', 'Draft', 'INBOX/Drafts',
  ];

  for (const name of draftNames) {
    if (boxes[name] || name.split('.').reduce<any>((acc, part) => acc?.[part], boxes)) {
      return name;
    }
  }

  if (boxes.INBOX && (boxes.INBOX as any).children && (boxes.INBOX as any).children.Drafts) {
    return 'INBOX.Drafts';
  }

  return 'Drafts';
}

function buildRfc2822Message(opts: {
  from: string; to: string; subject: string;
  body?: string; html?: string; cc?: string; bcc?: string;
}): string {
  const boundary = `----=_Part_${Date.now()}`;
  let msg = '';
  msg += `From: ${opts.from}\r\n`;
  msg += `To: ${opts.to}\r\n`;
  if (opts.cc) msg += `Cc: ${opts.cc}\r\n`;
  if (opts.bcc) msg += `Bcc: ${opts.bcc}\r\n`;
  msg += `Subject: ${opts.subject}\r\n`;
  msg += `Date: ${new Date().toUTCString()}\r\n`;
  msg += `MIME-Version: 1.0\r\n`;

  if (opts.html) {
    msg += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;
    msg += `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${opts.body || ''}\r\n`;
    msg += `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${opts.html}\r\n`;
    msg += `--${boundary}--\r\n`;
  } else {
    msg += `Content-Type: text/plain; charset=utf-8\r\n\r\n${opts.body || ''}\r\n`;
  }
  return msg;
}

// ============ 工具执行 ============

async function executeToolCall(name: string, args: Record<string, any>): Promise<McpToolResult> {
  try {
    switch (name) {
      case 'list_folders': {
        const connection = await connectIMAP();
        try {
          const boxes = (await connection.getBoxes()) as ImapBoxes;
          const folders: string[] = [];
          function extract(obj: ImapBoxes, prefix = ''): void {
            for (const [key, value] of Object.entries(obj)) {
              const fullPath = prefix ? `${prefix}.${key}` : key;
              folders.push(fullPath);
              if (value.children) extract(value.children, fullPath);
            }
          }
          extract(boxes);
          return { content: [{ type: 'text', text: JSON.stringify(folders, null, 2) }] };
        } finally {
          connection.end();
        }
      }

      case 'list_emails': {
        const folder = args.folder || 'INBOX';
        const limit = args.limit || 20;
        const connection = await connectIMAP();
        try {
          await connection.openBox(folder);
          let searchCriteria: any[] = ['ALL'];
          if (args.unseen_only) searchCriteria = ['UNSEEN'];
          if (args.since_date) searchCriteria = [['SINCE', args.since_date]];

          const messages = await connection.search(searchCriteria, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'], struct: true,
          });
          const results = messages.slice(-limit).reverse().map((m) => {
            const h = (m.parts.find((p: any) => p.which.includes('HEADER')) as any)?.body || {};
            return { uid: m.attributes.uid, date: h.date?.[0], from: h.from?.[0], to: h.to?.[0], subject: h.subject?.[0], flags: m.attributes.flags };
          });
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        } finally {
          connection.end();
        }
      }

      case 'get_email': {
        const folder = args.folder || 'INBOX';
        const connection = await connectIMAP();
        try {
          await connection.openBox(folder);
          const messages = await connection.search([['UID', args.uid]], { bodies: [''], struct: true });
          if (messages.length === 0) return { content: [{ type: 'text', text: 'Email not found' }] };

          const raw = (messages[0].parts.find((p: any) => p.which === '') as any)?.body;
          const parsed = await simpleParser(raw);
          const toText = Array.isArray(parsed.to) ? parsed.to.map((a: any) => a.text).join(', ') : parsed.to?.text;
          const ccText = Array.isArray(parsed.cc) ? parsed.cc.map((a: any) => a.text).join(', ') : parsed.cc?.text;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                uid: messages[0].attributes.uid, from: parsed.from?.text, to: toText, cc: ccText,
                subject: parsed.subject, date: parsed.date, text: parsed.text,
                html: parsed.html ? '[HTML content available]' : undefined,
                attachments: parsed.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size })),
              }, null, 2),
            }],
          };
        } finally {
          connection.end();
        }
      }

      case 'search_emails': {
        const folder = args.folder || 'INBOX';
        const limit = args.limit || 20;
        const connection = await connectIMAP();
        try {
          await connection.openBox(folder);
          const criteria: any[] = [];
          if (args.subject) criteria.push(['SUBJECT', args.subject]);
          if (args.from) criteria.push(['FROM', args.from]);
          if (args.body) criteria.push(['BODY', args.body]);
          if (criteria.length === 0) criteria.push('ALL');

          const messages = await connection.search(criteria, {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'], struct: true,
          });
          const results = messages.slice(-limit).reverse().map((m) => {
            const h = (m.parts.find((p: any) => p.which.includes('HEADER')) as any)?.body || {};
            return { uid: m.attributes.uid, date: h.date?.[0], from: h.from?.[0], to: h.to?.[0], subject: h.subject?.[0] };
          });
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        } finally {
          connection.end();
        }
      }

      case 'send_email': {
        if (!SMTP_CONFIG.host) {
          return { content: [{ type: 'text', text: 'Error: SMTP_HOST not configured.' }], isError: true };
        }
        const transporter = nodemailer.createTransport(SMTP_CONFIG);
        const info = await transporter.sendMail({
          from: SMTP_CONFIG.auth.user, to: args.to, subject: args.subject,
          text: args.body, html: args.html, cc: args.cc, bcc: args.bcc,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, messageId: info.messageId, response: info.response }, null, 2) }] };
      }

      case 'create_draft': {
        const connection = await connectIMAP();
        try {
          const draftsFolder = await findDraftsFolder(connection);
          const message = buildRfc2822Message({ from: IMAP_CONFIG.imap.user, to: args.to, subject: args.subject, body: args.body, html: args.html, cc: args.cc, bcc: args.bcc });
          await connection.append(message, { mailbox: draftsFolder, flags: ['\\Draft'] });
          return { content: [{ type: 'text', text: `Draft created in ${draftsFolder}` }] };
        } finally {
          connection.end();
        }
      }

      case 'get_draft': {
        const connection = await connectIMAP();
        try {
          const draftsFolder = await findDraftsFolder(connection);
          await connection.openBox(draftsFolder);
          const messages = await connection.search([['UID', args.uid]], { bodies: [''], struct: true });
          if (messages.length === 0) return { content: [{ type: 'text', text: 'Draft not found' }] };

          const raw = (messages[0].parts.find((p: any) => p.which === '') as any)?.body;
          const parsed = await simpleParser(raw);
          const toText = Array.isArray(parsed.to) ? parsed.to.map((a: any) => a.text).join(', ') : parsed.to?.text;
          const ccText = Array.isArray(parsed.cc) ? parsed.cc.map((a: any) => a.text).join(', ') : parsed.cc?.text;
          const bccText = Array.isArray(parsed.bcc) ? parsed.bcc.map((a: any) => a.text).join(', ') : parsed.bcc?.text;

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                uid: messages[0].attributes.uid, to: toText, cc: ccText, bcc: bccText,
                subject: parsed.subject, date: parsed.date, text: parsed.text,
                html: parsed.html ? '[HTML content available]' : undefined,
              }, null, 2),
            }],
          };
        } finally {
          connection.end();
        }
      }

      case 'update_draft': {
        const connection = await connectIMAP();
        try {
          const draftsFolder = await findDraftsFolder(connection);
          await connection.openBox(draftsFolder);
          await connection.addFlags(args.uid, ['\\Deleted']);
          await connection.closeBox(true);

          const message = buildRfc2822Message({ from: IMAP_CONFIG.imap.user, to: args.to, subject: args.subject, body: args.body, html: args.html, cc: args.cc, bcc: args.bcc });
          await connection.append(message, { mailbox: draftsFolder, flags: ['\\Draft'] });
          return { content: [{ type: 'text', text: 'Draft updated successfully' }] };
        } finally {
          connection.end();
        }
      }

      case 'list_drafts': {
        const limit = args.limit || 20;
        const connection = await connectIMAP();
        try {
          const draftsFolder = await findDraftsFolder(connection);
          await connection.openBox(draftsFolder);
          const messages = await connection.search(['ALL'], {
            bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'], struct: true,
          });
          const results = messages.slice(-limit).reverse().map((m) => {
            const h = (m.parts.find((p: any) => p.which.includes('HEADER')) as any)?.body || {};
            return { uid: m.attributes.uid, date: h.date?.[0], to: h.to?.[0], subject: h.subject?.[0] };
          });
          return { content: [{ type: 'text', text: JSON.stringify({ folder: draftsFolder, drafts: results }, null, 2) }] };
        } finally {
          connection.end();
        }
      }

      case 'delete_email': {
        const folder = args.folder || 'INBOX';
        const connection = await connectIMAP();
        try {
          await connection.openBox(folder);
          await connection.addFlags(args.uid, ['\\Deleted']);
          await connection.closeBox(true);
          return { content: [{ type: 'text', text: 'Email deleted successfully' }] };
        } finally {
          connection.end();
        }
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true };
  }
}

// ============ JSON-RPC stdio MCP Server ============

function sendResponse(id: string | number, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function sendError(id: string | number, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handleMessage(message: string): Promise<void> {
  try {
    const request = JSON.parse(message);
    const { id, method, params } = request;

    switch (method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'email-mcp', version: '1.0.0' },
        });
        break;

      case 'tools/list':
        sendResponse(id, { tools: EMAIL_MCP_TOOLS });
        break;

      case 'tools/call': {
        const { name, arguments: args = {} } = params;
        const result = await executeToolCall(name, args);
        sendResponse(id, result);
        break;
      }

      case 'notifications/initialized':
        // 客户端确认初始化，无需响应
        break;

      default:
        if (id !== undefined) {
          sendError(id, -32601, `Method not found: ${method}`);
        }
    }
  } catch (err: any) {
    console.error('Failed to handle message:', err);
  }
}

export async function main(): Promise<void> {
  validateConfig();

  let buffer = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) handleMessage(line.trim());
    }
  });

  process.stdin.on('end', () => process.exit(0));

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));

  console.error('Email MCP Server running on stdio');

  // 保持进程运行
  await new Promise<void>((resolve) => {
    process.stdin.on('end', resolve);
    process.stdin.on('close', resolve);
  });
}

// 当直接运行此文件时自动启动
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith('email-mcp/mcp-server.js') ||
   process.argv[1].endsWith('email-mcp\\mcp-server.js'));

if (isDirectRun) {
  main().catch(console.error);
}
