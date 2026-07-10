const isLegacyUnknown = (value: string | null | undefined) => value?.trim().toLowerCase() === "unknown";

export const formatCustomerName = (
  firstName: string | null | undefined,
  lastName: string | null | undefined
) =>
  [firstName, isLegacyUnknown(lastName) ? "" : lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
