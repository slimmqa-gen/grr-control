import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { setupPwa } from "./lib/pwa";

if (!window.location.hash) {
  window.location.hash = "#/";
}

setupPwa();

createRoot(document.getElementById("root")!).render(<App />);
