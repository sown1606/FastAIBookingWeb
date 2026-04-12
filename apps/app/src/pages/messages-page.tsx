import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useAuth } from "../auth/auth-context";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";

interface StaffSummary {
  id: string;
  fullName: string;
  email: string | null;
}

interface ThreadItem {
  staff: StaffSummary;
  lastMessage: ChatMessage | null;
}

interface ChatMessage {
  id: string;
  body: string;
  createdAt: string;
  sender: {
    id: string;
    fullName: string;
    role: string;
  };
}

export const MessagesPage = () => {
  const { session } = useAuth();
  const { notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState("");

  const isOwner = session?.user.role === "SALON_OWNER";

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      if (isOwner) {
        const threadItems = await apiGet<ThreadItem[]>("/api/v1/messages/threads");
        setThreads(threadItems);
        const nextStaffId = selectedStaffId || threadItems[0]?.staff.id || "";
        setSelectedStaffId(nextStaffId);
        if (nextStaffId) {
          const result = await apiGet<ChatMessage[]>(`/api/v1/messages/staff/${nextStaffId}`);
          setMessages(result);
        }
      } else {
        const result = await apiGet<ChatMessage[]>("/api/v1/messages/me");
        setMessages(result);
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [isOwner]);

  const openThread = async (staffId: string) => {
    setSelectedStaffId(staffId);
    try {
      const result = await apiGet<ChatMessage[]>(`/api/v1/messages/staff/${staffId}`);
      setMessages(result);
    } catch (openError) {
      notify("error", extractErrorMessage(openError));
    }
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!body.trim()) {
      return;
    }
    try {
      const url = isOwner ? `/api/v1/messages/staff/${selectedStaffId}` : "/api/v1/messages/me";
      await apiPost<ChatMessage, { body: string }>(url, { body });
      setBody("");
      await load();
    } catch (sendError) {
      notify("error", extractErrorMessage(sendError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <div className="stack">
      {isOwner ? (
        <section className="card">
          <h2>Nhân viên</h2>
          {threads.length ? (
            <div className="quick-actions">
              {threads.map((thread) => (
                <button
                  type="button"
                  key={thread.staff.id}
                  className={thread.staff.id === selectedStaffId ? "button-primary" : "button-secondary"}
                  onClick={() => void openThread(thread.staff.id)}
                >
                  {thread.staff.fullName}
                </button>
              ))}
            </div>
          ) : (
            <EmptyBlock message="Chưa có hội thoại nhân viên." />
          )}
        </section>
      ) : null}

      <section className="card chat-panel">
        <h2>Tin nhắn</h2>
        {messages.length ? (
          <div className="message-list">
            {messages.map((message) => (
              <article
                key={message.id}
                className={message.sender.id === session?.user.id ? "message-bubble mine" : "message-bubble"}
              >
                <strong>{message.sender.fullName}</strong>
                <p>{message.body}</p>
                <span>{formatDateTime(message.createdAt)}</span>
              </article>
            ))}
          </div>
        ) : (
          <EmptyBlock message="Chưa có tin nhắn." />
        )}
        <form className="form-grid" onSubmit={send}>
          <label className="field">
            <span>Nội dung</span>
            <textarea
              rows={3}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
            />
          </label>
          <button type="submit" className="button-primary" disabled={isOwner && !selectedStaffId}>
            Gửi tin nhắn
          </button>
        </form>
      </section>
    </div>
  );
};
