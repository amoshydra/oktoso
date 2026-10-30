import { createRoot } from "react-dom/client";
import "@agent-hub/ui/tokens.css";
import "@agent-hub/ui/base.css";
import "./styles.css";
import { App } from "./app/App";

const savedTheme = localStorage.getItem("agent-hub-theme");
document.documentElement.dataset.theme = savedTheme === "light" ? "light" : "dark";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root");
createRoot(root).render(<App />);
