/**
 * Agent 通信协议测试
 *
 * 测试 JSON-RPC 2.0 扩展消息的创建、签名验证和类型判断
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import {
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
  verifyMessage,
  isRequest,
  isResponse,
  isNotification,
  AgentErrorCode,
} from '../../src/network/protocol.js';
import { computeAgentId } from '../../src/network/identity.js';

function generateTestKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

describe('Protocol', () => {
  let senderKeys: { publicKey: string; privateKey: string };
  let receiverKeys: { publicKey: string; privateKey: string };
  let senderId: string;
  let receiverId: string;

  beforeEach(() => {
    senderKeys = generateTestKeyPair();
    receiverKeys = generateTestKeyPair();
    senderId = computeAgentId(senderKeys.publicKey);
    receiverId = computeAgentId(receiverKeys.publicKey);
  });

  describe('createRequest', () => {
    it('should create valid JSON-RPC 2.0 request', () => {
      const msg = createRequest('agent.ping', { data: 'hello' }, senderId, receiverId, senderKeys.privateKey);

      expect(msg.jsonrpc).toBe('2.0');
      expect(msg.id).toBeDefined();
      expect(msg.method).toBe('agent.ping');
      expect(msg.params).toEqual({ data: 'hello' });
      expect(msg._meta.from).toBe(senderId);
      expect(msg._meta.to).toBe(receiverId);
      expect(msg._meta.signature).toBeTruthy();
      expect(msg._meta.timestamp).toBeGreaterThan(0);
    });

    it('should include taskId when provided', () => {
      const msg = createRequest('agent.ping', null, senderId, receiverId, senderKeys.privateKey, 'task-123');
      expect(msg._meta.taskId).toBe('task-123');
    });

    it('should generate unique IDs for different requests', () => {
      const msg1 = createRequest('agent.ping', null, senderId, receiverId, senderKeys.privateKey);
      const msg2 = createRequest('agent.ping', null, senderId, receiverId, senderKeys.privateKey);
      expect(msg1.id).not.toBe(msg2.id);
    });
  });

  describe('createResponse', () => {
    it('should create valid JSON-RPC 2.0 response', () => {
      const requestId = crypto.randomUUID();
      const msg = createResponse(requestId, { pong: true }, senderId, receiverId, senderKeys.privateKey);

      expect(msg.jsonrpc).toBe('2.0');
      expect(msg.id).toBe(requestId);
      expect(msg.result).toEqual({ pong: true });
      expect(msg.method).toBeUndefined();
      expect(msg._meta.from).toBe(senderId);
      expect(msg._meta.signature).toBeTruthy();
    });
  });

  describe('createErrorResponse', () => {
    it('should create valid error response', () => {
      const requestId = crypto.randomUUID();
      const msg = createErrorResponse(
        requestId,
        AgentErrorCode.PermissionDenied,
        'Access denied',
        senderId,
        receiverId,
        senderKeys.privateKey,
      );

      expect(msg.jsonrpc).toBe('2.0');
      expect(msg.id).toBe(requestId);
      expect(msg.error).toBeDefined();
      expect(msg.error!.code).toBe(-32000);
      expect(msg.error!.message).toBe('Access denied');
      expect(msg.result).toBeUndefined();
    });
  });

  describe('createNotification', () => {
    it('should create valid notification (no id)', () => {
      const msg = createNotification('agent.progress', { percent: 50 }, senderId, receiverId, senderKeys.privateKey);

      expect(msg.jsonrpc).toBe('2.0');
      expect(msg.id).toBeUndefined();
      expect(msg.method).toBe('agent.progress');
      expect(msg.params).toEqual({ percent: 50 });
      expect(msg._meta.from).toBe(senderId);
    });
  });

  describe('verifyMessage', () => {
    it('should verify valid request signature', () => {
      const msg = createRequest('agent.ping', null, senderId, receiverId, senderKeys.privateKey);
      const valid = verifyMessage(msg, senderKeys.publicKey);
      expect(valid).toBe(true);
    });

    it('should verify valid response signature', () => {
      const msg = createResponse('req-1', { ok: true }, senderId, receiverId, senderKeys.privateKey);
      const valid = verifyMessage(msg, senderKeys.publicKey);
      expect(valid).toBe(true);
    });

    it('should verify valid notification signature', () => {
      const msg = createNotification('event', {}, senderId, receiverId, senderKeys.privateKey);
      const valid = verifyMessage(msg, senderKeys.publicKey);
      expect(valid).toBe(true);
    });

    it('should reject tampered message', () => {
      const msg = createRequest('agent.ping', null, senderId, receiverId, senderKeys.privateKey);
      msg.params = { hacked: true }; // 篡改参数
      const valid = verifyMessage(msg, senderKeys.publicKey);
      expect(valid).toBe(false);
    });

    it('should reject wrong public key', () => {
      const msg = createRequest('agent.ping', null, senderId, receiverId, senderKeys.privateKey);
      const valid = verifyMessage(msg, receiverKeys.publicKey);
      expect(valid).toBe(false);
    });
  });

  describe('message type checking', () => {
    it('isRequest: has id and method', () => {
      const msg = createRequest('agent.ping', null, senderId, receiverId, senderKeys.privateKey);
      expect(isRequest(msg)).toBe(true);
      expect(isResponse(msg)).toBe(false);
      expect(isNotification(msg)).toBe(false);
    });

    it('isResponse: has id but no method', () => {
      const msg = createResponse('req-1', {}, senderId, receiverId, senderKeys.privateKey);
      expect(isResponse(msg)).toBe(true);
      expect(isRequest(msg)).toBe(false);
      expect(isNotification(msg)).toBe(false);
    });

    it('isNotification: has method but no id', () => {
      const msg = createNotification('event', {}, senderId, receiverId, senderKeys.privateKey);
      expect(isNotification(msg)).toBe(true);
      expect(isRequest(msg)).toBe(false);
      expect(isResponse(msg)).toBe(false);
    });
  });

  describe('AgentErrorCode', () => {
    it('should have standard JSON-RPC error codes', () => {
      expect(AgentErrorCode.ParseError).toBe(-32700);
      expect(AgentErrorCode.InvalidRequest).toBe(-32600);
      expect(AgentErrorCode.MethodNotFound).toBe(-32601);
      expect(AgentErrorCode.InvalidParams).toBe(-32602);
      expect(AgentErrorCode.InternalError).toBe(-32603);
    });

    it('should have custom error codes', () => {
      expect(AgentErrorCode.PermissionDenied).toBe(-32000);
      expect(AgentErrorCode.Untrusted).toBe(-32001);
      expect(AgentErrorCode.InvalidSignature).toBe(-32002);
      expect(AgentErrorCode.IncompatibleVersion).toBe(-32003);
    });
  });
});
