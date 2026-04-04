import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { LoadingBlock } from "./states";

export const RequireAdmin = ({ children }: { children: React.ReactNode }) => {
  const { session, isInitializing } = useAuth();

  if (isInitializing) {
    return <LoadingBlock message="Đang khởi tạo phiên..." />;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  if (session.user.role !== "PLATFORM_ADMIN") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};
