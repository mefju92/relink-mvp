// relink-ui/src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";

import ImportPage from "./features/import/ImportPage.jsx"; // lub .tsx, jeśli użyłeś TSX

const router = createBrowserRouter([
  { path: "/", element: <ImportPage /> },
  // { path: "/playlists", element: <PlaylistsPage /> }, // kolejne trasy później
]);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
