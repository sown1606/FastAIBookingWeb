import { SupportedLanguage } from "./language";

const vietnameseMessagesByCode: Record<string, string> = {
  APPOINTMENT_NOT_FOUND: "Không tìm thấy lịch hẹn.",
  CUSTOMER_NOT_FOUND: "Không tìm thấy khách hàng trong tiệm này.",
  EMAIL_ALREADY_EXISTS: "Email này đã được đăng ký.",
  FORBIDDEN: "Bạn không có quyền thực hiện thao tác này.",
  INVALID_CREDENTIALS: "Email hoặc mật khẩu không đúng.",
  INVALID_CURRENT_PASSWORD: "Mật khẩu hiện tại không đúng.",
  INVALID_JSON: "Dữ liệu JSON không hợp lệ.",
  INVALID_SERVICE: "Một hoặc nhiều dịch vụ không hợp lệ cho tiệm này.",
  INVALID_SLOT: "Khung giờ hẹn không hợp lệ.",
  INVALID_STAFF: "Một hoặc nhiều nhân viên không hợp lệ cho tiệm này.",
  NOTIFICATION_NOT_FOUND: "Không tìm thấy thông báo.",
  SERVICE_NOT_FOUND: "Không tìm thấy dịch vụ.",
  SERVICE_REQUIRED: "Cần chọn ít nhất một dịch vụ.",
  SERVICE_UNAVAILABLE: "Không tìm thấy dịch vụ hoặc dịch vụ đang tắt.",
  STAFF_NOT_FOUND: "Không tìm thấy nhân viên.",
  STAFF_NOT_MAPPED: "Nhân viên đã chọn chưa được gán dịch vụ này.",
  STAFF_PROFILE_NOT_FOUND: "Không tìm thấy hồ sơ nhân viên.",
  STAFF_UNAVAILABLE: "Không tìm thấy nhân viên hoặc nhân viên chưa nhận đặt lịch.",
  UNAUTHORIZED: "Phiên đăng nhập không hợp lệ.",
  VALIDATION_ERROR: "Dữ liệu gửi lên không hợp lệ."
};

const vietnameseMessagesByText: Record<string, string> = {
  "Requested slot is outside business hours.": "Khung giờ này nằm ngoài giờ làm việc của tiệm.",
  "Salon is closed for the selected time.": "Tiệm đóng cửa vào thời gian đã chọn.",
  "Requested slot overlaps with an existing booking.": "Khung giờ này trùng với một lịch hẹn hiện có.",
  "Selected staff is not assigned to this service.": "Nhân viên đã chọn chưa được gán dịch vụ này.",
  "Staff not found or not bookable.": "Không tìm thấy nhân viên hoặc nhân viên chưa nhận đặt lịch.",
  "Service not found or inactive.": "Không tìm thấy dịch vụ hoặc dịch vụ đang tắt.",
  "Customer not found for this salon.": "Không tìm thấy khách hàng trong tiệm này.",
  "Push notifications are not supported for this role.":
    "Vai trò này không hỗ trợ thông báo đẩy."
};

export const localizeApiErrorMessage = (
  message: string,
  code: string,
  language: SupportedLanguage
): string => {
  if (language === "en-US") {
    return message;
  }

  return vietnameseMessagesByCode[code] ?? vietnameseMessagesByText[message] ?? message;
};
