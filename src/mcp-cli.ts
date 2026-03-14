#!/usr/bin/env node
/**
 * mcp-cli - Progressive MCP tool discovery and invocation via CLI
 *
 * This CLI bridges the model's Bash tool with MCP servers running in the
 * main Axon process. Instead of loading all MCP tool definitions into the
 * system prompt (thousands of tokens), the model discovers and calls tools
 * on-demand through familiar CLI patterns.
 *
 * Usage:
 *   mcp-cli servers                        # List connected servers
 *   mcp-cli tools [server]                 # List available tools
 *   mcp-cli info <server>/<tool>           # Show tool schema (--help equivalent)
 *   mcp-cli call <server>/<tool> '<json>'  # Call a tool with JSON args
 *   mcp-cli call <server>/<tool> -         # Call with stdin JSON
 *   mcp-cli grep <pattern>                 # Search tools by name/description
 *   mcp-cli resources [server]             # List resources
 *   mcp-cli read <server>/<uri>            # Read a resource
 *   mcp-cli --help                         # Show this help
 *
 * Environment:
 *   MCP_CLI_PORT  - Port of the Axon web server (default: 3456)
 *   MCP_CLI_HOST  - Host of the Axon web server (default: 127.0.0.1)
 */

import http from 'http';

const HOST = process.env.MCP_CLI_HOST || '127.0.0.1';
const PORT = parseInt(process.env.MCP_CLI_PORT || process.env.AXON_WEB_PORT || '3456', 10);
const TOKEN = process.env.MCP_CLI_TOKEN || '';
const BASE = `http://${HOST}:${PORT}/api/mcp-cli`;

// ============ HTTP helpers ============

const REQUEST_TIMEOUT = 30_000; // 30 seconds

function httpGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${path}`, {
      headers: TOKEN ? { 'X-MCP-CLI-Token': TOKEN } : {},
      timeout: REQUEST_TIMEOUT,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 200, body: data }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
  });
}

function httpPost(path: string, body: unknown): Promise<{ status: number; body: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(TOKEN ? { 'X-MCP-CLI-Token': TOKEN } : {}),
        },
        timeout: REQUEST_TIMEOUT,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 200, body: data }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
    req.write(payload);
    req.end();
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    // If stdin is a TTY (no pipe), resolve empty immediately
    if (process.stdin.isTTY) resolve('');
  });
}

// ============ Formatters ============

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatTable(rows: string[][], header?: string[]): string {
  const allRows = header ? [header, ...rows] : rows;
  if (allRows.length === 0) return '(empty)';

  // Calculate column widths
  const colWidths = allRows[0].map((_, i) =>
    Math.max(...allRows.map((r) => (r[i] || '').length)),
  );

  const lines: string[] = [];
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    lines.push(row.map((cell, j) => (cell || '').padEnd(colWidths[j])).join('  '));
    if (i === 0 && header) {
      lines.push(colWidths.map((w) => '-'.repeat(w)).join('  '));
    }
  }
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '...';
}

function parsePath(input: string): { server: string; name: string } | null {
  const slash = input.indexOf('/');
  if (slash < 1) return null;
  return { server: input.slice(0, slash), name: input.slice(slash + 1) };
}

// ============ Commands ============

async function cmdServers() {
  const { status, body } = await httpGet('/servers');
  if (status !== 200) {
    console.error(`Error: ${body}`);
    process.exit(1);
  }
  const servers = parseJson(body) as Array<{
    name: string;
    connected: boolean;
    toolCount: number;
    resourceCount: number;
  }>;
  if (!servers || servers.length === 0) {
    console.log('No MCP servers configured.');
    return;
  }

  const rows = servers.map((s) => [
    s.name,
    s.connected ? 'connected' : 'disconnected',
    String(s.toolCount),
    String(s.resourceCount),
  ]);
  console.log(formatTable(rows, ['SERVER', 'STATUS', 'TOOLS', 'RESOURCES']));
}

async function cmdTools(serverFilter?: string) {
  const query = serverFilter ? `?server=${encodeURIComponent(serverFilter)}` : '';
  const { status, body } = await httpGet(`/tools${query}`);
  if (status !== 200) {
    console.error(`Error: ${body}`);
    process.exit(1);
  }
  const tools = parseJson(body) as Array<{
    server: string;
    name: string;
    description: string;
  }>;
  if (!tools || tools.length === 0) {
    console.log(serverFilter ? `No tools on server "${serverFilter}".` : 'No tools available.');
    return;
  }

  const rows = tools.map((t) => [t.server, t.name, truncate(t.description, 60)]);
  console.log(formatTable(rows, ['SERVER', 'TOOL', 'DESCRIPTION']));
}

async function cmdInfo(pathStr: string) {
  const parsed = parsePath(pathStr);
  if (!parsed) {
    console.error('Usage: mcp-cli info <server>/<tool>');
    process.exit(1);
  }

  const { status, body } = await httpGet(
    `/tools/${encodeURIComponent(parsed.server)}/${encodeURIComponent(parsed.name)}`,
  );
  if (status !== 200) {
    const err = parseJson(body) as { error?: string; available?: string[] } | null;
    console.error(`Error: ${err?.error || body}`);
    if (err?.available) {
      console.error(`\nAvailable tools: ${err.available.join(', ')}`);
    }
    process.exit(1);
  }

  const info = parseJson(body) as {
    server: string;
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  if (!info) {
    console.error('Failed to parse response');
    process.exit(1);
  }

  console.log(`Server: ${info.server}`);
  console.log(`Tool:   ${info.name}`);
  console.log(`\nDescription:\n  ${info.description || '(none)'}`);
  console.log(`\nInput Schema:`);
  console.log(JSON.stringify(info.inputSchema, null, 2));
}

async function cmdCall(pathStr: string, argsSource: string) {
  const parsed = parsePath(pathStr);
  if (!parsed) {
    console.error('Usage: mcp-cli call <server>/<tool> \'<json>\' | -');
    process.exit(1);
  }

  let argsJson: string;
  if (argsSource === '-') {
    argsJson = await readStdin();
  } else {
    argsJson = argsSource;
  }

  let args: unknown;
  try {
    args = JSON.parse(argsJson || '{}');
  } catch {
    console.error(`Invalid JSON: ${argsJson}`);
    process.exit(1);
  }

  const { status, body } = await httpPost(
    `/call/${encodeURIComponent(parsed.server)}/${encodeURIComponent(parsed.name)}`,
    args,
  );

  if (status !== 200) {
    const err = parseJson(body) as { error?: string } | null;
    console.error(`Error: ${err?.error || body}`);
    process.exit(1);
  }

  const result = parseJson(body) as { output?: string } | null;
  if (result?.output) {
    console.log(result.output);
  } else {
    console.log(body);
  }
}

async function cmdGrep(pattern: string) {
  const { status, body } = await httpGet(`/grep?q=${encodeURIComponent(pattern)}`);
  if (status !== 200) {
    console.error(`Error: ${body}`);
    process.exit(1);
  }

  const matches = parseJson(body) as Array<{
    server: string;
    name: string;
    description: string;
    matchedIn: string;
  }>;
  if (!matches || matches.length === 0) {
    console.log(`No tools matching "${pattern}".`);
    return;
  }

  const rows = matches.map((m) => [m.server, m.name, truncate(m.description, 50), m.matchedIn]);
  console.log(formatTable(rows, ['SERVER', 'TOOL', 'DESCRIPTION', 'MATCH']));
}

async function cmdResources(serverFilter?: string) {
  const query = serverFilter ? `?server=${encodeURIComponent(serverFilter)}` : '';
  const { status, body } = await httpGet(`/resources${query}`);
  if (status !== 200) {
    console.error(`Error: ${body}`);
    process.exit(1);
  }

  const resources = parseJson(body) as Array<{
    server: string;
    uri: string;
    name: string;
    mimeType?: string;
  }>;
  if (!resources || resources.length === 0) {
    console.log('No resources available.');
    return;
  }

  const rows = resources.map((r) => [r.server, r.uri, r.name, r.mimeType || '']);
  console.log(formatTable(rows, ['SERVER', 'URI', 'NAME', 'TYPE']));
}

async function cmdRead(pathStr: string) {
  const parsed = parsePath(pathStr);
  if (!parsed) {
    console.error('Usage: mcp-cli read <server>/<resource-uri>');
    process.exit(1);
  }

  const { status, body } = await httpPost('/resources/read', {
    server: parsed.server,
    uri: parsed.name,
  });

  if (status !== 200) {
    const err = parseJson(body) as { error?: string } | null;
    console.error(`Error: ${err?.error || body}`);
    process.exit(1);
  }

  const result = parseJson(body) as { output?: unknown } | null;
  if (result?.output) {
    if (typeof result.output === 'string') {
      console.log(result.output);
    } else {
      console.log(JSON.stringify(result.output, null, 2));
    }
  } else {
    console.log(body);
  }
}

function showHelp() {
  console.log(`mcp-cli - Progressive MCP tool discovery and invocation

