import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPost, extractErrorMessage } from "../lib/api";
import { EmptyBlock, ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";
import { formatDateTime } from "../lib/format";
import type { Pagination } from "../types";

interface CustomerItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
}

interface CustomersResponse {
  items: CustomerItem[];
  pagination: Pagination;
}

interface CustomerHistory {
  customer: CustomerItem;
  appointments: Array<{
    id: string;
    startTime: string;
    status: string;
    staff: {
      fullName: string;
    };
    service: {
      name: string;
    };
  }>;
}

export const CustomersPage = () => {
  const { notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<CustomersResponse | null>(null);
  const [selected, setSelected] = useState<CustomerHistory | null>(null);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: ""
  });

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "50"
      });
      if (query.trim()) {
        params.set("q", query.trim());
      }
      const response = await apiGet<CustomersResponse>(`/api/v1/customers?${params.toString()}`);
      setCustomers(response);
      if (selected) {
        const history = await apiGet<CustomerHistory>(`/api/v1/customers/${selected.customer.id}/appointments`);
        setSelected(history);
      }
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [query]);

  const createCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiPost<unknown, unknown>("/api/v1/customers", {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email || undefined,
        phone: form.phone
      });
      setForm({
        firstName: "",
        lastName: "",
        email: "",
        phone: ""
      });
      notify("success", "Đã tạo khách hàng.");
      await load();
    } catch (createError) {
      notify("error", extractErrorMessage(createError));
    }
  };

  const selectCustomer = async (customerId: string) => {
    try {
      const history = await apiGet<CustomerHistory>(`/api/v1/customers/${customerId}/appointments`);
      setSelected(history);
    } catch (selectError) {
      notify("error", extractErrorMessage(selectError));
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
      <section className="card">
        <h2>Tạo khách hàng</h2>
        <form className="form-grid two-columns" onSubmit={createCustomer}>
          <label className="field">
            <span>Tên</span>
            <input
              value={form.firstName}
              onChange={(event) => setForm((prev) => ({ ...prev, firstName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Họ</span>
            <input
              value={form.lastName}
              onChange={(event) => setForm((prev) => ({ ...prev, lastName: event.target.value }))}
              required
            />
          </label>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>Số điện thoại</span>
            <input
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              required
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="button-primary">
              Thêm khách
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Khách hàng</h2>
        <label className="field compact">
          <span>Tìm kiếm</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tên, email, điện thoại"
          />
        </label>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tên</th>
                <th>Email</th>
                <th>Số điện thoại</th>
                <th>Lịch sử</th>
              </tr>
            </thead>
            <tbody>
              {customers?.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    {item.firstName} {item.lastName}
                  </td>
                  <td>{item.email ?? "-"}</td>
                  <td>{item.phone}</td>
                  <td>
                    <button type="button" className="button-secondary" onClick={() => selectCustomer(item.id)}>
                      Xem lịch sử
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Lịch sử lịch hẹn của khách</h2>
        {selected ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Dịch vụ</th>
                  <th>Nhân viên</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {selected.appointments.map((appointment) => (
                  <tr key={appointment.id}>
                    <td>{formatDateTime(appointment.startTime)}</td>
                    <td>{appointment.service.name}</td>
                    <td>{appointment.staff.fullName}</td>
                    <td>{appointment.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyBlock message="Chọn một khách để xem lịch sử lịch hẹn." />
        )}
      </section>
    </div>
  );
};
