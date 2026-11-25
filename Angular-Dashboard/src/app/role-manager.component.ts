import { CommonModule } from "@angular/common";
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatIconModule } from "@angular/material/icon";
import { AccountRole, DatabaseService, RoleInput } from "./database.service";
import { UserSession } from "./dashboard.model";
import { MaterialSvgIconDirective } from "./material-icons";
import {
  ADMINISTRATOR_ROLE,
  PERMISSION_CATALOG,
  PERMISSION_KINDS,
  PermissionNode,
  SELECTABLE_COUNT,
  checkState,
  isContainer,
  roleFromPermissions,
  selectablePermissions,
  setPermission,
  setViewOnly,
} from "./permissions";

interface RoleDraft {
  /** Undefined while the role has not been saved yet. */
  code?: string;
  displayName: string;
  description: string;
}

/** The 角色 tab: role list on the left, its permission tree on the right. */
@Component({
  selector: "app-role-manager",
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MaterialSvgIconDirective],
  templateUrl: "./role-manager.component.html",
})
export class RoleManagerComponent implements OnChanges {
  @Input({ required: true }) session!: UserSession;
  @Input({ required: true }) roles: AccountRole[] = [];
  @Output() readonly rolesChange = new EventEmitter<AccountRole[]>();

  readonly catalog = PERMISSION_CATALOG;
  readonly kinds = PERMISSION_KINDS;
  readonly total = SELECTABLE_COUNT;
  readonly isContainer = isContainer;
  draft: RoleDraft | null = null;
  granted: ReadonlySet<string> = new Set();
  expanded: ReadonlySet<string> = new Set([PERMISSION_CATALOG[0].code]);
  deleting = false;
  saving = false;
  message = "";
  failed = false;
  private saved = "";

  constructor(private readonly db: DatabaseService) {}

  ngOnChanges(): void {
    // Keep what is being edited when the list is reloaded underneath it.
    if (this.dirty || this.saving) return;
    const current =
      this.roles.find((role) => role.code === this.draft?.code) ??
      this.roles[0];
    if (current) this.load(current);
    else this.draft = null;
  }

  can(code: string): boolean {
    return this.session.permissions.includes(code);
  }
  get dirty(): boolean {
    return Boolean(this.draft) && this.snapshot() !== this.saved;
  }
  get readOnlyReason(): string {
    const code = this.draft?.code;
    if (code === ADMINISTRATOR_ROLE)
      return "Administrator 固定擁有全部權限，不可修改。";
    if (code && code === this.session.roleCode)
      return "不可修改目前登入帳號所屬的角色。";
    if (code && !this.can("users.roles.edit"))
      return "目前帳號沒有編輯角色的權限，僅供檢視。";
    return "";
  }
  get editable(): boolean {
    return Boolean(this.draft) && !this.readOnlyReason && !this.saving;
  }
  get selected(): AccountRole | undefined {
    return this.roles.find((role) => role.code === this.draft?.code);
  }
  get canDelete(): boolean {
    return (
      this.can("users.roles.delete") &&
      Boolean(this.selected && !this.selected.isSystem) &&
      this.selected?.code !== this.session.roleCode
    );
  }
  get allExpanded(): boolean {
    return this.expanded.size === this.catalog.length;
  }

  count(node: PermissionNode): number {
    return selectablePermissions(node).filter((item) =>
      this.granted.has(item.code),
    ).length;
  }
  size(node: PermissionNode): number {
    return selectablePermissions(node).length;
  }
  roleCount(role: AccountRole): number {
    const granted = new Set(role.permissions.map((item) => item.code));
    return this.catalog
      .flatMap(selectablePermissions)
      .filter((item) => granted.has(item.code)).length;
  }
  get draftCount(): number {
    return this.catalog.reduce((sum, node) => sum + this.count(node), 0);
  }
  state(node: PermissionNode) {
    return checkState(this.granted, node);
  }
  /** Cards and stand-alone items of a node, without its tabs. */
  rows(node: PermissionNode): PermissionNode[] {
    return (node.children ?? []).filter((child) => !isContainer(child));
  }
  rowKind(node: PermissionNode): string {
    return PERMISSION_KINDS[node.type];
  }
  tabs(node: PermissionNode): PermissionNode[] {
    return (node.children ?? []).filter(isContainer);
  }

  toggle(node: PermissionNode): void {
    if (this.editable)
      this.granted = new Set(
        setPermission(this.granted, node, this.state(node) !== "all"),
      );
  }
  viewOnly(nodes: PermissionNode[]): void {
    if (!this.editable) return;
    let next: Iterable<string> = this.granted;
    for (const node of nodes) next = setViewOnly(next, node);
    this.granted = new Set(next);
  }
  setAll(on: boolean): void {
    if (!this.editable) return;
    let next: Iterable<string> = [];
    if (on) for (const node of this.catalog) next = setPermission(next, node, true);
    this.granted = new Set(next);
  }
  toggleExpanded(node: PermissionNode): void {
    const next = new Set(this.expanded);
    if (!next.delete(node.code)) next.add(node.code);
    this.expanded = next;
  }
  toggleAllExpanded(): void {
    this.expanded = new Set(
      this.allExpanded ? [] : this.catalog.map((node) => node.code),
    );
  }

