import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { AxonCloudService } from '../../../src/web/server/services/axon-cloud-service.js';

describe('AxonCloudService top-up info parsing', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
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
    });
  });
});
