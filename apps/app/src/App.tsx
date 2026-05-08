import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/auth-context";
import { LoginPage } from "./auth/login-page";
import { RegisterPage } from "./auth/register-page";
import { ForgotPasswordPage } from "./auth/forgot-password-page";
import { ResetPasswordPage } from "./auth/reset-password-page";
import { RequireAuth, RequireRole } from "./components/guards";
import { AppLayout } from "./components/layout";
import { DashboardPage } from "./pages/dashboard-page";
import { SalonProfilePage } from "./pages/salon-profile-page";
import { StaffPage } from "./pages/staff-page";
import { ServicesPage } from "./pages/services-page";
import { BusinessHoursPage } from "./pages/business-hours-page";
import { CustomersPage } from "./pages/customers-page";
import { AppointmentsPage } from "./pages/appointments-page";
import { AvailabilityPage } from "./pages/availability-page";
import { BillingPage } from "./pages/billing-page";
import { CallsPage } from "./pages/calls-page";
import { AiLogsPage } from "./pages/ai-logs-page";
import { MyProfilePage } from "./pages/my-profile-page";
import { MessagesPage } from "./pages/messages-page";
import { AlertsPage } from "./pages/alerts-page";
import { FeedbackPage } from "./pages/feedback-page";
import { CallCenterPage } from "./pages/call-center-page";

const AppShell = () => {
  const { session, logout } = useAuth();
  if (!session) {
    return null;
  }
  return (
    <AppLayout user={session.user} onLogout={() => void logout()}>
      <Outlet />
    </AppLayout>
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
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/feedback/:token" element={<FeedbackPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route
          path="salon-profile"
          element={
            <RequireRole roles={["SALON_OWNER"]}>
              <SalonProfilePage />
            </RequireRole>
          }
        />
        <Route
          path="staff"
          element={
            <RequireRole roles={["SALON_OWNER"]}>
              <StaffPage />
            </RequireRole>
          }
        />
        <Route
          path="services"
          element={
            <RequireRole roles={["SALON_OWNER"]}>
              <ServicesPage />
            </RequireRole>
          }
        />
        <Route
          path="business-hours"
          element={
            <RequireRole roles={["SALON_OWNER"]}>
              <BusinessHoursPage />
            </RequireRole>
          }
        />
        <Route
          path="customers"
          element={
            <RequireRole roles={["SALON_OWNER"]}>
              <CustomersPage />
            </RequireRole>
          }
        />
        <Route
          path="appointments"
          element={
            <RequireRole roles={["SALON_OWNER", "STAFF"]}>
              <AppointmentsPage />
            </RequireRole>
          }
        />
        <Route
          path="messages"
          element={
            <RequireRole roles={["SALON_OWNER", "STAFF"]}>
              <MessagesPage />
            </RequireRole>
          }
        />
        <Route
          path="alerts"
          element={
            <RequireRole roles={["SALON_OWNER"]}>
              <AlertsPage />
            </RequireRole>
          }
        />
        <Route
          path="call-center"
          element={
            <RequireRole roles={["SALON_OWNER", "CALL_CENTER_AGENT"]}>
              <CallCenterPage />
            </RequireRole>
          }
        />
        <Route
          path="availability"
          element={
            <RequireRole roles={["SALON_OWNER", "STAFF"]}>
              <AvailabilityPage />
            </RequireRole>
          }
        />
        <Route
          path="billing"
          element={
            <RequireRole roles={["SALON_OWNER"]}>
              <BillingPage />
            </RequireRole>
          }
        />
        <Route
          path="calls"
          element={
            <RequireRole roles={["SALON_OWNER"]}>
              <CallsPage />
            </RequireRole>
          }
        />
        <Route
          path="ai-logs"
          element={
            <RequireRole roles={["SALON_OWNER"]}>
              <AiLogsPage />
            </RequireRole>
          }
        />
        <Route
          path="my-profile"
          element={
            <RequireRole roles={["STAFF"]}>
              <MyProfilePage />
            </RequireRole>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
