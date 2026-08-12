import { createBrowserRouter } from "react-router";
import { RootLayout } from "./routes/root";
import { ChatRoute } from "./routes/chat";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <ChatRoute /> },
      // A session the user has jumped back into. Same component — it just
      // rehydrates from the server before accepting new turns.
      { path: "c/:sessionId", element: <ChatRoute /> },
    ],
  },
]);
