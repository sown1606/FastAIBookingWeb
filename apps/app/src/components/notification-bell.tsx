import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useToast } from "./toast";

interface UserNotification {
  id: string;
  title: string;
  body: string;
  type: string;
  priority: string;
  data: unknown;
  url: string | null;
  readAt: string | null;
  createdAt: string;
}

interface InboxResponse {
  items: UserNotification[];
}

interface UnreadCountResponse {
  count: number;
}

export const NOTIFICATIONS_CHANGED_EVENT = "fastaibooking:notifications-changed";

export const NotificationBell = () => {
  const { t } = useI18n();
  const { notify } = useToast();
  const navigate = useNavigate();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<UserNotification[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);

  const loadUnreadCount = async () => {
    try {
      const result = await apiGet<UnreadCountResponse>("/api/v1/notifications/unread-count");
      setUnreadCount(result.count);
    } catch {
      setUnreadCount(0);
    }
  };

  const loadInbox = async () => {
    setLoadingInbox(true);
    try {
      const result = await apiGet<InboxResponse>("/api/v1/notifications/inbox?limit=10");
      setItems(result.items);
    } catch (error) {
      notify("error", extractErrorMessage(error));
    } finally {
      setLoadingInbox(false);
    }
  };

  useEffect(() => {
    void loadUnreadCount();
    const interval = window.setInterval(() => void loadUnreadCount(), 30_000);
    const handleNotificationsChanged = () => {
      void loadUnreadCount();
      if (open) {
        void loadInbox();
      }
    };
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, handleNotificationsChanged);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, handleNotificationsChanged);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void loadInbox();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const markRead = async (notification: UserNotification) => {
    try {
      await apiPost<UserNotification, Record<string, never>>(
        `/api/v1/notifications/${notification.id}/read`,
        {}
      );
      setItems((prev) =>
        prev.map((item) =>
          item.id === notification.id
            ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
            : item
        )
      );
      await loadUnreadCount();
    } catch (error) {
      notify("error", extractErrorMessage(error));
    }
  };

  const markAllRead = async () => {
    try {
      await apiPost<{ count: number }, Record<string, never>>(
        "/api/v1/notifications/read-all",
        {}
      );
      setItems((prev) =>
        prev.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (error) {
      notify("error", extractErrorMessage(error));
    }
  };

  const openNotification = async (notification: UserNotification) => {
    await markRead(notification);
    setOpen(false);
    if (notification.url) {
      navigate(notification.url);
    }
  };

  return (
    <div className="notification-bell" ref={menuRef}>
      <button
        type="button"
        className="notification-bell-button"
        aria-label={t("notifications.title")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 17H9m9-2V10a6 6 0 0 0-12 0v5l-2 2h16l-2-2Zm-4 4a2 2 0 0 1-4 0" />
        </svg>
        {unreadCount > 0 ? (
          <span className="notification-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
        ) : null}
      </button>

      {open ? (
        <div className="notification-menu" role="dialog" aria-label={t("notifications.title")}>
          <div className="notification-actions">
            <strong>{t("notifications.title")}</strong>
            <button type="button" className="button-secondary" onClick={() => void markAllRead()}>
              {t("notifications.markAllRead")}
            </button>
          </div>

          {loadingInbox ? (
            <p className="muted">{t("common.loading")}</p>
          ) : items.length ? (
            <div className="notification-list">
              {items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={item.readAt ? "notification-item" : "notification-item unread"}
                  onClick={() => void openNotification(item)}
                >
                  <span>
                    <strong>{item.title}</strong>
                    <small>{formatDateTime(item.createdAt)}</small>
                  </span>
                  <span>{item.body}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="notification-empty">{t("notifications.empty")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
};
