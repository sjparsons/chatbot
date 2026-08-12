import { useState } from "react";
import { MessageList } from "../components/MessageList";
import { MessageInput } from "../components/MessageInput";
import { sendMessage } from "../api/chat";
import type { Message } from "../types";

export function ChatRoute() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSend(content: string) {
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content },
    ]);
    setPending(true);
    setError(null);

    const assistantId = crypto.randomUUID();

    try {
      await sendMessage(
        { content, sessionId },
        {
          onStart: (payload) => setSessionId(payload.sessionId),
          onDelta: (text) => {
            setStreamingId(assistantId);
            setMessages((current) =>
              current.some((message) => message.id === assistantId)
                ? current.map((message) =>
                    message.id === assistantId
                      ? { ...message, content: message.content + text }
                      : message,
                  )
                : [
                    ...current,
                    { id: assistantId, role: "assistant", content: text },
                  ],
            );
          },
        },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
      setStreamingId(null);
    }
  }

  return (
    <div className="chat">
      <MessageList
        messages={messages}
        // The placeholder is only for the gap before the first chunk lands;
        // once text is streaming, the message itself is the progress indicator.
        pending={pending && streamingId === null}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <MessageInput disabled={pending} onSend={handleSend} />
    </div>
  );
}
