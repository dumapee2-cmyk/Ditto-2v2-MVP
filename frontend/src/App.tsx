import { BrowserRouter, Routes, Route } from "react-router-dom";

import { DashboardPage } from "./pages/DashboardPage";
import { CreateAgentPage } from "./pages/CreateAgentPage";
import { AgentPage } from "./pages/AgentPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { BlindDatePage } from "./pages/BlindDatePage";
import { SignupPage } from "./pages/SignupPage";
import { FormPage } from "./pages/FormPage";
import { AdminPage } from "./pages/AdminPage";
import "./index.css";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BlindDatePage />} />
        <Route path="/app" element={<DashboardPage />} />
        <Route path="/create" element={<CreateAgentPage />} />
        <Route path="/agent/:id" element={<AgentPage />} />
        <Route path="/blind-date" element={<BlindDatePage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/form" element={<FormPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
