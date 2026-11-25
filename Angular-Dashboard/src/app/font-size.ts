export type FontSizeArea = "general" | "topbar" | "cards" | "trends";
export type FontSizes = Record<FontSizeArea, number>;

export const DEFAULT_FONT_SIZES: FontSizes = {
  general: 100,
  topbar: 100,
  cards: 100,
  trends: 100,
};

const LEVELS = [
  { percent: 100, label: "標準（100%）" },
  { percent: 115, label: "稍大（115%）" },
  { percent: 130, label: "大（130%）" },
  { percent: 150, label: "特大（150%）" },
  { percent: 175, label: "超大（175%）" },
  { percent: 200, label: "最大（200%）" },
];
const upTo = (max: number) => LEVELS.filter((level) => level.percent <= max);

// Keep the maximums in sync with FONT_SIZE_LIMITS in electron/database.cjs.
export const FONT_SIZE_AREAS: ReadonlyArray<{
  key: FontSizeArea;
  label: string;
  levels: ReadonlyArray<{ percent: number; label: string }>;
}> = [
  { key: "topbar", label: "頂部時間列", levels: upTo(200) },
  { key: "cards", label: "儀錶板卡片", levels: upTo(200) },
  { key: "trends", label: "趨勢圖", levels: upTo(150) },
  {
    key: "general",
    label: "一般介面（選單、報表、警報、設定）",
    levels: upTo(150),
  },
];

/** Falls back to 100% for any area that is missing or not a known level. */
export function parseFontSizes(value: unknown): FontSizes {
  const source = (value ?? {}) as Partial<Record<FontSizeArea, unknown>>;
  const result = { ...DEFAULT_FONT_SIZES };
  for (const area of FONT_SIZE_AREAS) {
    const percent = Number(source[area.key]);
    if (area.levels.some((level) => level.percent === percent))
      result[area.key] = percent;
  }
  return result;
}

export function applyFontSizes(sizes: FontSizes): void {
  const style = document.documentElement.style;
  for (const { key } of FONT_SIZE_AREAS)
    style.setProperty(`--font-scale-${key}`, String(sizes[key] / 100));
}
