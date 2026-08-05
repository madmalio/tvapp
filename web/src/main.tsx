import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { HlsProvider } from "./lib/hls";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <HlsProvider>
        <App />
      </HlsProvider>
    </BrowserRouter>
  </StrictMode>,
);
