import { useEffect, useRef } from "react";
import type { Message } from "../types";

interface Props {
  messages: Message[];
  pending: boolean;
}

export function MessageList({ messages, pending }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  return (
    <div className="messages">
      {messages.length === 0 && !pending && (
        <p className="empty">Send a message to get started.</p>
      )}

      {messages.map((message) => (
        <div key={message.id} className={`message message--${message.role}`}>
          <span className="message__role">{message.role}</span>
          <p className="message__content">{message.content}</p>
        </div>
      ))}

      {pending && (
        <div className="message message--assistant">
          <span className="message__role">assistant</span>
          <p className="message__content message__content--pending">…</p>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
