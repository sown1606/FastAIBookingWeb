import { FormEvent, useState } from "react";
import { apiPost, extractErrorMessage } from "../lib/api";
import { useI18n } from "../lib/i18n";

type SuggestedAction = "CALLBACK" | "REGISTER" | "PAYMENT" | "NONE";

interface AssistantMessage {
  role: "assistant" | "user";
  text: string;
}

interface AssistantReply {
  message: string;
  suggestedAction: SuggestedAction;
  source: "ai" | "guided";
}

export const RegistrationAssistant = ({
  onChoose
}: {
  onChoose: (mode: "callback" | "form") => void;
}) => {
  const { t } = useI18n();
  const [messages, setMessages] = useState<AssistantMessage[]>([
    { role: "assistant", text: t("auth.register.assistantWelcome") }
  ]);
  const [input, setInput] = useState("");
  const [suggestedAction, setSuggestedAction] = useState<SuggestedAction>("NONE");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = input.trim();
    if (!text || submitting) {
      return;
    }
    const nextMessages = [...messages, { role: "user" as const, text }].slice(-9);
    setMessages(nextMessages);
    setInput("");
    setError("");
    setSubmitting(true);
    try {
      const reply = await apiPost<AssistantReply, { messages: AssistantMessage[] }>(
        "/api/v1/auth/registration-assistant",
        { messages: nextMessages }
      );
      setMessages((current) => [
        ...current,
        { role: "assistant" as const, text: reply.message }
      ].slice(-10));
      setSuggestedAction(reply.suggestedAction);
    } catch (assistantError) {
      setError(extractErrorMessage(assistantError));
    } finally {
      setSubmitting(false);
    }
  };

  const actionButton =
    suggestedAction === "CALLBACK" ? (
      <button type="button" className="button-secondary" onClick={() => onChoose("callback")}>
        {t("auth.register.chooseCallback")}
      </button>
    ) : suggestedAction === "REGISTER" || suggestedAction === "PAYMENT" ? (
      <button type="button" className="button-secondary" onClick={() => onChoose("form")}>
        {t("auth.register.openForm")}
      </button>
    ) : null;

  return (
    <details className="registration-assistant">
      <summary>{t("auth.register.assistantTitle")}</summary>
      <div className="registration-assistant-body">
        <div className="registration-assistant-messages" aria-live="polite">
          {messages.map((message, index) => (
            <p
              className={message.role === "user" ? "assistant-message mine" : "assistant-message"}
              key={`${message.role}-${index}`}
            >
              {message.text}
            </p>
          ))}
        </div>
        {actionButton}
        <form className="registration-assistant-form" onSubmit={send}>
          <input
            value={input}
            maxLength={1000}
            onChange={(event) => setInput(event.target.value)}
            placeholder={t("auth.register.assistantPlaceholder")}
            aria-label={t("auth.register.assistantPlaceholder")}
          />
          <button type="submit" className="button-primary" disabled={submitting || !input.trim()}>
            {submitting ? t("auth.register.assistantThinking") : t("auth.register.assistantSend")}
          </button>
        </form>
        <small className="muted">{t("auth.register.assistantSafety")}</small>
        {error ? <div className="form-error">{error}</div> : null}
      </div>
    </details>
  );
};
