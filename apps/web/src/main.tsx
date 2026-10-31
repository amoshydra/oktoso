import { createRoot } from "react-dom/client";
import "@amoshydra/oktoso-ui/tokens.css";
import "@amoshydra/oktoso-ui/base.css";
import "./styles.css";
import { App } from "./app/App";

const savedTheme = localStorage.getItem("oktoso-theme");
document.documentElement.dataset.theme = savedTheme === "light" ? "light" : "dark";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root");
createRoot(root).render(<App />);
