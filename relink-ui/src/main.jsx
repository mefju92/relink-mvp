// relink-ui/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import './index.css'
import "./styles/tokens.css";

import ImportPage from "./features/import/ImportPage.jsx";

const router = createBrowserRouter([
  { path: "/",    element: <ImportPage /> },
  { path: "/app", element: <ImportPage /> }, // ⬅️ alias na powrót ze Spotify
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
