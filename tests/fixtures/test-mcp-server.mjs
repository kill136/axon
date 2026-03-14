#!/usr/bin/env node
/**
 * Minimal MCP test server for testing mcp-cli
 * Implements JSON-RPC 2.0 over stdio with 2 tools and 1 resource
 */

import { createInterface } from 'readline';

const rl = createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

const TOOLS = [
  {
    name: 'echo',
    description: 'Echo back the provided message',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to echo back' },
      },
      required: ['message'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers together',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' },
      },
      required: ['a', 'b'],
    },
  },
];

const RESOURCES = [
  {
    uri: 'test://info',
    name: 'Server Info',
    description: 'Information about this test server',
    mimeType: 'text/plain',
  },
];

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line.trim());
  } catch {
    return;
  }

  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: true, resources: true },
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      });
      break;

    case 'notifications/initialized':
      // No response needed for notifications
      break;

    case 'tools/list':
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      break;

    case 'resources/list':
      send({ jsonrpc: '2.0', id, result: { resources: RESOURCES } });
      break;

    case 'resources/read':
      if (params?.uri === 'test://info') {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            contents: [{ uri: 'test://info', text: 'This is a test MCP server for mcp-cli integration testing.' }],
          },
        });
      } else {
        send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown resource: ${params?.uri}` } });
      }
      break;

    case 'tools/call':
      if (params?.name === 'echo') {
        send({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Echo: ${params.arguments?.message || '(empty)'}` }] },
        });
      } else if (params?.name === 'add') {
        const sum = (params.arguments?.a || 0) + (params.arguments?.b || 0);
        send({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Result: ${sum}` }] },
        });
      } else {
        send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      }
      break;

    default:
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
});
