import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../app/globals.css";
import { StudyApp } from "../app/components/StudyApp";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Study planner root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <StudyApp />
  </StrictMode>,
);