USAGE:
  mcp-cli <command> [args]

COMMANDS:
  servers                        List all MCP servers and their status
  tools [server]                 List available tools (optionally filter by server)
  info  <server>/<tool>          Show tool description and input schema
  call  <server>/<tool> '<json>' Call a tool with JSON arguments
  call  <server>/<tool> -        Call a tool with JSON from stdin
  grep  <pattern>                Search tools by name or description
  resources [server]             List available resources
  read  <server>/<uri>           Read an MCP resource

OPTIONS:
  --help, -h                     Show this help message

ENVIRONMENT:
  MCP_CLI_PORT                   Axon web server port (auto-detected from AXON_WEB_PORT, default: 3456)
  MCP_CLI_HOST                   Axon web server host (default: 127.0.0.1)

EXAMPLES:
  mcp-cli servers
  mcp-cli tools connector-github
  mcp-cli info connector-github/search_repositories
  mcp-cli call connector-github/search_repositories '{"query": "react"}'
  mcp-cli grep slack
  mcp-cli resources connector-notion
  mcp-cli read connector-notion/database/abc123`);
}

// ============ Main ============

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }

  const command = args[0];

  try {
    switch (command) {
      case 'servers':
        await cmdServers();
        break;

      case 'tools':
        await cmdTools(args[1]);
        break;

      case 'info':
        if (!args[1]) {
          console.error('Usage: mcp-cli info <server>/<tool>');
          process.exit(1);
        }
        await cmdInfo(args[1]);
        break;

      case 'call':
        if (!args[1]) {
          console.error('Usage: mcp-cli call <server>/<tool> \'<json>\' | -');
          process.exit(1);
        }
        await cmdCall(args[1], args[2] || '{}');
        break;

      case 'grep':
        if (!args[1]) {
          console.error('Usage: mcp-cli grep <pattern>');
          process.exit(1);
        }
        await cmdGrep(args[1]);
        break;

      case 'resources':
        await cmdResources(args[1]);
        break;

      case 'read':
        if (!args[1]) {
          console.error('Usage: mcp-cli read <server>/<resource-uri>');
          process.exit(1);
        }
        await cmdRead(args[1]);
        break;

      default:
        console.error(`Unknown command: ${command}\nRun 'mcp-cli --help' for usage.`);
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
      console.error(`Error: Cannot connect to Axon server at ${HOST}:${PORT}`);
      console.error('Make sure Axon web server is running (axon-web or axon --web).');
      process.exit(1);
    }
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
