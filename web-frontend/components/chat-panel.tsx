"use client"

import { useState, useRef, useCallback } from "react"

// SSE 消息类型定义
interface ChunkMessage {
  type: "chunk"
  content: string
}

interface ToolCallMessage {
  type: "tool_call"
  tool_name: string
  status: string
}

interface CompleteMessage {
  type: "complete"
  content: string
}

interface ErrorMessage {
  type: "error"
  content: string
}

// Message interface，含 id 字段用于稳定匹配（修复竞态条件）
interface Message {
  id?: string
  role: "user" | "assistant"
  content: string
  time: string
  isStreaming?: boolean
  toolCalls?: { name: string; status: string }[]
}

// Accumulator 用于在 SSE 流期间累积内容和 toolCalls
interface AccumulatorState {
  content: string
  toolCalls: { tool_name: string; status: string }[]
}

interface SSEOptions {
  onChunk: (msg: ChunkMessage) => void
  onToolCall: (msg: ToolCallMessage) => void
  onComplete: (msg: CompleteMessage) => void
  onError: (msg: ErrorMessage) => void
}

// 封装 SSE 流处理逻辑
async function streamChat(prompt: string, options: SSEOptions): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })

  if (!response.ok) {
    options.onError({ type: "error", content: `HTTP ${response.status}: ${response.statusText}` })
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    options.onError({ type: "error", content: "无法读取响应流" })
    return
  }

  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (!data || data === "[DONE]") continue

        try {
          const msg = JSON.parse(data)
          switch (msg.type) {
            case "chunk":
              options.onChunk(msg as ChunkMessage)
              break
            case "tool_call":
              options.onToolCall(msg as ToolCallMessage)
              break
            case "complete":
              options.onComplete(msg as CompleteMessage)
              break
            case "error":
              options.onError(msg as ErrorMessage)
              break
          }
        } catch {
          // 忽略格式错误的 JSON
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // accumulatorRef 在 SSE 流期间累积内容，避免闭包捕获旧 state
  const accumulatorRef = useRef<AccumulatorState>({ content: "", toolCalls: [] })

  const handleSend = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || isStreaming) return

    setInput("")
    setError(null)

    // 添加用户消息
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: prompt,
        time: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      },
    ])

    setIsStreaming(true)

    // 为 AI 消息占位符生成稳定的唯一 id，避免闭包中 index 过期的竞态条件
    const aiMsgId = crypto.randomUUID()

    // 重置 accumulator
    accumulatorRef.current = { content: "", toolCalls: [] }

    // 添加 AI 消息占位符
    setMessages((prev) => [
      ...prev,
      {
        id: aiMsgId,
        role: "assistant",
        content: "",
        time: "",
        isStreaming: true,
      },
    ])

    await streamChat(prompt, {
      onChunk: (msg: ChunkMessage) => {
        // 累积内容到 ref，避免多次 setState 中的 race condition
        accumulatorRef.current.content += msg.content
        // 用 id 匹配目标消息，而非 index（修复竞态条件核心）
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? { ...m, content: accumulatorRef.current.content }
              : m,
          ),
        )
      },

      onToolCall: (msg: ToolCallMessage) => {
        // 更新 toolCalls 状态（新增或更新已存在的 tool）
        const existing = accumulatorRef.current.toolCalls
        const idx = existing.findIndex((tc) => tc.tool_name === msg.tool_name)
        if (idx >= 0) {
          existing[idx].status = msg.status
        } else {
          existing.push({ tool_name: msg.tool_name, status: msg.status })
        }
        // 用 id 匹配，更新 toolCalls 展示
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== aiMsgId) return m
            const toolCalls = accumulatorRef.current.toolCalls.map((tc) => ({
              name: tc.tool_name,
              status: tc.status,
            }))
            return { ...m, toolCalls }
          }),
        )
      },

      onComplete: (msg: CompleteMessage) => {
        // 用 id 匹配，完成消息更新
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  content: msg.content,
                  time: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
                  isStreaming: false,
                  toolCalls: undefined,
                }
              : m,
          ),
        )
        setIsStreaming(false)
      },

      onError: (msg: ErrorMessage) => {
        console.error("SSE error:", msg)
        setError(msg.content)
        // 用 id 匹配，错误状态更新
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  content: `错误: ${msg.content}`,
                  time: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
                  isStreaming: false,
                }
              : m,
          ),
        )
        setIsStreaming(false)
      },
    })
  }, [input, isStreaming])

  // JSX 渲染部分（第 231 行以后，不在修改范围内）
  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={msg.id ?? idx}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {msg.isStreaming ? (
                <span className="animate-pulse">{msg.content || "▋"}</span>
              ) : (
                <span>{msg.content}</span>
              )}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.toolCalls.map((tc, i) => (
                    <div key={i} className="text-xs text-gray-500">
                      🔧 {tc.name}: {tc.status}
                    </div>
                  ))}
                </div>
              )}
              {msg.time && (
                <div className="text-xs text-gray-400 mt-1">{msg.time}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-4 mb-2 p-2 bg-red-100 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      {/* 输入区域 */}
      <div className="border-t p-4 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="输入消息..."
          disabled={isStreaming}
          className="flex-1 border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={isStreaming || !input.trim()}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isStreaming ? "发送中..." : "发送"}
        </button>
      </div>
    </div>
  )
}
