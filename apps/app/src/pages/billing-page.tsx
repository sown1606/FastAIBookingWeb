import { useEffect, useState } from "react";
import { apiGet, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { formatCurrencyCents, formatDateTime } from "../lib/format";

interface BillingUsage {
  currentUsage: {
    freeStaffLimit: number;
    activeStaffCount: number;
    includedStaffCount: number;
    billableExtraStaffCount: number;
    extraStaffUnitPriceCents: number;
    estimatedExtraCostCents: number;
  };
  history: Array<{
    periodStart: string;
    periodEnd: string;
    activeStaffCount: number;
    billableExtraStaffCount: number;
    estimatedExtraCostCents: number;
  }>;
}

export const BillingPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<BillingUsage | null>(null);

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const result = await apiGet<BillingUsage>("/api/v1/billing/usage?historyLimit=12");
      setUsage(result);
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  if (!usage) {
    return <ErrorBlock message="Chưa tải được dữ liệu chi phí." onRetry={load} />;
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Kỳ hiện tại</h2>
        <div className="metrics-grid">
          <div>
            <span className="muted">Nhân viên miễn phí</span>
            <strong>{usage.currentUsage.freeStaffLimit}</strong>
          </div>
          <div>
            <span className="muted">Nhân viên hoạt động</span>
            <strong>{usage.currentUsage.activeStaffCount}</strong>
          </div>
          <div>
            <span className="muted">Nhân viên tính phí thêm</span>
            <strong>{usage.currentUsage.billableExtraStaffCount}</strong>
          </div>
          <div>
            <span className="muted">Đơn giá mỗi nhân viên thêm</span>
            <strong>{formatCurrencyCents(usage.currentUsage.extraStaffUnitPriceCents)}</strong>
          </div>
          <div>
            <span className="muted">Chi phí thêm dự kiến</span>
            <strong>{formatCurrencyCents(usage.currentUsage.estimatedExtraCostCents)}</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Lịch sử sử dụng</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Bắt đầu kỳ</th>
                <th>Kết thúc kỳ</th>
                <th>Nhân viên hoạt động</th>
                <th>Nhân viên thêm</th>
                <th>Chi phí thêm dự kiến</th>
              </tr>
            </thead>
            <tbody>
              {usage.history.map((entry) => (
                <tr key={`${entry.periodStart}-${entry.periodEnd}`}>
                  <td>{formatDateTime(entry.periodStart)}</td>
                  <td>{formatDateTime(entry.periodEnd)}</td>
                  <td>{entry.activeStaffCount}</td>
                  <td>{entry.billableExtraStaffCount}</td>
                  <td>{formatCurrencyCents(entry.estimatedExtraCostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
