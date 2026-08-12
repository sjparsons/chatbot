import { NavLink, useNavigate } from "react-router";
import { useSessions } from "../sessions";

/** "3m", "2h", "5d" — enough to order the list at a glance. */
function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

interface Props {
  expanded: boolean;
  onToggle: () => void;
}

export function Sidebar({ expanded, onToggle }: Props) {
  const { sessions, loading, error } = useSessions();
  const navigate = useNavigate();

  return (
    <aside className={`sidebar ${expanded ? "" : "sidebar--collapsed"}`}>
      <div className="sidebar__actions">
        <button
          className="sidebar__icon"
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {expanded ? "«" : "»"}
        </button>
        <button
          className="sidebar__icon"
          type="button"
          onClick={() => navigate("/")}
          aria-label="New chat"
          title="New chat"
        >
          +
        </button>
      </div>

      {expanded && (
        <>
          <h2 className="sidebar__heading">Sessions</h2>

          {loading && <p className="sidebar__note">Loading…</p>}
          {error && (
            <p className="sidebar__note sidebar__note--error">{error}</p>
          )}
          {!loading && !error && sessions.length === 0 && (
            <p className="sidebar__note">No sessions yet.</p>
          )}

          <nav className="sidebar__list">
            {sessions.map((session) => (
              <NavLink
                key={session.id}
                to={`/c/${session.id}`}
                className={({ isActive }) =>
                  `session ${isActive ? "session--active" : ""}`
                }
              >
                <span className="session__title">
                  {session.preview ?? "Empty session"}
                </span>
                <span className="session__meta">
                  {session.turnCount}{" "}
                  {session.turnCount === 1 ? "turn" : "turns"} ·{" "}
                  {relativeTime(session.updatedAt)}
                </span>
              </NavLink>
            ))}
          </nav>
        </>
      )}
    </aside>
  );
}
