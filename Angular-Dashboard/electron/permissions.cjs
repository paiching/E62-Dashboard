// Every grantable thing in the app: menu > tab > card > action. The Angular
// role editor reads the same file, so a new card only has to be added there.
const CATALOG = require("./permission-catalog.json");

const ADMINISTRATOR = "administrator";
const flatten = (nodes) =>
  nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
const NODES = flatten(CATALOG);
const ALL_CODES = NODES.map((node) => node.code);
const KNOWN = new Set(ALL_CODES);
/** Menus, tabs and dialogs that only exist to hold cards and actions. */
const isContainer = (node) => node.type !== "card" && Boolean(node.children);

/**
 * Makes a selection consistent: an action brings its card along, and a
 * container is granted exactly when something inside it is.
 * Keep in sync with src/app/permissions.ts.
 */
function normalizePermissions(codes) {
  if (
    !Array.isArray(codes) ||
    !codes.every((code) => typeof code === "string" && KNOWN.has(code))
  )
    throw new Error("包含未知的權限項目");
  const selected = new Set(codes);
  const result = [];
  const visit = (node) => {
    const at = result.length;
    const inside = (node.children ?? []).map(visit).some(Boolean);
    const granted = inside || (!isContainer(node) && selected.has(node.code));
    if (granted) result.splice(at, 0, node.code);
    return granted;
  };
  CATALOG.forEach(visit);
  return result;
}

/** A stored grant only counts while everything above it is granted too. */
function effectivePermissions(codes) {
  const stored = new Set(codes);
  const result = [];
  const visit = (node) => {
    if (!stored.has(node.code)) return;
    result.push(node.code);
    node.children?.forEach(visit);
  };
  CATALOG.forEach(visit);
  return result;
}

function defaultPermissions(roleCode) {
  if (roleCode === ADMINISTRATOR) return [...ALL_CODES];
  return normalizePermissions(
    NODES.filter((node) => node.roles?.includes(roleCode)).map(
      (node) => node.code,
    ),
  );
}

// A list means any one of them is enough.
const SETTING_PERMISSIONS = {
  "data.mode": "settings.data.data-mode.edit",
  "api.poll_interval_ms": "settings.data.poll-interval.edit",
  "api.data_url": "settings.data.api-url.edit",
  "api.auth_token": "settings.data.api-token.edit",
  "report.retention_days": "settings.data.retention.edit",
  "dashboard.show_status": "settings.alarm.status-bar.edit",
  "alarms.default_limits": "settings.alarm.default-limits.edit",
  "alarms.type_default_limits": "settings.alarm.default-limits.edit",
  "alarms.release_reasons": "settings.alarm.release-reasons.edit",
  "alarms.sound_enabled": "settings.alarm.alarm-sound.edit",
  "alarms.sound_interval_seconds": "settings.alarm.alarm-sound.edit",
  "notifications.enabled": "settings.notification.desktop-notification.edit",
  "notifications.snapshot_stale_enabled":
    "settings.notification.snapshot-reminder.edit",
  "notifications.line": "settings.notification.line.edit",
  "ui.font_sizes": "settings.theme.font-size.edit",
  "ui.titles": "settings.theme.titles.edit",
  "ui.logo": "settings.theme.login-logo.edit",
  "ui.sidebar_logo": "settings.theme.sidebar-logo.edit",
  "ui.logo_size": "settings.theme.sidebar-logo.edit",
  // Replacing the login logo may also have to restyle the sidebar copy of it.
  "ui.logo_style": [
    "settings.theme.sidebar-logo.edit",
    "settings.theme.login-logo.edit",
  ],
  "ui.login_background": "settings.theme.login-background.edit",
  "ui.card_size": "settings.theme.card-size.edit",
  "ui.card_layouts": "settings.layout",
};
/** Settings without a card of their own go with arranging the settings page. */
const settingPermission = (key) =>
  Object.hasOwn(SETTING_PERMISSIONS, key)
    ? SETTING_PERMISSIONS[key]
    : "settings.layout";

module.exports = {
  ADMINISTRATOR,
  ALL_CODES,
  CATALOG,
  NODES,
  SETTING_PERMISSIONS,
  defaultPermissions,
  effectivePermissions,
  normalizePermissions,
  settingPermission,
};
