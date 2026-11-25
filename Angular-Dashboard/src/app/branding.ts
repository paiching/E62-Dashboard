export interface BrandTitles {
  title: string;
  subtitle: string;
}

// Keep defaults and lengths in sync with electron/database.cjs.
export const DEFAULT_BRAND_TITLES: BrandTitles = {
  title: "Edge Dashboard",
  subtitle: "C62 溫度感應器監控系統",
};
export const BRAND_TITLE_MAX_LENGTH = 30;
export const BRAND_SUBTITLE_MAX_LENGTH = 40;
export const LOGO_FILE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_FILE_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_MAX_PIXELS = 320;

/** A blank subtitle is a valid choice; a blank title is not. */
export function parseBrandTitles(value: unknown): BrandTitles {
  const source = (value ?? {}) as Partial<Record<keyof BrandTitles, unknown>>;
  const text = (key: keyof BrandTitles) =>
    typeof source[key] === "string"
      ? (source[key] as string).trim()
      : DEFAULT_BRAND_TITLES[key];
  return {
    title: text("title") || DEFAULT_BRAND_TITLES.title,
    subtitle: text("subtitle"),
  };
}

/** Empty string means the built-in C62 badge. */
export function parseLogo(value: unknown): string {
  return typeof value === "string" && value.startsWith("data:image/png;base64,")
    ? value
    : "";
}

/** Shrinks the picked image so the stored logo stays small. */
export async function readLogoFile(file: File): Promise<string> {
  if (!LOGO_FILE_TYPES.includes(file.type))
    throw new Error("Logo 僅支援 PNG、JPG、WebP 圖檔");
  if (file.size > LOGO_FILE_MAX_BYTES)
    throw new Error("Logo 圖檔不可超過 5 MB");
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error("無法讀取此圖檔，請改用其他圖片");
  }
  try {
    const scale = Math.min(
      1,
      LOGO_MAX_PIXELS / Math.max(image.width, image.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法處理此圖檔，請改用其他圖片");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    image.close();
  }
}
