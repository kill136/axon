/**
 * Stream Handler with Memory Leak Prevention
 *
 * Fixes v2.1.74 bug: API response buffers are not released on early termination
 *
 * Key improvements:
 * - Added finally block to ensure cleanup
 * - Call reader.cancel() to release resources
 * - Prevent accumulation of chunks in memory
 * - Proper error handling without swallowing exceptions
 */

/**
 * Represents a readable stream from the API
 */
export interface ApiReadableStream {
  getReader(): StreamReader;
}

/**
 * Stream reader interface
 */
export interface StreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: Error): Promise<void>;
}

/**
 * Chunk processed by the stream handler
 */
export interface StreamChunk {
  value: Uint8Array;
  timestamp: number;
}

/**
 * Stream handler options
 */
export interface StreamHandlerOptions {
  maxChunkSize?: number;
  timeout?: number;
  onChunk?: (chunk: StreamChunk) => Promise<void>;
  onError?: (error: Error) => void;
}

/**
 * Handles streaming API responses with proper memory management
 *
 * v2.1.74 bug fix: Ensures reader is closed even on early termination
 *
 * @param stream The API response stream
 * @param options Configuration options
 * @returns Promise that resolves when stream processing completes
 */
export async function streamFromAPI(
  stream: ApiReadableStream,
  options: StreamHandlerOptions = {}
): Promise<void> {
  const reader = stream.getReader();
  let shouldCancel = false;

  try {
    while (!shouldCancel) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      // Process chunk immediately
      if (value) {
        await processChunk(value, options);
      }

      // value will be eligible for garbage collection after this iteration
    }
  } catch (error) {
    if (options.onError) {
      options.onError(error as Error);
    }
    shouldCancel = true;

    // Re-throw the error so caller can handle it
    throw error;
  } finally {
    // CRITICAL: Ensure reader is always closed
    // This fixes v2.1.74 memory leak
    try {
      await reader.cancel();
    } catch (cancelError) {
      // Log but don't throw - we're already in error handling
      console.debug('Reader cancel error (expected):', cancelError);
    }
  }
}

/**
 * Processes a single stream chunk
 *
 * @param value The chunk data
 * @param options Stream handler options
 */
async function processChunk(value: Uint8Array, options: StreamHandlerOptions): Promise<void> {
  if (options.maxChunkSize && value.length > options.maxChunkSize) {
    throw new Error(`Chunk size ${value.length} exceeds maximum ${options.maxChunkSize}`);
  }

  const chunk: StreamChunk = {
    value,
    timestamp: Date.now(),
  };

  if (options.onChunk) {
    await options.onChunk(chunk);
  }
}

/**
 * Streams API response with timeout support
 *
 * @param stream The API response stream
 * @param options Configuration options
 * @returns Promise that resolves when stream processing completes
 */
export async function streamWithTimeout(
  stream: ApiReadableStream,
  options: StreamHandlerOptions & { timeout?: number } = {}
): Promise<void> {
  const timeout = options.timeout || 30000; // 30 second default

  return Promise.race([
    streamFromAPI(stream, options),
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Stream timeout')), timeout)
    ),
  ]);
}

/**
 * Accumulates stream chunks into a buffer
 * WARNING: Use with caution for large responses
 *
 * @param stream The API response stream
 * @param options Configuration options
 * @returns Complete response buffer
 */
export async function streamToBuffer(
  stream: ApiReadableStream,
  options: StreamHandlerOptions = {}
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  const maxTotalSize = 100 * 1024 * 1024; // 100MB default limit

  const bufferChunk = async (chunk: StreamChunk) => {
    totalSize += chunk.value.length;
    if (totalSize > maxTotalSize) {
      throw new Error(`Total stream size exceeds maximum ${maxTotalSize}`);
    }
    chunks.push(chunk.value);
  };

  const customOptions = {
    ...options,
    onChunk: bufferChunk,
  };

  try {
    await streamFromAPI(stream, customOptions);

    // Combine all chunks
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  } finally {
    // Explicitly clear chunks array to help GC
    chunks.length = 0;
  }
}

/**
 * Streams API response as text
 *
 * @param stream The API response stream
 * @param options Configuration options
 * @returns Complete response text
 */
export async function streamToText(
  stream: ApiReadableStream,
  options: StreamHandlerOptions = {}
): Promise<string> {
  const buffer = await streamToBuffer(stream, options);
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}
