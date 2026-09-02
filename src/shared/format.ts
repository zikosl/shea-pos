export const money = (value: number) =>
  `${Number(value || 0).toLocaleString(document.documentElement.lang === "ar" ? "ar-DZ" : "en-DZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DZD`;
