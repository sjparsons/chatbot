import { useEffect, useState } from "react";
import { Outlet } from "react-router";
import { Sidebar } from "../components/Sidebar";
import { SessionsProvider } from "../sessions";

const STORAGE_KEY = "sidebar-expanded";

export function RootLayout() {
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem(STORAGE_KEY) !== "false",
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(expanded));
  }, [expanded]);

  return (
    <SessionsProvider>
      <div className="app">
        <Sidebar expanded={expanded} onToggle={() => setExpanded((v) => !v)} />
        <div className="app__body">
          <header className="app__header">
            <h1>Chat</h1>
          </header>
          <main className="app__main">
            <Outlet />
          </main>
        </div>
      </div>
    </SessionsProvider>
  );
}
