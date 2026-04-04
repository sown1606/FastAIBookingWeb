import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from "axios";
import { clearSession, getSession, setSession } from "./auth-storage";
import type { ApiEnvelope, ApiErrorEnvelope, AuthSession } from "../types";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

const http = axios.create({
  baseURL: apiBaseUrl,
  timeout: 20_000
});

let refreshPromise: Promise<AuthSession> | null = null;
let sessionInvalidationHandler: (() => void) | null = null;

const isApiErrorEnvelope = (value: unknown): value is ApiErrorEnvelope => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const envelope = value as ApiErrorEnvelope;
  return envelope.success === false && typeof envelope.error?.message === "string";
};

const refreshTokens = async (): Promise<AuthSession> => {
  const existing = getSession();
  if (!existing?.refreshToken) {
    throw new Error("Missing refresh token.");
  }

  const response = await axios.post<ApiEnvelope<AuthSession>>(
    `${apiBaseUrl}/api/v1/auth/refresh`,
    {
      refreshToken: existing.refreshToken
    },
    {
      timeout: 20_000
    }
  );

  const nextSession = response.data.data;
  setSession(nextSession);
  return nextSession;
};

http.interceptors.request.use((config) => {
  const session = getSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorEnvelope>) => {
    const originalRequest = error.config;
    if (!originalRequest) {
      return Promise.reject(error);
    }

    const shouldTryRefresh =
      error.response?.status === 401 &&
      !originalRequest.url?.includes("/auth/refresh") &&
      !originalRequest.url?.includes("/admin/auth/login") &&
      !originalRequest.headers["x-retry-refresh"];

    if (!shouldTryRefresh) {
      return Promise.reject(error);
    }

    try {
      if (!refreshPromise) {
        refreshPromise = refreshTokens();
      }
      const nextSession = await refreshPromise;
      refreshPromise = null;
      originalRequest.headers.Authorization = `Bearer ${nextSession.accessToken}`;
      originalRequest.headers["x-retry-refresh"] = "1";
      return http.request(originalRequest);
    } catch (refreshError) {
      refreshPromise = null;
      clearSession();
      sessionInvalidationHandler?.();
      return Promise.reject(refreshError);
    }
  }
);

const unwrap = <T>(response: AxiosResponse<ApiEnvelope<T>>): T => {
  return response.data.data;
};

export const registerSessionInvalidationHandler = (handler: (() => void) | null) => {
  sessionInvalidationHandler = handler;
};

export const extractErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error) && isApiErrorEnvelope(error.response?.data)) {
    return error.response?.data.error.message ?? "Request failed.";
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error.";
};

export const apiGet = async <T>(url: string, config?: AxiosRequestConfig): Promise<T> => {
  const response = await http.get<ApiEnvelope<T>>(url, config);
  return unwrap(response);
};

export const apiPost = async <T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig
): Promise<T> => {
  const response = await http.post<ApiEnvelope<T>>(url, body, config);
  return unwrap(response);
};

export const apiPatch = async <T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig
): Promise<T> => {
  const response = await http.patch<ApiEnvelope<T>>(url, body, config);
  return unwrap(response);
};

export const apiPut = async <T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig
): Promise<T> => {
  const response = await http.put<ApiEnvelope<T>>(url, body, config);
  return unwrap(response);
};

export const apiDelete = async <T>(url: string, config?: AxiosRequestConfig): Promise<T> => {
  const response = await http.delete<ApiEnvelope<T>>(url, config);
  return unwrap(response);
};
