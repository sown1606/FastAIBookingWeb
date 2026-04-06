import { useEffect, useState } from "react";
import { apiGet, apiPut, extractErrorMessage } from "../lib/api";
import { ErrorBlock, LoadingBlock } from "../components/states";
import { useToast } from "../components/toast";

interface BusinessHour {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
}

const weekdays = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

const defaultHours = (): BusinessHour[] => [
  { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
  { dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 2, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 3, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 4, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 5, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 6, isOpen: true, openTime: "09:00", closeTime: "16:00" }
];

export const BusinessHoursPage = () => {
  const { notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hours, setHours] = useState<BusinessHour[]>(defaultHours());

  const load = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await apiGet<BusinessHour[]>("/api/v1/business-hours");
      setHours(response.length === 7 ? [...response].sort((a, b) => a.dayOfWeek - b.dayOfWeek) : defaultHours());
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    try {
      await apiPut<BusinessHour[], { hours: BusinessHour[] }>("/api/v1/business-hours", {
        hours
      });
      notify("success", "Đã cập nhật giờ làm việc.");
      await load();
    } catch (saveError) {
      notify("error", extractErrorMessage(saveError));
    }
  };

  if (loading) {
    return <LoadingBlock />;
  }

  if (error) {
    return <ErrorBlock message={error} onRetry={load} />;
  }

  return (
    <section className="card">
      <div className="section-header">
        <h2>Giờ làm việc</h2>
        <button type="button" className="button-primary" onClick={save}>
          Lưu giờ
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Mở cửa</th>
              <th>Giờ mở</th>
              <th>Giờ đóng</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((item, index) => (
              <tr key={item.dayOfWeek}>
                <td>{weekdays[item.dayOfWeek]}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={item.isOpen}
                    onChange={(event) =>
                      setHours((prev) =>
                        prev.map((row, rowIndex) =>
                          rowIndex === index
                            ? {
                                ...row,
                                isOpen: event.target.checked,
                                openTime: event.target.checked ? row.openTime ?? "09:00" : null,
                                closeTime: event.target.checked ? row.closeTime ?? "18:00" : null
                              }
                            : row
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    type="time"
                    value={item.openTime ?? ""}
                    disabled={!item.isOpen}
                    onChange={(event) =>
                      setHours((prev) =>
                        prev.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, openTime: event.target.value } : row
                        )
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    type="time"
                    value={item.closeTime ?? ""}
                    disabled={!item.isOpen}
                    onChange={(event) =>
                      setHours((prev) =>
                        prev.map((row, rowIndex) =>
                          rowIndex === index ? { ...row, closeTime: event.target.value } : row
                        )
                      )
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
