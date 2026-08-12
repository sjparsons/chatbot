import { createBrowserRouter } from "react-router";
import { RootLayout } from "./routes/root";
import { ChatRoute } from "./routes/chat";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [{ index: true, element: <ChatRoute /> }],
  },
]);
