import { describe, it, expect } from 'vitest';

describe('Test Task 1', () => {
  it('should pass basic assertion test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should verify string equality', () => {
    const message = 'Test task 1 completed';
    expect(message).toContain('Test task 1');
  });

  it('should handle array operations', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(arr).toHaveLength(5);
    expect(arr[0]).toBe(1);
    expect(arr[arr.length - 1]).toBe(5);
  });

  it('should test object properties', () => {
    const testObj = {
      name: 'Test Task 1',
      status: 'completed',
      success: true
    };
    
    expect(testObj).toHaveProperty('name');
    expect(testObj.status).toBe('completed');
    expect(testObj.success).toBe(true);
  });

  it('should verify async operations', async () => {
    const asyncFunc = async () => {
      return new Promise((resolve) => {
        setTimeout(() => resolve('Task 1 done'), 100);
      });
    };

    const result = await asyncFunc();
    expect(result).toBe('Task 1 done');
  });
});
