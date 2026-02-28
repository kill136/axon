/**
 * 自定义应用错误类
 * 用于区分操作错误（operational errors）和编程错误（programming errors）
 */
export class AppError extends Error {
  /**
   * HTTP 状态码
   */
  public readonly statusCode: number;

  /**
   * 是否为操作错误
   * - true: 操作错误（预期的，可以安全地发送给客户端）
   * - false: 编程错误（非预期的，内部错误）
   */
  public readonly isOperational: boolean;

  /**
   * 创建 AppError 实例
   * @param message 错误消息
   * @param statusCode HTTP 状态码，默认为 500
   * @param isOperational 是否为操作错误，默认为 true
   */
  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true
  ) {
    super(message);

    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    // 设置原型链，以便 instanceof 正确工作
    Object.setPrototypeOf(this, AppError.prototype);

    // 捕获堆栈跟踪
    Error.captureStackTrace(this, this.constructor);
  }
}
