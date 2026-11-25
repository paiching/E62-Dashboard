import catalog from "../../electron/permission-catalog.json";
import type { AccountRole } from "./database.service";

export interface PermissionNode {
  code: string;
  label: string;
  type: "menu" | "dialog" | "tab" | "card" | "action";
  icon?: string;
  note?: string;
  /** Built-in roles that hold it from the start. */
  roles?: string[];
  children?: PermissionNode[];
}
export type CheckState = "all" | "some" | "none";

export const ADMINISTRATOR_ROLE = "administrator";
export const PERMISSION_CATALOG = catalog as PermissionNode[];
export const PERMISSION_KINDS: Record<PermissionNode["type"], string> = {
  menu: "選單",
  dialog: "視窗",
  tab: "分頁",
  card: "卡片",
  action: "操作",
};

export function flattenPermissions(nodes: PermissionNode[]): PermissionNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenPermissions(node.children ?? []),
  ]);
}
/** Menus, tabs and dialogs that only exist to hold cards and actions. */
export function isContainer(node: PermissionNode): boolean {
  return node.type !== "card" && Boolean(node.children);
}
/** What can be ticked on its own: everything except containers. */
export function selectablePermissions(node: PermissionNode): PermissionNode[] {
  return flattenPermissions([node]).filter((item) => !isContainer(item));
}
export const SELECTABLE_COUNT = PERMISSION_CATALOG.reduce(
  (count, node) => count + selectablePermissions(node).length,
  0,
);

/**
 * An action brings its card along, and a container is granted exactly when
 * something inside it is. Keep in sync with electron/permissions.cjs.
 */
export function normalizePermissions(codes: Iterable<string>): string[] {
  const selected = new Set(codes);
  const result: string[] = [];
  const visit = (node: PermissionNode): boolean => {
    const at = result.length;
    const inside = (node.children ?? []).map(visit).some(Boolean);
    const granted = inside || (!isContainer(node) && selected.has(node.code));
    if (granted) result.splice(at, 0, node.code);
    return granted;
  };
  PERMISSION_CATALOG.forEach(visit);
  return result;
}

export function checkState(
  granted: ReadonlySet<string>,
  node: PermissionNode,
): CheckState {
  if (!isContainer(node)) return granted.has(node.code) ? "all" : "none";
  const items = selectablePermissions(node);
  const count = items.filter((item) => granted.has(item.code)).length;
  if (!count) return "none";
  return count === items.length ? "all" : "some";
}

/** Ticks or clears a node; clearing a card also clears its actions. */
export function setPermission(
  granted: Iterable<string>,
  node: PermissionNode,
  on: boolean,
): string[] {
  const next = new Set(granted);
  if (on)
    (isContainer(node) ? selectablePermissions(node) : [node]).forEach((item) =>
      next.add(item.code),
    );
  else flattenPermissions([node]).forEach((item) => next.delete(item.code));
  return normalizePermissions(next);
}

/** Sees every tab and card of a node but can change nothing. */
export function setViewOnly(
  granted: Iterable<string>,
  node: PermissionNode,
): string[] {
  const next = new Set(setPermission(granted, node, false));
  selectablePermissions(node)
    .filter((item) => item.type !== "action")
    .forEach((item) => next.add(item.code));
  return normalizePermissions(next);
}

export function roleFromPermissions(
  role: Omit<AccountRole, "permissions">,
  codes: Iterable<string>,
): AccountRole {
  const granted = new Set(normalizePermissions(codes));
  return {
    ...role,
    permissions: flattenPermissions(PERMISSION_CATALOG)
      .filter((node) => granted.has(node.code))
      .map(({ code, label }) => ({ code, label })),
  };
}

/** Browser preview only; the desktop app reads roles from SQLite. */
export function builtInRoles(): AccountRole[] {
  const nodes = flattenPermissions(PERMISSION_CATALOG);
  return (
    [
      [ADMINISTRATOR_ROLE, "Administrator", "完整系統管理權限"],
      ["operator", "Operator", "監控、報表及警報操作"],
      ["guest", "Guest", "唯讀監控與報表"],
    ] as const
  ).map(([code, displayName, description]) =>
    roleFromPermissions(
      { code, displayName, description, isSystem: true, userCount: 1 },
      nodes
        .filter(
          (node) =>
            code === ADMINISTRATOR_ROLE || node.roles?.includes(code),
        )
        .map((node) => node.code),
    ),
  );
}

/** Granted / total per top-level entry, for the account dialog. */
export function permissionSummary(
  role: AccountRole | undefined,
): Array<{ label: string; granted: number; total: number }> {
  const granted = new Set(role?.permissions.map((item) => item.code));
  return PERMISSION_CATALOG.map((node) => {
    const items = selectablePermissions(node);
    return {
      label: node.label,
      granted: items.filter((item) => granted.has(item.code)).length,
      total: items.length,
    };
  }).filter((item) => item.granted);
}
