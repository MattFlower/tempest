import { createRoot } from "react-dom/client";
import "./styles/global.css";
import { App } from "./App";

// Initialize RPC client (side-effect: sets up Electroview + message handlers)
import "./state/rpc-client";

const root = document.getElementById("root")!;
createRoot(root).render(<App />);
