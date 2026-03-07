import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const LEGACY_REPO_BASE_PATH = "/alife-sdk";

if (
  import.meta.env.PROD &&
  import.meta.env.BASE_URL === "/" &&
  window.location.pathname.startsWith(LEGACY_REPO_BASE_PATH)
) {
  const nextPath = window.location.pathname.slice(LEGACY_REPO_BASE_PATH.length) || "/";
  const nextUrl = `${nextPath}${window.location.search}${window.location.hash}`;

  window.history.replaceState(null, "", nextUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
