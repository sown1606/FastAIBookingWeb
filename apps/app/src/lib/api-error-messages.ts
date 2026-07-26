type Locale = "vi" | "en";

const vietnameseApiMessages: Record<string, string> = {
  "Requested slot is outside business hours.": "Khung giờ này nằm ngoài giờ làm việc của tiệm.",
  "Salon is closed for the selected time.": "Tiệm đóng cửa vào thời gian đã chọn.",
  "Requested slot overlaps with an existing booking.": "Khung giờ này trùng với một lịch hẹn hiện có.",
  "Staff not found or not bookable.": "Không tìm thấy nhân viên hoặc nhân viên chưa nhận đặt lịch.",
  "Selected staff is not assigned to this service.": "Nhân viên đã chọn chưa được gán dịch vụ này.",
  "Service not found or inactive.": "Không tìm thấy dịch vụ hoặc dịch vụ đang tắt.",
  "Customer not found for this salon.": "Không tìm thấy khách hàng trong tiệm này.",
  "Customer not found.": "Không tìm thấy khách hàng trong tiệm này.",
  "Appointment not found.": "Không tìm thấy lịch hẹn.",
  "Invalid login credentials.": "Email hoặc mật khẩu không đúng.",
  "Role is not allowed for this login.": "Tài khoản này không được đăng nhập bằng vai trò đã chọn.",
  "Staff access is not configured.": "Tài khoản nhân viên chưa được cấu hình quyền truy cập.",
  "Unauthorized.": "Phiên đăng nhập không hợp lệ.",
  "Forbidden.": "Bạn không có quyền thực hiện thao tác này.",
  "Registration billing is not configured yet.": "Đăng ký đang tạm khóa cho đến khi cấu hình Stripe hoàn tất.",
  "Amazon Connect phone provisioning is not configured.": "Chưa cấu hình đầy đủ Amazon Connect để tự động cấp số.",
  "A Visa card is required for the trial.": "Cần thẻ Visa để bắt đầu thời gian dùng thử.",
  "Card verification is incomplete or does not match this registration.": "Xác thực thẻ chưa hoàn tất hoặc không khớp với đăng ký này.",
  "Card verification does not match this registration.": "Xác thực thẻ không khớp với đăng ký này.",
  "Card verification has expired. Please verify the card again.": "Phiên xác thực thẻ đã hết hạn. Vui lòng xác thực lại.",
  "No Amazon Connect phone number is currently available.": "Hiện chưa có số Amazon Connect phù hợp. Vui lòng thử lại.",
  "Real Person Reception is not staffed yet.": "Gói AI + Live Operator chưa có nhân sự trực sẵn sàng.",
  "Live operator transfer requires the AI + Live Operator subscription.":
    "Chỉ gói AI + Live Operator $499 mới được bật tính năng bấm 0 gặp operator."
};

const resolveLocale = (): Locale => {
  if (typeof window === "undefined") {
    return "vi";
  }
  return window.localStorage.getItem("fastaibooking.locale") === "en" ? "en" : "vi";
};

export const localizeApiErrorMessage = (message: string, locale = resolveLocale()): string => {
  if (locale === "en") {
    return message;
  }
  return vietnameseApiMessages[message] ?? message;
};
