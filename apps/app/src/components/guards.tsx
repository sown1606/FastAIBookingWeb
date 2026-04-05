import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { LoadingBlock } from "./states";
import type { Role } from "../types";

export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const { session, isInitializing } = useAuth();

  if (isInitializing) {
    return <LoadingBlock message="Đang khởi tạo phiên..." />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (
    session.user.role !== "SALON_OWNER" &&
    session.user.role !== "STAFF" &&
    session.user.role !== "CALL_CENTER_AGENT"
  ) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export const RequireRole = ({
  roles,
  children
}: {
  roles: Role[];
  children: React.ReactNode;
}) => {
  const { session } = useAuth();
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  if (!roles.includes(session.user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
};
