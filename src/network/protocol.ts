/**
 * Agent 间通信协议
 *
 * 基于 JSON-RPC 2.0 扩展，所有消息都带 Ed25519 签名。
 */

import * as crypto from 'crypto';
import type { AgentMessage, MessageMeta } from './types.js';
import { sign, verify } from './identity.js';

/**
 * 创建签名载荷：将消息关键字段序列化为签名数据
 */
function createSignPayload(msg: {
  id?: string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  timestamp: number;
}): string {
  // 只签核心字段，确保不可篡改
  const payload = {
    id: msg.id,
    method: msg.method,
    params: msg.params,
    result: msg.result,
    error: msg.error,
    timestamp: msg.timestamp,
  };
  return JSON.stringify(payload);
}

/**
 * 创建请求消息
 */
export function createRequest(
  method: string,
  params: unknown,
  from: string,
  to: string,
  privateKey: string,
  taskId?: string,
): AgentMessage {
  const id = crypto.randomUUID();
  const timestamp = Date.now();
  const signData = createSignPayload({ id, method, params, timestamp });

  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
    _meta: {
      from,
      to,
      signature: sign(signData, privateKey),
      timestamp,
      taskId,
    },
  };
}

/**
 * 创建响应消息
 */
export function createResponse(
  requestId: string,
  result: unknown,
  from: string,
  to: string,
  privateKey: string,
  taskId?: string,
): AgentMessage {
  const timestamp = Date.now();
  const signData = createSignPayload({ id: requestId, result, timestamp });

  return {
    jsonrpc: '2.0',
    id: requestId,
    result,
    _meta: {
      from,
      to,
      signature: sign(signData, privateKey),
      timestamp,
      taskId,
    },
  };
}

/**
 * 创建错误响应
 */
export function createErrorResponse(
  requestId: string,
  code: number,
  message: string,
  from: string,
  to: string,
  privateKey: string,
): AgentMessage {
  const timestamp = Date.now();
  const error = { code, message };
  const signData = createSignPayload({ id: requestId, error, timestamp });

  return {
    jsonrpc: '2.0',
    id: requestId,
    error,
    _meta: {
      from,
      to,
      signature: sign(signData, privateKey),
      timestamp,
    },
  };
}

/**
 * 创建通知消息（无需响应）
 */
export function createNotification(
  method: string,
  params: unknown,
  from: string,
  to: string,
  privateKey: string,
  taskId?: string,
): AgentMessage {
  const timestamp = Date.now();
  const signData = createSignPayload({ method, params, timestamp });

  return {
    jsonrpc: '2.0',
    method,
    params,
    _meta: {
      from,
      to,
      signature: sign(signData, privateKey),
      timestamp,
      taskId,
    },
  };
}

/**
 * 验证消息签名
 */
export function verifyMessage(msg: AgentMessage, senderPublicKeyPem: string): boolean {
  const { _meta } = msg;
  const signData = createSignPayload({
    id: msg.id,
    method: msg.method,
    params: msg.params,
    result: msg.result,
    error: msg.error,
    timestamp: _meta.timestamp,
  });

  return verify(signData, _meta.signature, senderPublicKeyPem);
}

/**
 * 判断消息是否为请求
 */
export function isRequest(msg: AgentMessage): boolean {
  return msg.id !== undefined && msg.method !== undefined;
}

/**
 * 判断消息是否为响应
 */
export function isResponse(msg: AgentMessage): boolean {
  return msg.id !== undefined && msg.method === undefined;
}

/**
 * 判断消息是否为通知
 */
export function isNotification(msg: AgentMessage): boolean {
  return msg.id === undefined && msg.method !== undefined;
}

// ============================================================================
// JSON-RPC 错误码
// ============================================================================

export enum AgentErrorCode {
  /** 解析错误 */
  ParseError = -32700,
  /** 无效请求 */
  InvalidRequest = -32600,
  /** 方法未找到 */
  MethodNotFound = -32601,
  /** 无效参数 */
  InvalidParams = -32602,
  /** 内部错误 */
  InternalError = -32603,
  /** 权限拒绝 */
  PermissionDenied = -32000,
  /** 信任未建立 */
  Untrusted = -32001,
  /** 签名验证失败 */
  InvalidSignature = -32002,
  /** 协议版本不兼容 */
  IncompatibleVersion = -32003,
}