  select(role: AccountRole): void {
    if (role.code === this.draft?.code || !this.leaveDraft()) return;
    this.message = "";
    this.load(role);
  }
  add(source?: AccountRole): void {
    if (!this.can("users.roles.create") || !this.leaveDraft()) return;
    this.message = "";
    this.draft = {
      displayName: this.unusedName(
        source ? `${source.displayName} 副本` : "新角色",
      ),
      description: source?.description ?? "",
    };
    this.granted = new Set(source?.permissions.map((item) => item.code));
    // Differs from any snapshot, so a new role counts as unsaved.
    this.saved = "";
    this.deleting = false;
  }
  cancel(): void {
    if (this.saving) return;
    this.message = "";
    this.draft = this.draft?.code ? this.draft : null;
    const role = this.selected ?? this.roles[0];
    if (role) this.load(role);
  }

  async save(): Promise<void> {
    if (!this.draft || !this.editable) return;
    const input: RoleInput = {
      ...this.draft,
      displayName: this.draft.displayName.trim().replace(/\s+/g, " "),
      description: this.draft.description.trim().replace(/\s+/g, " "),
      permissions: [...this.granted],
    };
    if (!input.displayName) {
      this.report("請輸入角色名稱", true);
      return;
    }
    this.saving = true;
    this.message = "";
    try {
      const result = this.db.available
        ? await this.db.saveRole(this.session.token, input)
        : this.saveInPreview(input);
      this.finish(result.roles, result.code);
      this.report(
        `已儲存「${input.displayName}」` +
          (this.db.available
            ? input.code
              ? "，使用此角色的帳號需重新登入"
              : ""
            : "（瀏覽器預覽，僅本次有效）"),
      );
    } catch (error) {
      this.report(this.errorText(error, "角色儲存失敗"), true);
    } finally {
      this.saving = false;
    }
  }
  async remove(): Promise<void> {
    const role = this.selected;
    if (!role || !this.canDelete || this.saving) return;
    if (!this.deleting) {
      this.deleting = true;
      return;
    }
    this.saving = true;
    try {
      const roles = this.db.available
        ? await this.db.deleteRole(this.session.token, role.code)
        : this.roles.filter((item) => item !== role);
      this.finish(roles, roles[0]?.code);
      this.report(`已刪除「${role.displayName}」`);
    } catch (error) {
      this.deleting = false;
      this.report(this.errorText(error, "角色刪除失敗"), true);
    } finally {
      this.saving = false;
    }
  }

  private finish(roles: AccountRole[], code: string | undefined): void {
    this.roles = roles;
    const role = roles.find((item) => item.code === code);
    if (role) this.load(role);
    this.rolesChange.emit(roles);
  }
  private saveInPreview(input: RoleInput) {
    const code = input.code ?? `role-${Date.now()}`;
    if (
      this.roles.some(
        (role) =>
          role.code !== code &&
          role.displayName.toLowerCase() === input.displayName.toLowerCase(),
      )
    )
      throw new Error("角色名稱已存在");
    const old = this.roles.find((role) => role.code === code);
    const role = roleFromPermissions(
      {
        code,
        displayName: input.displayName,
        description: input.description,
        isSystem: old?.isSystem ?? false,
        userCount: old?.userCount ?? 0,
      },
      input.permissions,
    );
    return {
      code,
      roles: old
        ? this.roles.map((item) => (item === old ? role : item))
        : [...this.roles, role],
    };
  }
  private load(role: AccountRole): void {
    this.draft = {
      code: role.code,
      displayName: role.displayName,
      description: role.description,
    };
    this.granted = new Set(role.permissions.map((item) => item.code));
    this.saved = this.snapshot();
    this.deleting = false;
  }
  private leaveDraft(): boolean {
    if (this.saving) return false;
    if (this.dirty) {
      this.report("目前角色尚未儲存，請先儲存或取消變更", true);
      return false;
    }
    return true;
  }
  private snapshot(): string {
    return JSON.stringify([this.draft, [...this.granted].sort()]);
  }
  private unusedName(base: string): string {
    const names = new Set(
      this.roles.map((role) => role.displayName.toLowerCase()),
    );
    let name = base;
    for (let n = 2; names.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    return name;
  }
  private report(message: string, failed = false): void {
    this.message = message;
    this.failed = failed;
  }
  /** Drops Electron's "Error invoking remote method" prefix. */
  private errorText(error: unknown, fallback: string): string {
    return error instanceof Error
      ? error.message.replace(
          /^Error invoking remote method '[^']*': Error: /,
          "",
        )
      : fallback;
  }
}
