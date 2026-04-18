export type RoutingSummaryMode =
  | "SALON_PHONE_ONLY"
  | "AI_RECEPTION_ONLY"
  | "CALL_CENTER_ONLY"
  | "AI_RECEPTION_WITH_CALL_CENTER";

interface SalonRoutingSettings {
  aiReceptionEnabled?: boolean | null;
  aiForwardingEnabled?: boolean | null;
  aiTransferRingCount?: number | null;
  callCenterEnabled?: boolean | null;
  voicemailEnabled?: boolean | null;
  callbackRequestEnabled?: boolean | null;
  smsFallbackEnabled?: boolean | null;
  aiGreetingPrompt?: string | null;
  callerLanguage?: string | null;
  callLogVisibility?: string | null;
  notificationRecipients?: unknown;
  callCenterRoutingNumber?: string | null;
  callCenterRoutingNote?: string | null;
}

export const buildSalonRoutingSummary = (settings: SalonRoutingSettings | null | undefined) => {
  const aiReceptionEnabled =
    settings?.aiReceptionEnabled ?? settings?.aiForwardingEnabled ?? false;
  const callCenterEnabled = settings?.callCenterEnabled ?? false;
  const mode: RoutingSummaryMode =
    aiReceptionEnabled && callCenterEnabled
      ? "AI_RECEPTION_WITH_CALL_CENTER"
      : callCenterEnabled
        ? "CALL_CENTER_ONLY"
        : aiReceptionEnabled
          ? "AI_RECEPTION_ONLY"
          : "SALON_PHONE_ONLY";

  return {
    mode,
    aiReceptionEnabled,
    ringCountBeforeAi: settings?.aiTransferRingCount ?? 3,
    callCenterEnabled,
    voicemailEnabled: settings?.voicemailEnabled ?? true,
    callbackRequestEnabled: settings?.callbackRequestEnabled ?? true,
    smsFallbackEnabled: settings?.smsFallbackEnabled ?? false,
    aiGreetingPrompt: settings?.aiGreetingPrompt ?? null,
    callerLanguage: settings?.callerLanguage ?? "en",
    callLogVisibility: settings?.callLogVisibility ?? "OWNER_STAFF_OPERATOR",
    notificationRecipients: Array.isArray(settings?.notificationRecipients)
      ? settings?.notificationRecipients
      : [],
    callCenterRoutingNumber: settings?.callCenterRoutingNumber ?? null,
    callCenterRoutingNote: settings?.callCenterRoutingNote ?? null
  };
};
