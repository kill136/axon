/**
 * Email MCP 工具定义
 * IMAP/SMTP 邮件操作的 10 个工具
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * 所有 Email MCP 工具定义
 */
export const EMAIL_MCP_TOOLS: McpTool[] = [
  {
    name: 'list_folders',
    description: 'List all email folders/mailboxes in the IMAP account',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_emails',
    description: 'List emails from a folder with optional filtering',
    inputSchema: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description: 'Folder name (default: INBOX)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of emails to return (default: 20)',
        },
        unseen_only: {
          type: 'boolean',
          description: 'Only return unread emails',
        },
        since_date: {
          type: 'string',
          description: 'Only return emails since this date (YYYY-MM-DD format)',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_email',
    description: 'Get full email content by UID',
    inputSchema: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'Email UID',
        },
        folder: {
          type: 'string',
          description: 'Folder name (default: INBOX)',
        },
      },
      required: ['uid'],
    },
  },
  {
    name: 'search_emails',
    description: 'Search emails by subject, from, or body text',
    inputSchema: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description: 'Folder to search (default: INBOX)',
        },
        subject: {
          type: 'string',
          description: 'Search in subject line',
        },
        from: {
          type: 'string',
          description: 'Search by sender',
        },
        body: {
          type: 'string',
          description: 'Search in body text',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20)',
        },
      },
      required: [],
    },
  },
  {
    name: 'send_email',
    description: 'Send an email directly via SMTP',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address(es), comma-separated',
        },
        subject: {
          type: 'string',
          description: 'Email subject',
        },
        body: {
          type: 'string',
          description: 'Email body (plain text)',
        },
        html: {
          type: 'string',
          description: 'Email body (HTML)',
        },
        cc: {
          type: 'string',
          description: 'CC recipients, comma-separated',
        },
        bcc: {
          type: 'string',
          description: 'BCC recipients, comma-separated',
        },
      },
      required: ['to', 'subject'],
    },
  },
  {
    name: 'create_draft',
    description: 'Create a new draft email',
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Recipient email address(es), comma-separated',
        },
        subject: {
          type: 'string',
          description: 'Email subject',
        },
        body: {
          type: 'string',
          description: 'Email body (plain text)',
        },
        html: {
          type: 'string',
          description: 'Email body (HTML)',
        },
        cc: {
          type: 'string',
          description: 'CC recipients, comma-separated',
        },
        bcc: {
          type: 'string',
          description: 'BCC recipients, comma-separated',
        },
      },
      required: ['to', 'subject'],
    },
  },
  {
    name: 'get_draft',
    description: 'Get a specific draft email by UID',
    inputSchema: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'Draft UID',
        },
      },
      required: ['uid'],
    },
  },
  {
    name: 'update_draft',
    description: 'Update an existing draft by deleting old and creating new',
    inputSchema: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'UID of draft to update',
        },
        to: {
          type: 'string',
          description: 'Recipient email address(es)',
        },
        subject: {
          type: 'string',
          description: 'Email subject',
        },
        body: {
          type: 'string',
          description: 'Email body (plain text)',
        },
        html: {
          type: 'string',
          description: 'Email body (HTML)',
        },
        cc: {
          type: 'string',
          description: 'CC recipients',
        },
        bcc: {
          type: 'string',
          description: 'BCC recipients',
        },
      },
      required: ['uid', 'to', 'subject'],
    },
  },
  {
    name: 'list_drafts',
    description: 'List all draft emails',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of drafts to return (default: 20)',
        },
      },
      required: [],
    },
  },
  {
    name: 'delete_email',
    description: 'Delete an email by UID',
    inputSchema: {
      type: 'object',
      properties: {
        uid: {
          type: 'number',
          description: 'Email UID to delete',
        },
        folder: {
          type: 'string',
          description: 'Folder name (default: INBOX)',
        },
      },
      required: ['uid'],
    },
  },
];

/**
 * 获取带前缀的工具名列表
 */
export function getEmailToolNames(serverName = 'email'): string[] {
  return EMAIL_MCP_TOOLS.map((t) => `mcp__${serverName}__${t.name}`);
}
