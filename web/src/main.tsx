import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/globals.css";
if (localStorage.getItem("kairo_theme") === "light") { document.documentElement.classList.remove("dark"); } else { document.documentElement.classList.add("dark"); }
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
