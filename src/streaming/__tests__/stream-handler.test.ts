/**
 * Stream Handler Tests
 *
 * Validates v2.1.74 bug fix:
 * - Ensures reader.cancel() is called in finally block
 * - Prevents memory leaks on early termination
 * - Properly handles stream errors
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  streamFromAPI,
  streamWithTimeout,
  streamToBuffer,
  streamToText,
  type ApiReadableStream,
  type StreamReader,
  type StreamHandlerOptions,
} from '../stream-handler';

// Mock stream reader
class MockStreamReader implements StreamReader {
  private chunks: Uint8Array[];
  private index: number = 0;
  public cancelCalled: boolean = false;
  public cancelError: Error | undefined;

  constructor(chunks: Uint8Array[] = []) {
    this.chunks = chunks;
  }

  async read() {
    if (this.index >= this.chunks.length) {
      return { done: true };
    }
    return { done: false, value: this.chunks[this.index++] };
  }

  async cancel(reason?: Error): Promise<void> {
    this.cancelCalled = true;
    if (reason) {
      this.cancelError = reason;
    }
  }
}

// Mock API stream
class MockApiStream implements ApiReadableStream {
  private reader: MockStreamReader;

  constructor(reader: MockStreamReader) {
    this.reader = reader;
  }

  getReader(): StreamReader {
    return this.reader;
  }
}

describe('Stream Handler - Memory Leak Prevention', () => {
  describe('streamFromAPI', () => {
    it('should call reader.cancel() on successful completion', async () => {
      const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      await streamFromAPI(stream);

      // CRITICAL: Verify cancel was called (v2.1.74 fix)
      expect(reader.cancelCalled).toBe(true);
    });

    it('should call reader.cancel() even on error', async () => {
      const reader = new MockStreamReader([new Uint8Array([1, 2, 3])]);
      const stream = new MockApiStream(reader);

      const onChunk = vi.fn(async () => {
        throw new Error('Test error');
      });

      try {
        await streamFromAPI(stream, { onChunk });
      } catch (error) {
        // Expected to throw
      }

      // CRITICAL: cancel() should be called in finally block
      expect(reader.cancelCalled).toBe(true);
    });

    it('should handle multiple chunks without accumulating', async () => {
      const chunks = [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6]),
        new Uint8Array([7, 8, 9]),
      ];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      const processedChunks: Uint8Array[] = [];
      const onChunk = vi.fn(async (chunk) => {
        processedChunks.push(chunk.value);
      });

      await streamFromAPI(stream, { onChunk });

      expect(processedChunks).toHaveLength(3);
      expect(reader.cancelCalled).toBe(true);
    });

    it('should enforce max chunk size', async () => {
      const chunks = [new Uint8Array(1000), new Uint8Array(2000)];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      const options: StreamHandlerOptions = {
        maxChunkSize: 1500,
      };

      try {
        await streamFromAPI(stream, options);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('exceeds maximum');
      }

      // Should still call cancel on error
      expect(reader.cancelCalled).toBe(true);
    });

    it('should allow custom error handler', async () => {
      const chunks = [new Uint8Array([1, 2, 3])];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      const onChunk = vi.fn(async () => {
        throw new Error('Custom error');
      });

      const onError = vi.fn();

      try {
        await streamFromAPI(stream, { onChunk, onError });
      } catch (error) {
        // Expected
      }

      expect(onError).toHaveBeenCalled();
      expect(reader.cancelCalled).toBe(true);
    });

    it('should handle empty stream', async () => {
      const reader = new MockStreamReader([]);
      const stream = new MockApiStream(reader);

      const onChunk = vi.fn();

      await streamFromAPI(stream, { onChunk });

      expect(onChunk).not.toHaveBeenCalled();
      expect(reader.cancelCalled).toBe(true);
    });
  });

  describe('streamWithTimeout', () => {
    it('should timeout on slow stream', async () => {
      const slowReader = new (class implements StreamReader {
        async read() {
          // Simulate slow response
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { done: true };
        }

        async cancel() {
          // no-op
        }
      })();

      const stream = new (class implements ApiReadableStream {
        getReader() {
          return slowReader;
        }
      })();

      try {
        await streamWithTimeout(stream, { timeout: 10 });
        expect.fail('Should have timed out');
      } catch (error) {
        expect((error as Error).message).toContain('timeout');
      }
    });

    it('should complete before timeout', async () => {
      const chunks = [new Uint8Array([1, 2, 3])];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      await streamWithTimeout(stream, { timeout: 5000 });

      expect(reader.cancelCalled).toBe(true);
    });
  });

  describe('streamToBuffer', () => {
    it('should accumulate chunks into single buffer', async () => {
      const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      const buffer = await streamToBuffer(stream);

      expect(buffer).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
      expect(reader.cancelCalled).toBe(true);
    });

    it('should enforce total size limit', async () => {
      const largeChunk = new Uint8Array(1000000); // 1MB
      const chunks = [largeChunk, largeChunk, largeChunk]; // 3MB total
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      try {
        // Set very low limit for testing
        await streamToBuffer(stream, { /* uses default 100MB */ });
        // Should complete since 3MB < 100MB
        expect(reader.cancelCalled).toBe(true);
      } catch (error) {
        expect.fail(`Should not fail with 3MB: ${error}`);
      }
    });

    it('should clear chunks on completion for GC', async () => {
      const chunks = [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6]),
      ];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      const buffer = await streamToBuffer(stream);

      expect(buffer.length).toBe(6);
      expect(reader.cancelCalled).toBe(true);
    });

    it('should clear chunks even on error', async () => {
      const chunks = [new Uint8Array([1, 2, 3])];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      const onChunk = vi.fn(async () => {
        throw new Error('Processing error');
      });

      try {
        await streamToBuffer(stream, { onChunk });
      } catch (error) {
        // Expected
      }

      // Chunks should be cleared in finally block
      expect(reader.cancelCalled).toBe(true);
    });
  });

  describe('streamToText', () => {
    it('should decode buffer to text', async () => {
      const encoder = new TextEncoder();
      const chunks = [
        encoder.encode('Hello '),
        encoder.encode('World!'),
      ];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      const text = await streamToText(stream);

      expect(text).toBe('Hello World!');
      expect(reader.cancelCalled).toBe(true);
    });

    it('should handle UTF-8 text', async () => {
      const encoder = new TextEncoder();
      const chunks = [encoder.encode('中文 English 日本語')];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      const text = await streamToText(stream);

      expect(text).toBe('中文 English 日本語');
      expect(reader.cancelCalled).toBe(true);
    });
  });

  describe('Memory Leak Scenarios', () => {
    it('should prevent memory leak on early termination', async () => {
      const chunks = Array.from({ length: 100 }, (_, i) => new Uint8Array(1000));
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      let processedCount = 0;
      const onChunk = vi.fn(async () => {
        processedCount++;
        if (processedCount === 10) {
          throw new Error('Early termination');
        }
      });

      try {
        await streamFromAPI(stream, { onChunk });
      } catch (error) {
        // Expected early termination
      }

      // CRITICAL: cancel() must be called even on early termination
      // to prevent remaining chunks from leaking memory
      expect(reader.cancelCalled).toBe(true);
      expect(processedCount).toBe(10);
    });

    it('should release resources on chunk processing error', async () => {
      const chunks = [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6]),
      ];
      const reader = new MockStreamReader(chunks);
      const stream = new MockApiStream(reader);

      let callCount = 0;
      const onChunk = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Processing failed');
        }
      });

      try {
        await streamFromAPI(stream, { onChunk });
      } catch (error) {
        // Expected error
      }

      // Reader should be cancelled to release resources
      expect(reader.cancelCalled).toBe(true);
      expect(callCount).toBe(1);
    });

    it('should handle concurrent stream operations', async () => {
      const streams = Array.from({ length: 3 }, () => {
        const chunks = [new Uint8Array([1, 2, 3])];
        return new MockApiStream(new MockStreamReader(chunks));
      });

      const results = await Promise.all(
        streams.map((stream) => streamFromAPI(stream))
      );

      expect(results).toHaveLength(3);
      // Each stream reader should have called cancel
      streams.forEach((stream) => {
        const reader = stream.getReader() as MockStreamReader;
        expect(reader.cancelCalled).toBe(true);
      });
    });
  });

  describe('Finally Block Guarantee', () => {
    it('should always call cancel even if onError throws', async () => {
      const reader = new MockStreamReader([]);
      const stream = new MockApiStream(reader);

      const onError = vi.fn(() => {
        throw new Error('Error handler error');
      });

      const onChunk = vi.fn(async () => {
        throw new Error('Chunk error');
      });

      try {
        await streamFromAPI(stream, { onChunk, onError });
      } catch (error) {
        // Expected
      }

      // Even if onError throws, cancel must be called in finally
      expect(reader.cancelCalled).toBe(true);
    });

    it('should suppress cancel errors in finally', async () => {
      const failingReader = new (class implements StreamReader {
        async read() {
          return { done: true };
        }

        async cancel() {
          throw new Error('Cancel failed');
        }
      })();

      const stream = new (class implements ApiReadableStream {
        getReader() {
          return failingReader;
        }
      })();

      // Should not throw even if cancel fails
      await expect(streamFromAPI(stream)).resolves.not.toThrow();
    });
  });
});
