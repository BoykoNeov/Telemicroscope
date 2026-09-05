import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
// Imported for its side effect: stamps the stored theme on <html> before the
// first paint, so a reader who chose dark never sees a white flash.
import "./theme";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
