import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/auth-context";
import { LoginPage } from "./auth/login-page";
import { RequireAdmin } from "./components/guards";
import { AdminLayout } from "./components/layout";
import { DashboardPage } from "./pages/dashboard-page";
import { SalonsPage } from "./pages/salons-page";
import { SalonCreatePage } from "./pages/salon-create-page";
import { SalonDetailPage } from "./pages/salon-detail-page";
import { CallsPage } from "./pages/calls-page";
import { CallDetailPage } from "./pages/call-detail-page";
import { AiLogsPage } from "./pages/ai-logs-page";
import { AiLogDetailPage } from "./pages/ai-log-detail-page";
import { HealthPage } from "./pages/health-page";
import { CallCenterAgentsPage } from "./pages/call-center-agents-page";

const AdminShell = () => {
  const { session, logout } = useAuth();

  return (
    <AdminLayout onLogout={() => void logout()} userName={session?.user.fullName ?? "Admin"}>
      <Outlet />
    </AdminLayout>
  );
};

const LoginRoute = () => {
  const { session, isInitializing } = useAuth();
  if (isInitializing) {
    return null;
  }
  if (session) {
    return <Navigate to="/dashboard" replace />;
  }
  return <LoginPage />;
};

export const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route
        path="/"
        element={
          <RequireAdmin>
            <AdminShell />
          </RequireAdmin>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="salons" element={<SalonsPage />} />
        <Route path="salons/new" element={<SalonCreatePage />} />
        <Route path="salons/:salonId" element={<SalonDetailPage />} />
        <Route path="call-center-agents" element={<CallCenterAgentsPage />} />
        <Route path="calls" element={<CallsPage />} />
        <Route path="calls/:id" element={<CallDetailPage />} />
        <Route path="ai-logs" element={<AiLogsPage />} />
        <Route path="ai-logs/:id" element={<AiLogDetailPage />} />
        <Route path="health" element={<HealthPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
