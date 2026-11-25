export interface BrandTitles {
  title: string;
  subtitle: string;
}

// Keep defaults and lengths in sync with electron/database.cjs.
export const DEFAULT_BRAND_TITLES: BrandTitles = {
  title: "EdgeBox",
  subtitle: "感應器監控系統",
};
/** Relative so it also resolves under Electron's file:// URL. */
export const DEFAULT_LOGO_URL = "images/edgebox-logo.png";
export const BRAND_TITLE_MAX_LENGTH = 30;
export const BRAND_SUBTITLE_MAX_LENGTH = 40;
export const IMAGE_FILE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** How the logo is drawn on the dark sidebar; the login card is unaffected. */
export type LogoStyle = "inverse" | "original" | "light";
// Keep the keys in sync with LOGO_STYLES in electron/database.cjs.
export const LOGO_STYLES: ReadonlyArray<{ key: LogoStyle; label: string }> = [
  { key: "inverse", label: "暗色版（反白、無底色）" },
  { key: "original", label: "原色（無底色）" },
  { key: "light", label: "原色（白底）" },
];
export const DEFAULT_LOGO_STYLE: LogoStyle = "inverse";
export function parseLogoStyle(value: unknown): LogoStyle {
  return (
    LOGO_STYLES.find(({ key }) => key === value)?.key ?? DEFAULT_LOGO_STYLE
  );
}

export type LogoSize = "standard" | "large" | "xlarge";
// Keep the keys in sync with LOGO_SIZES in electron/database.cjs.
export const LOGO_SIZES: ReadonlyArray<{ key: LogoSize; label: string }> = [
  { key: "standard", label: "標準" },
  { key: "large", label: "大" },
  { key: "xlarge", label: "特大" },
];
export const DEFAULT_LOGO_SIZE: LogoSize = "standard";
export function parseLogoSize(value: unknown): LogoSize {
  return LOGO_SIZES.find(({ key }) => key === value)?.key ?? DEFAULT_LOGO_SIZE;
}

/** An empty sidebar logo follows the login logo. */
export type BrandImageKey = "logo" | "sidebar" | "background";
export interface BrandImage {
  /** Data URL; an empty string means the built-in image. */
  url: string;
  saving: boolean;
  message: string;
  failed: boolean;
}
// Keep types and lengths in sync with IMAGE_SETTINGS in electron/database.cjs.
export const BRAND_IMAGES = {
  logo: {
    setting: "ui.logo",
    label: "Logo ",
    mime: "image/png",
    maxFileMb: 5,
    maxPixels: 320,
    maxLength: 1_000_000,
  },
  sidebar: {
    setting: "ui.sidebar_logo",
    label: "Logo ",
    mime: "image/png",
    maxFileMb: 5,
    maxPixels: 320,
    maxLength: 1_000_000,
  },
  background: {
    setting: "ui.login_background",
    label: "背景圖",
    mime: "image/jpeg",
    maxFileMb: 20,
    maxPixels: 1920,
    maxLength: 2_000_000,
  },
} as const;
export const emptyBrandImage = (): BrandImage => ({
  url: "",
  saving: false,
  message: "",
  failed: false,
});

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

export function parseBrandImage(key: BrandImageKey, value: unknown): string {
  const prefix = `data:${BRAND_IMAGES[key].mime};base64,`;
  return typeof value === "string" && value.startsWith(prefix) ? value : "";
}

/** Shrinks the picked image so the stored copy stays small. */
export async function readBrandImage(
  key: BrandImageKey,
  file: File,
): Promise<{ url: string; opaque: boolean }> {
  const { label, mime, maxFileMb, maxPixels, maxLength } = BRAND_IMAGES[key];
  if (!IMAGE_FILE_TYPES.includes(file.type))
    throw new Error(`${label}僅支援 PNG、JPG、WebP 圖檔`);
  if (file.size > maxFileMb * 1024 * 1024)
    throw new Error(`${label}圖檔不可超過 ${maxFileMb} MB`);
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error("無法讀取此圖檔，請改用其他圖片");
  }
  try {
    const scale = Math.min(
      1,
      maxPixels / Math.max(image.width, image.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("無法處理此圖檔，請改用其他圖片");
    if (mime === "image/jpeg") {
      // JPEG has no transparency; match the app's navy instead of black.
      context.fillStyle = "#0b1d33";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.5]) {
      const url = canvas.toDataURL(mime, quality);
      if (url.length <= maxLength)
        return { url, opaque: isOpaque(context, canvas) };
    }
    throw new Error("圖片內容過於複雜，請改用較小的圖片");
  } finally {
    image.close();
  }
}

export async function isOpaqueImage(url: string): Promise<boolean> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return false;
  context.drawImage(image, 0, 0);
  return isOpaque(context, canvas);
}

/** An image without transparency would invert to a solid white block. */
function isOpaque(
  context: CanvasRenderingContext2D,
  { width, height }: HTMLCanvasElement,
): boolean {
  const { data } = context.getImageData(0, 0, width, height);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) return false;
  return true;
}
