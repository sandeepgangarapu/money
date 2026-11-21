import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { prefetchInitial } from "./useMoneyStore";

// Start the first month's requests before React renders anything.
prefetchInitial();

const root = document.getElementById("root");
if (!root) throw new Error("App root is missing");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
