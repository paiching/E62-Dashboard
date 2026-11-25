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
