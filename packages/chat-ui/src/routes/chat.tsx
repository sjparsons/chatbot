import { useState } from "react";
import { MessageList } from "../components/MessageList";
import { MessageInput } from "../components/MessageInput";
import { sendMessage } from "../api/chat";
import type { Message } from "../types";

export function ChatRoute() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);

  async function handleSend(content: string) {
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content },
    ]);
    setPending(true);

    try {
      const reply = await sendMessage(content);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: reply },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="chat">
      <MessageList messages={messages} pending={pending} />
      <MessageInput disabled={pending} onSend={handleSend} />
    </div>
  );
}
