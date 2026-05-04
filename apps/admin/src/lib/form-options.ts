export const getCountryOptions = (t: (key: any) => string) => [
  { value: "US", label: t("option.country.us") },
  { value: "CA", label: t("option.country.ca") },
  { value: "VN", label: t("option.country.vn") },
  { value: "AU", label: t("option.country.au") },
  { value: "GB", label: t("option.country.gb") },
  { value: "FR", label: t("option.country.fr") },
  { value: "DE", label: t("option.country.de") },
  { value: "IT", label: t("option.country.it") },
  { value: "ES", label: t("option.country.es") },
  { value: "NL", label: t("option.country.nl") },
  { value: "JP", label: t("option.country.jp") },
  { value: "KR", label: t("option.country.kr") },
  { value: "SG", label: t("option.country.sg") },
  { value: "TH", label: t("option.country.th") },
  { value: "PH", label: t("option.country.ph") },
  { value: "MY", label: t("option.country.my") },
  { value: "MX", label: t("option.country.mx") },
  { value: "BR", label: t("option.country.br") },
  { value: "IN", label: t("option.country.in") },
  { value: "AE", label: t("option.country.ae") }
];

export const getTimezoneOptions = (t: (key: any) => string) => [
  { value: "America/New_York", label: t("option.timezone.newYork") },
  { value: "America/Chicago", label: t("option.timezone.chicago") },
  { value: "America/Denver", label: t("option.timezone.denver") },
  { value: "America/Phoenix", label: t("option.timezone.phoenix") },
  { value: "America/Los_Angeles", label: t("option.timezone.losAngeles") },
  { value: "America/Anchorage", label: t("option.timezone.anchorage") },
  { value: "Pacific/Honolulu", label: t("option.timezone.honolulu") },
  { value: "America/Toronto", label: t("option.timezone.toronto") },
  { value: "America/Vancouver", label: t("option.timezone.vancouver") },
  { value: "Asia/Ho_Chi_Minh", label: t("option.timezone.hoChiMinh") },
  { value: "Europe/London", label: t("option.timezone.london") },
  { value: "Europe/Paris", label: t("option.timezone.paris") },
  { value: "Asia/Singapore", label: t("option.timezone.singapore") },
  { value: "Asia/Tokyo", label: t("option.timezone.tokyo") },
  { value: "Australia/Sydney", label: t("option.timezone.sydney") }
];

export const getLocalePreferenceOptions = (t: (key: any) => string) => [
  { value: "vi-VN", label: t("option.locale.viVN") },
  { value: "en-US", label: t("option.locale.enUS") }
];

export const getCurrencyOptions = (t: (key: any) => string) => [
  { value: "USD", label: t("option.currency.usd") },
  { value: "CAD", label: t("option.currency.cad") },
  { value: "VND", label: t("option.currency.vnd") }
];
