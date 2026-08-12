import { Outlet } from "react-router";

export function RootLayout() {
  return (
    <div className="app">
      <header className="app__header">
        <h1>Chat</h1>
      </header>
      <main className="app__main">
        <Outlet />
      </main>
    </div>
  );
}
