// Keep the percentages in sync with CARD_SIZES in electron/database.cjs.
export const CARD_SIZES: ReadonlyArray<{ percent: number; label: string }> = [
  { percent: 85, label: "小（85%）" },
  { percent: 100, label: "標準（100%）" },
  { percent: 125, label: "大（125%）" },
  { percent: 150, label: "特大（150%）" },
  { percent: 200, label: "最大（200%）" },
];
export const DEFAULT_CARD_SIZE = 100;

export function parseCardSize(value: unknown): number {
  return (
    CARD_SIZES.find(({ percent }) => percent === value)?.percent ??
    DEFAULT_CARD_SIZE
  );
}

export function applyCardSize(percent: number): void {
  document.documentElement.style.setProperty(
    "--card-scale",
    String(percent / 100),
  );
}

// Keep the percentages in sync with CARD_HOVER_SCALES in electron/database.cjs.
export const CARD_HOVER_SCALES: ReadonlyArray<{
  percent: number;
  label: string;
}> = [
  { percent: 100, label: "關閉" },
  { percent: 103, label: "輕微（103%）" },
  { percent: 105, label: "標準（105%）" },
  { percent: 108, label: "明顯（108%）" },
];
export const DEFAULT_CARD_HOVER = 105;

export function parseCardHover(value: unknown): number {
  return (
    CARD_HOVER_SCALES.find(({ percent }) => percent === value)?.percent ??
    DEFAULT_CARD_HOVER
  );
}

/** Scale a dashboard card grows to under the mouse; 1 turns it off. */
export function applyCardHover(percent: number): void {
  document.documentElement.style.setProperty(
    "--card-hover-scale",
    String(percent / 100),
  );
}

export type ReadingColorKind = "normal" | "alarm";
export type ReadingColors = Record<ReadingColorKind, string>;
// Keep in sync with DEFAULT_READING_COLORS in electron/database.cjs.
export const DEFAULT_READING_COLORS: ReadingColors = {
  normal: "#148266",
  alarm: "#c43d4e",
};
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function parseReadingColors(value: unknown): ReadingColors {
  const input = (value ?? {}) as Partial<Record<ReadingColorKind, unknown>>;
  const pick = (kind: ReadingColorKind) =>
    typeof input[kind] === "string" && HEX_COLOR.test(input[kind] as string)
      ? (input[kind] as string).toLowerCase()
      : DEFAULT_READING_COLORS[kind];
  return { normal: pick("normal"), alarm: pick("alarm") };
}

/** Colors of the reading numbers on dashboard cards and the detail dialog. */
export function applyReadingColors(colors: ReadingColors): void {
  const style = document.documentElement.style;
  style.setProperty("--reading-normal", colors.normal);
  style.setProperty("--reading-alarm", colors.alarm);
}
