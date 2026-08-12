import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { MessageList } from "../components/MessageList";
import { MessageInput } from "../components/MessageInput";
import { sendMessage } from "../api/chat";
import { fetchMessages } from "../api/sessions";
import { useSessions } from "../sessions";
import type { Message } from "../types";

export function ChatRoute() {
  const routeSessionId = useParams().sessionId ?? null;
  const navigate = useNavigate();
  const { refresh } = useSessions();

  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(routeSessionId !== null);
  const [pending, setPending] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The session currently on screen. Kept in a ref as well as state because
  // the sync effect below must compare against it without re-running when it
  // changes — see the comment there.
  const loadedRef = useRef<string | null>(null);

  function adopt(id: string | null) {
    loadedRef.current = id;
    setSessionId(id);
  }

  // Rehydrate whenever the URL points at a session we aren't already showing.
  //
  // The guard is what makes starting a new chat work: sending the first
  // message creates a session server-side and we navigate to /c/<id>, but we
  // already hold that transcript, so this must not re-fetch and wipe it out.
  useEffect(() => {
    if (routeSessionId === loadedRef.current) return;

    adopt(routeSessionId);
    setMessages([]);
    setError(null);

    if (!routeSessionId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchMessages(routeSessionId)
      .then((loaded) => {
        if (!cancelled) setMessages(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? `Could not load this session: ${cause.message}`
              : String(cause),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [routeSessionId]);

  async function handleSend(content: string) {
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content },
    ]);
    setPending(true);
    setError(null);

    const assistantId = crypto.randomUUID();
    let startedSessionId: string | null = null;

    try {
      await sendMessage(
        { content, sessionId },
        {
          onStart: (payload) => {
            startedSessionId = payload.sessionId;
            adopt(payload.sessionId);
          },
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

      // Put the session in the URL once the turn is done, so a refresh or a
      // shared link lands back here. Done after the stream rather than in
      // onStart to keep navigation off the streaming path.
      if (startedSessionId && startedSessionId !== routeSessionId) {
        void navigate(`/c/${startedSessionId}`, { replace: true });
      }
      refresh();
    }
  }

  return (
    <div className="chat">
      {loading ? (
        <p className="empty">Loading session…</p>
      ) : (
        <MessageList
          messages={messages}
          // The placeholder is only for the gap before the first chunk lands;
          // once text is streaming, the message itself is the progress indicator.
          pending={pending && streamingId === null}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <MessageInput disabled={pending || loading} onSend={handleSend} />
    </div>
  );
}
