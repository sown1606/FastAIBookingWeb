import { RegistrationLeadStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { SupportedLanguage } from "../../utils/language";
import { requireUsPhone } from "../../utils/phone";
import { VertexAIProvider } from "../ai/providers/vertex-ai.provider";

interface RegistrationAssistantMessage {
  role: "assistant" | "user";
  text: string;
}

type SuggestedAction = "CALLBACK" | "REGISTER" | "PAYMENT" | "NONE";

const onboardingProvider = new VertexAIProvider();

export const createRegistrationLead = async (input: {
  phone: string;
  fullName?: string;
  email?: string;
  note?: string;
}) => {
  return prisma.registrationLead.create({
    data: {
      phone: requireUsPhone(input.phone, "Callback phone"),
      fullName: input.fullName?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      note: input.note?.trim() || null,
      source: "WEB_CALLBACK",
      status: RegistrationLeadStatus.NEW
    }
  });
};

const guidedRegistrationReply = (
  message: string,
  language: SupportedLanguage
): { message: string; suggestedAction: SuggestedAction; source: "guided" } => {
  const normalized = message.trim().toLowerCase();
  const isVietnamese = language === "vi-VN";

  if (/call|phone|gọi|điện thoại|callback|liên hệ/.test(normalized)) {
    return {
      message: isVietnamese
        ? "Bạn chỉ cần để lại số điện thoại. Admin sẽ thấy yêu cầu và gọi lại hỗ trợ đăng ký."
        : "Leave your phone number and an admin will see the request and call you back to help.",
      suggestedAction: "CALLBACK",
      source: "guided"
    };
  }
  if (/card|visa|stripe|payment|credit|thẻ|thanh toán|tín dụng/.test(normalized)) {
    return {
      message: isVietnamese
        ? "Thẻ Visa là tùy chọn lúc đăng ký. Bạn có thể tạo tài khoản trước và bổ sung thẻ an toàn trong trang Chi phí sau."
        : "A Visa card is optional during signup. You can create the account first and add it securely from Billing later.",
      suggestedAction: "PAYMENT",
      source: "guided"
    };
  }
  if (/register|signup|form|account|đăng ký|tài khoản|biểu mẫu/.test(normalized)) {
    return {
      message: isVietnamese
        ? "Mình có thể hướng dẫn từng bước. Chọn form đăng ký, điền thông tin chủ tiệm và salon, chọn gói, rồi tạo tài khoản có hoặc không có thẻ."
        : "I can guide you step by step. Open the signup form, enter owner and salon details, choose a plan, then create the account with or without a card.",
      suggestedAction: "REGISTER",
      source: "guided"
    };
  }

  return {
    message: isVietnamese
      ? "Mình có thể giải thích hai cách đăng ký, việc thêm thẻ tùy chọn, hoặc hướng dẫn điền form. Không gửi mật khẩu hay thông tin thẻ trong khung chat."
      : "I can explain both signup options, optional card setup, or guide you through the form. Do not send passwords or card details in chat.",
    suggestedAction: "NONE",
    source: "guided"
  };
};

const parseAssistantJson = (
  responseText: string
): { message: string; suggestedAction: SuggestedAction } | null => {
  try {
    const parsed = JSON.parse(responseText) as {
      message?: unknown;
      suggestedAction?: unknown;
    };
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    const suggestedAction = ["CALLBACK", "REGISTER", "PAYMENT", "NONE"].includes(
      String(parsed.suggestedAction)
    )
      ? (parsed.suggestedAction as SuggestedAction)
      : "NONE";
    return message ? { message: message.slice(0, 800), suggestedAction } : null;
  } catch {
    return null;
  }
};

export const getRegistrationAssistantReply = async (input: {
  language: SupportedLanguage;
  messages: RegistrationAssistantMessage[];
}) => {
  const latestUserMessage = [...input.messages]
    .reverse()
    .find((message) => message.role === "user")?.text ?? "";
  const fallback = guidedRegistrationReply(latestUserMessage, input.language);

  if (!onboardingProvider.isConfigured()) {
    return fallback;
  }

  const conversation = input.messages
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}: ${message.text.slice(0, 800)}`)
    .join("\n");
  const languageName = input.language === "vi-VN" ? "Vietnamese" : "English";
  const prompt = [
    "Return one JSON object with exactly these keys: message and suggestedAction.",
    `Reply in ${languageName} as the FastAIBooking signup assistant.`,
    "Only help with: choosing callback versus full signup, owner/salon form fields, plans, optional Stripe card setup, and what happens next.",
    "Never ask for or repeat passwords, full card numbers, CVC, secrets, or authentication tokens.",
    "Do not claim an account, payment, phone number, or call flow is active. Do not perform actions.",
    "suggestedAction must be CALLBACK, REGISTER, PAYMENT, or NONE.",
    "Keep message under 120 words.",
    "Conversation follows between delimiters.",
    "---",
    conversation,
    "---"
  ].join("\n");

  try {
    const response = await onboardingProvider.parse({
      taskType: "registration_assistant",
      prompt
    });
    const parsed = parseAssistantJson(response.responseText);
    return parsed ? { ...parsed, source: "ai" as const } : fallback;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Registration assistant AI unavailable; using guided fallback."
    );
    return fallback;
  }
};
