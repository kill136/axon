import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AxonCloudService } from '../../../src/web/server/services/axon-cloud-service.js';

describe('AxonCloudService', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should send verification code via /api/verification', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
      }),
    } as Response);

    const service = new AxonCloudService();
    await service.sendVerificationCode('user@example.com');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.chatbi.site/api/verification?email=user%40example.com',
    );
  });

  it('should treat register success with failed auto login as requiresLogin', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ success: true, message: 'ok' }),
      } as Response)
      .mockResolvedValueOnce({
        json: async () => ({ success: false, message: 'need login' }),
      } as Response);

    const service = new AxonCloudService();
    const result = await service.register({
      username: 'cloud-user',
      email: 'user@example.com',
      password: 'password123',
      verificationCode: '123456',
    });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      'https://api.chatbi.site/api/user/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          username: 'cloud-user',
          password: 'password123',
          email: 'user@example.com',
          verification_code: '123456',
        }),
      }),
    );
    expect(result).toEqual({
      success: true,
      username: 'cloud-user',
      quota: 0,
      apiKey: '',
      apiBaseUrl: 'https://api.chatbi.site',
      requiresLogin: true,
      message: 'ok',
    });
  });

  it('should parse stringified creem_products returned by NewAPI', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: {
          enable_creem_topup: true,
          creem_products: JSON.stringify([
            {
              productId: 'creem-pro-10',
              name: 'Starter Pack',
              price: 10,
              currency: 'USD',
              quota: 100,
            },
          ]),
        },
      }),
    } as Response);

    const service = new AxonCloudService();
    const result = await service.getTopupInfo('session-token', 'user-1');

    expect(result).toEqual({
      enableCreemTopup: true,
      creemProducts: [
        {
          productId: 'creem-pro-10',
          name: 'Starter Pack',
          description: undefined,
          price: 10,
          amount: undefined,
          currency: 'USD',
          bonus: undefined,
        },
      ],
      enableOnlineTopup: false,
      payMethods: [],
      minTopup: undefined,
      amountOptions: [],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.chatbi.site/api/user/topup/info',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer session-token',
          'New-Api-User': 'user-1',
        },
      }),
    );
  });

  it('should keep working when creem_products is already an array', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: {
          enable_creem_topup: true,
          creem_products: [
            {
              product_id: 'creem-pro-20',
              name: 'Growth Pack',
              price: '20',
              currency: 'USD',
              gift_amount: '5',
            },
          ],
        },
      }),
    } as Response);

    const service = new AxonCloudService();
    const result = await service.getTopupInfo('session-token', 'user-1');

    expect(result).toEqual({
      enableCreemTopup: true,
      creemProducts: [
        {
          productId: 'creem-pro-20',
          name: 'Growth Pack',
          description: undefined,
          price: 20,
          amount: undefined,
          currency: 'USD',
          bonus: 5,
        },
      ],
      enableOnlineTopup: false,
      payMethods: [],
      minTopup: undefined,
      amountOptions: [],
    });
  });

  it('should parse epay pay methods and amount options from top-up info', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: {
          enable_online_topup: true,
          pay_methods: [
            { type: 'alipay', name: '支付宝', color: '#1677FF', min_topup: '10' },
            { type: 'wxpay', name: '微信支付', min_topup: 20 },
          ],
          min_topup: '10',
          amount_options: ['10', 20, '50'],
        },
      }),
    } as Response);

    const service = new AxonCloudService();
    const result = await service.getTopupInfo('session-token', 'user-1');

    expect(result.enableOnlineTopup).toBe(true);
    expect(result.payMethods).toEqual([
      { type: 'alipay', name: '支付宝', color: '#1677FF', minTopup: 10 },
      { type: 'wxpay', name: '微信支付', color: undefined, minTopup: 20 },
    ]);
    expect(result.minTopup).toBe(10);
    expect(result.amountOptions).toEqual([10, 20, 50]);
  });

  it('should create an epay checkout from message=success responses', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        message: 'success',
        url: 'https://pay.example.com/order/1',
        data: {
          trade_no: 'trade-1',
        },
      }),
    } as Response);

    const service = new AxonCloudService();
    const result = await service.createEpayCheckout('session-token', 'user-1', 20, 'alipay');

    expect(result).toBe('https://pay.example.com/order/1');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.chatbi.site/api/user/pay',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer session-token',
          'New-Api-User': 'user-1',
        }),
        body: JSON.stringify({
          amount: 20,
          payment_method: 'alipay',
        }),
      }),
    );
  });

  it('should treat message=success responses as successful Creem checkout creation', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        message: 'success',
        data: {
          checkout_url: 'https://creem.io/checkout/session-2',
          order_id: 'ref_123',
        },
      }),
    } as Response);

    const service = new AxonCloudService();
    const result = await service.createCreemCheckout('session-token', 'user-1', 'creem-pro-10');

    expect(result).toBe('https://creem.io/checkout/session-2');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.chatbi.site/api/user/creem/pay',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer session-token',
          'New-Api-User': 'user-1',
        }),
        body: JSON.stringify({
          product_id: 'creem-pro-10',
          payment_method: 'creem',
        }),
      }),
    );
  });

  it('should surface Creem pay data errors instead of generic error strings', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        message: 'error',
        data: '产品不存在',
      }),
    } as Response);

    const service = new AxonCloudService();

    await expect(service.createCreemCheckout('session-token', 'user-1', 'missing-product'))
      .rejects
      .toThrow('产品不存在');
  });
});
