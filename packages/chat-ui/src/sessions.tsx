import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { listSessions } from "./api/sessions";
import type { SessionSummary } from "./types";

interface SessionsValue {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  /** Re-fetch — called after a turn completes, since it may have created a
   *  session or changed which one sorts first. */
  refresh: () => void;
}

const SessionsContext = createContext<SessionsValue | null>(null);

export function SessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSessions(await listSessions());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionsContext.Provider value={{ sessions, loading, error, refresh }}>
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessions(): SessionsValue {
  const value = useContext(SessionsContext);
  if (!value) throw new Error("useSessions used outside SessionsProvider");
  return value;
}
