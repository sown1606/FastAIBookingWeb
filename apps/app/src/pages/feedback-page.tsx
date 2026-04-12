import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";

interface FeedbackData {
  salon: {
    name: string;
  };
  appointment: {
    serviceName: string;
    staffName: string;
    startTime: string;
  };
  customer: {
    firstName: string;
  };
  submitted: boolean;
}

export const FeedbackPage = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<FeedbackData | null>(null);
  const [rating, setRating] = useState(5);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setError("Liên kết không hợp lệ.");
        return;
      }
      try {
        const result = await apiGet<FeedbackData>(`/api/v1/feedback/${token}`);
        setData(result);
        setSubmitted(result.submitted);
      } catch (loadError) {
        setError(extractErrorMessage(loadError));
      }
    };
    void load();
  }, [token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      return;
    }
    try {
      await apiPost<unknown, { rating: number; reason?: string }>(`/api/v1/feedback/${token}`, {
        rating,
        reason: reason || undefined
      });
      setSubmitted(true);
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    }
  };

  return (
    <div className="feedback-page">
      <section className="feedback-card">
        <p className="eyebrow">{data?.salon.name ?? "FastAIBooking"}</p>
        <h1>Cảm ơn bạn</h1>
        {error ? <p className="form-error">{error}</p> : null}
        {submitted ? (
          <p>Đánh giá của bạn đã được ghi nhận.</p>
        ) : (
          <form className="form-grid" onSubmit={submit}>
            <p className="muted">
              Dịch vụ {data?.appointment.serviceName ?? ""} với {data?.appointment.staffName ?? ""}.
            </p>
            <div className="rating-row">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={rating === value ? "rating-star selected" : "rating-star"}
                  onClick={() => setRating(value)}
                  aria-label={`${value} sao`}
                >
                  {value}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Lý do hoặc góp ý</span>
              <textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <button type="submit" className="button-primary">
              Gửi đánh giá
            </button>
          </form>
        )}
      </section>
    </div>
  );
};
