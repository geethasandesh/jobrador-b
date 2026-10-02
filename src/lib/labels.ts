import type { LanguageRequirement } from "../types.js";

export function salaryLabel(
  min?: number,
  max?: number,
  period?: "hour" | "month",
): string | null {
  if (min == null && max == null) return null;
  const unit = period === "month" ? "month" : "hour";
  const low = min ?? max;
  const high = max ?? min;
  if (low == null || high == null) return null;
  const money = (value: number) =>
    Number.isInteger(value) ? `€${value}` : `€${value.toFixed(2)}`;
  if (low === high) return `${money(low)}/${unit}`;
  return `${money(low)}–${money(high)}/${unit}`;
}

export function hoursLabel(min?: number, max?: number): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null && min !== max) {
    return `${min}–${max} hours/week`;
  }
  const value = min ?? max;
  return value == null ? null : `${value} hours/week`;
}

export function languageLabel(language?: LanguageRequirement): string | null {
  if (!language) return null;
  const parts: string[] = [];
  if (language.german) {
    const level =
      language.german === "basic"
        ? "Basic"
        : language.german === "required"
          ? "Required"
          : "Fluent";
    parts.push(`German — ${level}`);
  }
  if (language.english) {
    parts.push(
      language.english === "required" ? "English — Required" : "English — Helpful",
    );
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function matchesLanguage(
  language: LanguageRequirement | undefined,
  filter: "english_friendly" | "german_required" | "german_basic" | "unknown",
): boolean {
  if (filter === "unknown") return !language || (!language.german && !language.english);
  if (!language) return false;
  if (filter === "english_friendly") return language.english != null;
  if (filter === "german_required") {
    return language.german === "required" || language.german === "fluent";
  }
  return language.german === "basic";
}

export function matchesSalary(
  min: number | undefined,
  max: number | undefined,
  filter: "under_13" | "13_15" | "15_20" | "20_plus",
): boolean {
  const value = min ?? max;
  if (value == null) return false;
  if (filter === "under_13") return value < 13;
  if (filter === "13_15") return value >= 13 && value < 15;
  if (filter === "15_20") return value >= 15 && value < 20;
  return value >= 20;
}
