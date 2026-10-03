import type { Category, JobType, LanguageRequirement } from "../types.js";
import { clip } from "./model.js";

const CATEGORIES: Array<{ category: Category; pattern: RegExp }> = [
  { category: "cafe", pattern: /café|cafe|coffee|bäckerei|baeckerei|konditorei/i },
  { category: "restaurant", pattern: /restaurant|gastro|küche|kueche|servicekraft|kellner|koch|imbiss|bar\b|hotelküche/i },
  { category: "hotel", pattern: /hotel|housekeeping|rezeption/i },
  { category: "retail", pattern: /verkauf|einzelhandel|kasse|supermarket|laden|shop/i },
  { category: "warehouse", pattern: /lager|warehouse|kommissionier/i },
  { category: "logistics", pattern: /logistik|fahrer|lieferung|kurier/i },
  { category: "cleaning", pattern: /reinigung|putz/i },
  { category: "delivery", pattern: /lieferung|delivery|fahrer/i },
  { category: "office", pattern: /büro|buero|office|verwaltung|sachbearbeit/i },
  { category: "customer_service", pattern: /kundenservice|call ?center|empfang/i },
  { category: "event", pattern: /event|messe|veranstaltung/i },
];

export function categoryFrom(text: string): Category {
  for (const item of CATEGORIES) {
    if (item.pattern.test(text)) return item.category;
  }
  return "other";
}

export function jobTypeFrom(
  text: string,
  hints: { minijob?: boolean; partTime?: boolean; internship?: boolean } = {},
): JobType {
  if (hints.internship || /praktikum|internship|trainee/i.test(text)) return "INTERNSHIP";
  if (/werkstudent/i.test(text)) return "WERKSTUDENT";
  if (hints.minijob || /minijob|geringfügig|geringfuegig|538|556|603/i.test(text)) return "MINIJOB";
  if (hints.partTime || /teilzeit|part[- ]time|aushilfe/i.test(text)) return "TEILZEIT";
  if (/befristet|saisonal|temporary/i.test(text)) return "TEMPORARY";
  if (/student/i.test(text)) return "STUDENT";
  return "OTHER";
}

export function languageFrom(text: string): LanguageRequirement | undefined {
  const language: LanguageRequirement = {};
  if (/deutsch[^.]{0,40}(erforderlich|fließend|fliessend|verhandlungssicher|muttersprach)/i.test(text)) {
    language.german = "required";
  } else if (/deutsch[^.]{0,30}grundkenntnisse|basic german/i.test(text)) {
    language.german = "basic";
  }
  if (/englisch[^.]{0,40}(erforderlich|fließend|fliessend|verhandlungssicher)/i.test(text)) {
    language.english = "required";
  } else if (/englisch[^.]{0,40}(vorteil|wünschenswert|wuenschenswert|von vorteil|nicht erforderlich)/i.test(text)) {
    language.english = "helpful";
  }
  return language.german || language.english ? language : undefined;
}

export function hoursFrom(text: string): { hoursMin?: number; hoursMax?: number } {
  const range = text.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:Std\.?|Stunden)\s*(?:\/|pro)?\s*(?:Wo|Woche)/i);
  if (range?.[1] && range[2]) {
    return { hoursMin: Number(range[1]), hoursMax: Number(range[2]) };
  }
  const single = text.match(/(\d{1,2})\s*(?:Std\.?|Stunden)\s*(?:\/|pro)?\s*(?:Wo|Woche)/i);
  if (single?.[1]) return { hoursMin: Number(single[1]), hoursMax: Number(single[1]) };
  return {};
}

export function moneyFrom(text: string): {
  salaryMin?: number;
  salaryMax?: number;
  salaryPeriod?: "hour" | "month";
} {
  const labeled = text.match(/stundenlohn\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:€|eur)/i);
  const hour = text.match(
    /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:€|eur)\s*(?:\/|pro)?\s*(?:Std\.?|Stunde)\b/i,
  );
  const hourValue = labeled?.[1] ?? hour?.[1];
  if (hourValue) {
    const value = Number(hourValue.replace(",", "."));
    if (value >= 8 && value <= 40) return { salaryMin: value, salaryMax: value, salaryPeriod: "hour" };
  }
  const month = text.match(/(\d{3,4}(?:[.,]\d{1,2})?)\s*(?:€|eur)\s*(?:\/|pro)?\s*(?:Monat|mtl)/i);
  if (month?.[1]) {
    const value = Number(month[1].replace(",", "."));
    if (value >= 200 && value <= 6000) return { salaryMin: value, salaryMax: value, salaryPeriod: "month" };
  }
  return {};
}

export function summaryFrom(text: string) {
  return clip(text, 320);
}
