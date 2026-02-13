/**
 * 时间表达式解析器
 * 将自然语言/ISO 时间字符串解析为 Unix timestamp（毫秒）
 *
 * 支持格式：
 * - ISO 8601: "2026-02-14T08:00:00"
 * - 相对时间: "in 30 minutes", "in 2 hours", "in 1 day"
 * - 自然时间: "tomorrow 08:00", "today 15:30"
 */

const RELATIVE_REGEX = /^in\s+(\d+)\s+(second|minute|hour|day|week)s?$/i;
const NATURAL_REGEX = /^(today|tomorrow)\s+(\d{1,2}):(\d{2})$/i;

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
};

/**
 * 解析时间表达式为 Unix timestamp（毫秒）
 * @throws 无法解析时抛出 Error
 */
export function parseTimeExpression(expr: string): number {
  const trimmed = expr.trim();

  // 1. 尝试 ISO 8601 或标准日期字符串
  const isoTime = Date.parse(trimmed);
  if (!isNaN(isoTime)) {
    return isoTime;
  }

  // 2. 相对时间: "in 30 minutes"
  const relMatch = trimmed.match(RELATIVE_REGEX);
  if (relMatch) {
    const amount = parseInt(relMatch[1], 10);
    const unit = relMatch[2].toLowerCase();
    const ms = UNIT_MS[unit];
    if (ms) {
      return Date.now() + amount * ms;
    }
  }

  // 3. 自然时间: "tomorrow 08:00", "today 15:30"
  const natMatch = trimmed.match(NATURAL_REGEX);
  if (natMatch) {
    const dayWord = natMatch[1].toLowerCase();
    const hours = parseInt(natMatch[2], 10);
    const minutes = parseInt(natMatch[3], 10);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      throw new Error(`Invalid time: ${hours}:${minutes}`);
    }

    const now = new Date();
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);

    if (dayWord === 'tomorrow') {
      target.setDate(target.getDate() + 1);
    } else if (dayWord === 'today' && target.getTime() <= now.getTime()) {
      // "today 08:00" 但 08:00 已过 → 推到明天
      target.setDate(target.getDate() + 1);
    }

    return target.getTime();
  }

  // 4. 纯数字 → 作为 Unix timestamp ms
  const numVal = Number(trimmed);
  if (!isNaN(numVal) && numVal > 1e12) {
    return numVal;
  }

  throw new Error(`Cannot parse time expression: "${expr}". Supported formats: ISO 8601 ("2026-02-14T08:00:00"), relative ("in 30 minutes"), natural ("tomorrow 08:00").`);
}
