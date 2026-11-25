import { CommonModule } from "@angular/common";
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DomSanitizer } from "@angular/platform-browser";
import { MatIconModule, MatIconRegistry } from "@angular/material/icon";
import {
  AlarmFilter,
  AlarmLimits,
  AlarmLatch,
  AlarmRelease,
  LocalAccount,
  SensorChannel,
  SensorState,
  UserSession,
  ViewKey,
  sensorReason,
  sensorState,
  alarmReleaseExpired,
  outsideLimits,
} from "./dashboard.model";
import { createMockChannels } from "./mock-data";
import { AlarmTracker } from "./alert-state";
import {
  AccountRole,
  DatabaseMenu,
  DatabaseService,
  ReportFilter,
  ReportRow,
} from "./database.service";
import {
  BRAND_SUBTITLE_MAX_LENGTH,
  BRAND_TITLE_MAX_LENGTH,
  BrandTitles,
  DEFAULT_BRAND_TITLES,
  LOGO_FILE_TYPES,
  parseBrandTitles,
  parseLogo,
  readLogoFile,
} from "./branding";
import {
  DEFAULT_FONT_SIZES,
  FONT_SIZE_AREAS,
  FontSizeArea,
  FontSizes,
  applyFontSizes,
  parseFontSizes,
} from "./font-size";
import {
  MaterialSvgIconDirective,
  registerDashboardMaterialIcons,
} from "./material-icons";

interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
}

type SettingsTab = "theme" | "data" | "database" | "alarm" | "notification";

const RELEASE_REASON_OTHER = "__other__";
const RELEASE_REASON_MAX_LENGTH = 60;

interface PendingLimitChange {
  useDefault: boolean;
  message: string;
}

@Component({
  selector: "app-root",
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MaterialSvgIconDirective],
  templateUrl: "./app.component.html",
})
export class AppComponent implements OnInit, OnDestroy {
  readonly Math = Math;
  navItems: NavItem[] = [
    { key: "overview", label: "儀錶板", icon: "speed" },
    { key: "trends", label: "趨勢圖", icon: "trending_up" },
    { key: "channels", label: "報表資料", icon: "table_view" },
    { key: "alarms", label: "警報中心", icon: "notifications_active" },
    { key: "permissions", label: "帳號權限", icon: "verified_user" },
    { key: "settings", label: "設定", icon: "settings" },
  ];
  readonly viewTitles: Record<ViewKey, string> = {
    overview: "儀錶板",
    trends: "即時趨勢圖",
    channels: "報表資料",
    alarms: "警報中心",
    permissions: "帳號權限",
    account: "系統測試",
    settings: "系統設定",
  };
  readonly pageSizes = [25, 50, 100];
  readonly pointOptions = [30, 60, 120, 300, 500];
  readonly seriesColors = [
    "#2364aa",
    "#f28e2b",
    "#16856b",
    "#c53b4b",
    "#7a5dc7",
    "#9a604e",
    "#087e8b",
    "#c77d10",
  ];

  session: UserSession | null = null;
  appSettings: Record<string, unknown> = {};
  databasePath = "瀏覽器開發模式（Electron 啟動後使用 SQLite）";
  get databaseFileName(): string {
    return this.databasePath.split(/[\\/]/).pop() ?? this.databasePath;
  }
  databaseState: "checking" | "connected" | "disconnected" | "browser" =
    "checking";
  databaseError = "";
  databaseCheckedAt = "";
  databaseChecking = false;
  databaseCleaning = false;
  databaseCleanupMessage = "";
  databaseCleanupFailed = false;
  private databaseTimer?: number;
  syncError = "";
  apiStatus = "unknown";
  apiStale = false;
  get snapshotReminderEnabled(): boolean {
    return this.appSettings["notifications.snapshot_stale_enabled"] === true;
  }
  apiAgeSeconds = 0;
  apiCollectedAt = "";
  reportMessage = "";
  settingsMessage = "";
  readonly settingsTabs: ReadonlyArray<{
    key: SettingsTab;
    label: string;
    icon: string;
  }> = [
    { key: "theme", label: "主題設定", icon: "palette" },
    { key: "data", label: "資料設定", icon: "dns" },
    { key: "database", label: "資料庫維護", icon: "storage" },
    { key: "alarm", label: "警報設定", icon: "warning" },
    { key: "notification", label: "通知設定", icon: "notifications_active" },
  ];
  settingsTab: SettingsTab = "theme";
  username = localStorage.getItem("edge-angular-last-username") ?? "";
  password = "";
  loginError = "";
  view: ViewKey = "overview";
  collapsed = localStorage.getItem("edge-angular-sidebar-collapsed") === "1";
  mobileOpen = false;
  showDashboardStatus =
    localStorage.getItem("edge-angular-show-status") !== "0";
  readonly fontSizeAreas = FONT_SIZE_AREAS;
  fontSizes: FontSizes = { ...DEFAULT_FONT_SIZES };
  fontSizeSaving = false;
  fontSizeMessage = "";
  fontSizeFailed = false;
  readonly brandTitleMaxLength = BRAND_TITLE_MAX_LENGTH;
  readonly brandSubtitleMaxLength = BRAND_SUBTITLE_MAX_LENGTH;
  readonly logoFileTypes = LOGO_FILE_TYPES.join(",");
  brandTitles: BrandTitles = { ...DEFAULT_BRAND_TITLES };
  brandTitlesDraft: BrandTitles = { ...DEFAULT_BRAND_TITLES };
  brandTitlesSaving = false;
  brandTitlesMessage = "";
  brandTitlesFailed = false;
  logo = "";
  logoSaving = false;
  logoMessage = "";
  logoFailed = false;
  clock = new Date();
  channels = createMockChannels();
  lastUpdated = new Date();
  readonly refreshOptions = [10, 30, 60];
  pollIntervalMs = 60000;
  soundEnabled = true;
  soundIntervalSeconds = 3;
  pendingSoundIntervalSeconds = 3;
  soundMessage = "";
  private alarmSnapshotReady = false;
  private alarmSoundTimer?: number;
  private alarmSoundTimerMs = 0;
  private audioGeneration = 0;
  private soundStarting = false;
  private readonly activeAlarmOscillators = new Set<OscillatorNode>();
  notificationsEnabled = true;
  alertSettingsSaving = false;
  alertMessage = "";
  private readonly alarmTracker = new AlarmTracker();
  private alertAudio?: AudioContext;
  private refreshing = false;
  private dataTimer = window.setInterval(
    () => this.refreshData(),
    this.pollIntervalMs,
  );
  private clockTimer = window.setInterval(() => {
    this.clock = new Date();
    this.expireAlarmReleases();
  }, 1000);

  overviewFilter: "all" | SensorState = "all";
  overviewQuery = "";
  overviewPage = 0;
  displayMode: "compact" | "detailed" | "fullscreen" = "compact";
  refreshDialogOpen = false;
  pendingRefreshSeconds = 60;
  selectedSensor: SensorChannel | null = null;
  editLow: number | null = 0;
  editHigh: number | null = 0;
  channelLimits: Record<string, AlarmLimits> = {};
  defaultLow: number | null = 2;
  defaultHigh: number | null = 8;
  limitsSaving = false;
  defaultLimitsMessage = "";
  defaultLimitsFailed = false;
  modalFailed = false;
  @ViewChild("sensorLowInput")
  private sensorLowInput?: ElementRef<HTMLInputElement>;
  modalMessage = "";
  pendingLimitChange: PendingLimitChange | null = null;
  readonly releaseReasonOther = RELEASE_REASON_OTHER;
  readonly releaseReasonMaxLength = RELEASE_REASON_MAX_LENGTH;
  alarmReleases: Record<string, AlarmRelease> = {};
  /** Alarms cleared only by a limit edit; they stay until released. */
  alarmLatches: Record<string, AlarmLatch> = {};
  /** Release records per channel; drives the modal's download button. */
  alarmRecordCounts: Record<string, number> = {};
  /** Browser-preview only: release history kept in memory for export. */
  private localReleaseHistory: Record<
    string,
    Array<AlarmRelease & { alarmReason: string }>
  > = {};
  releaseTarget: SensorChannel | null = null;
  /** Release refused: the reading is still outside the saved limits. */
  releaseBlocked: SensorChannel | null = null;
  releaseChoice = RELEASE_REASON_OTHER;
  releaseCustomReason = "";
  releaseSaveAsOption = false;
  releaseSaving = false;
  releaseError = "";
  newReleaseReason = "";
  releaseReasonsSaving = false;
  releaseReasonsMessage = "";
  releaseReasonsFailed = false;
  releaseReasonUsage: Record<string, number> = {};
  renamingReleaseReason: string | null = null;
  renameReleaseReasonText = "";

  alarmFilter: AlarmFilter = "all";
  channelQuery = "";
  channelStatus: "all" | SensorState = "all";
  channelDateFrom = "";
  channelDateTo = "";
  reportApplicant = "";
  reportPhone = "";
  reportEmail = "";
  reportSite = "";
  channelPage = 1;
  channelPageSize = 25;
  reportRows: SensorChannel[] = [];
  reportTotal = 0;
  trendQuery = "";
  trendStatus: "all" | SensorState = "all";
  trendPointLimit = 120;
  trendPaused = false;
  selectedTrendIds = this.channels.slice(0, 4).map((channel) => channel.id);
  testMessage = "";
  permissionMessage = "";
  permissionFailed = false;
  accountDraft: LocalAccount | null = null;
  accountRoles: AccountRole[] = [];
  accountEditorError = "";
  accountEditorLoading = false;
  accountSaving = false;
  private accountEditorElement?: HTMLDialogElement;
  accounts: LocalAccount[] = this.loadAccounts();

  constructor(
    private readonly db: DatabaseService,
    iconRegistry: MatIconRegistry,
    sanitizer: DomSanitizer,
  ) {
    registerDashboardMaterialIcons(iconRegistry, sanitizer);
  }

  async ngOnInit(): Promise<void> {
    this.applyDatabaseSettings();
    this.databaseTimer = window.setInterval(
      () => void this.checkDatabaseConnection(),
      10000,
    );
    void this.checkDatabaseConnection();
    try {
      const bootstrap = await this.db.bootstrap();
      if (bootstrap) {
        this.appSettings = bootstrap.settings;
        this.databasePath = bootstrap.databasePath;
        this.applyDatabaseSettings();
      }
    } catch (error) {
      this.databasePath = "資料庫資訊讀取失敗，請重新啟動桌面程式";
      this.databaseError =
        error instanceof Error ? error.message : "資料庫初始化失敗";
    }
  }

  ngOnDestroy(): void {
    this.stopAlarmSound();
    window.clearInterval(this.dataTimer);
    window.clearInterval(this.clockTimer);
    window.clearInterval(this.databaseTimer);
    if (this.alertAudio) void this.alertAudio.close().catch(() => {});
  }

  async login(): Promise<void> {
    if (this.db.desktopExpected && !this.db.available) {
      this.loginError =
        "桌面資料庫連線模組未載入，無法登入。請完整關閉所有 C62 視窗，重新建置並啟動桌面版。";
      return;
    }
    this.alarmSnapshotReady = false;
    this.stopAlarmSound();
    this.alarmTracker.reset();
    if (this.soundEnabled) void this.prepareAlertAudio().catch(() => {});
    if (this.db.available) {
      try {
        const result = await this.db.login(this.username, this.password);
        if (!result) throw new Error("SQLite Bridge 尚未就緒");
        this.session = result.session;
        this.navItems = result.menus
          .filter((menu) => menu.key !== "account")
          .map((menu: DatabaseMenu) => ({
            key: menu.key,
            label: menu.label,
            icon: menu.icon,
          }));
        this.appSettings = result.settings;
        this.channelLimits = result.channelLimits ?? {};
        this.alarmReleases = result.alarmReleases ?? {};
        this.alarmRecordCounts = result.alarmRecordCounts ?? {};
        this.alarmLatches = result.alarmLatches ?? {};
        this.applyDatabaseSettings();
        this.view = String(
          this.appSettings["ui.default_view"] ?? "overview",
        ) as ViewKey;
        if (this.view === "account") this.view = "settings";
        if (!this.navItems.some((item) => item.key === this.view))
          this.view = "overview";
        this.loginError = "";
        localStorage.setItem(
          "edge-angular-last-username",
          result.session.username,
        );
        this.password = "";
        await this.refreshData();
        void this.loadReleaseReasonUsage();
        if (result.session.permissions.includes("users.manage"))
          await this.loadDatabaseUsers();
        return;
      } catch (error) {
        this.loginError = error instanceof Error ? error.message : "登入失敗";
        return;
      }
    }
    const users: Record<
      string,
      { password: string; displayName: string; role: string }
    > = {
      admin: {
        password: "SGS@1234",
        displayName: "系統管理員",
        role: "Administrator",
      },
      operator1: {
        password: "1234",
        displayName: "操作員 1",
        role: "Operator",
      },
      guest: { password: "", displayName: "訪客", role: "Guest" },
    };
    const account = users[this.username.trim().toLowerCase()];
    if (!account || account.password !== this.password) {
      this.loginError = "帳號或密碼錯誤";
      return;
    }
    this.loginError = "";
    localStorage.setItem(
      "edge-angular-last-username",
      this.username.trim().toLowerCase(),
    );
    this.session = {
      token: "browser-demo",
      username: this.username.trim().toLowerCase(),
      displayName: account.displayName,
      role: account.role,
      roleCode: account.role.toLowerCase(),
      permissions: [
        "dashboard.view",
        "trends.view",
        "reports.view",
        "reports.export",
        "alarms.view",
        "alarms.ack",
        "users.manage",
        "settings.manage",
        "tests.run",
      ],
    };
    this.password = "";
    await this.refreshData();
  }

  logout(): void {
    if (this.session && this.db.available)
      void this.db.logout(this.session.token);
    this.session = null;
    this.alarmReleases = {};
    this.alarmRecordCounts = {};
    this.alarmLatches = {};
    this.localReleaseHistory = {};
    this.releaseTarget = null;
    this.releaseBlocked = null;
    this.alarmSnapshotReady = false;
    this.stopAlarmSound();
    this.alarmTracker.reset();
    this.view = "overview";
  }
  navigate(view: ViewKey): void {
    this.view = view;
    this.mobileOpen = false;
    if (view === "channels") void this.runReportQuery();
    if (view === "permissions") this.permissionMessage = "";
    if (view === "settings") {
      void this.checkDatabaseConnection();
      void this.loadReleaseReasonUsage();
    }
  }
  selectSettingsTab(tab: SettingsTab): void {
    if (this.settingsTab === tab) return;
    this.settingsTab = tab;
    // These report the last action on the tab being left.
    this.settingsMessage = "";
    this.testMessage = "";
    this.fontSizeMessage = "";
    this.brandTitlesMessage = "";
    this.logoMessage = "";
    this.defaultLimitsMessage = "";
    this.releaseReasonsMessage = "";
  }
  onSettingsTabKeydown(event: KeyboardEvent): void {
    const count = this.settingsTabs.length;
    const current = this.settingsTabs.findIndex(
      (tab) => tab.key === this.settingsTab,
    );
    let next: number;
    if (event.key === "ArrowRight") next = (current + 1) % count;
    else if (event.key === "ArrowLeft") next = (current - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else return;
    event.preventDefault();
    const { key } = this.settingsTabs[next];
    this.selectSettingsTab(key);
    document.getElementById(`settings-tab-${key}`)?.focus();
  }
  /** Keeps background failures visible when their card is on another tab. */
  settingsTabIssue(tab: SettingsTab): string {
    if (tab === "database" && this.databaseState === "disconnected")
      return "資料庫連線異常";
    if (tab === "notification")
      return [this.alertMessage, this.soundMessage].filter(Boolean).join("；");
    return "";
  }
  toggleSidebar(): void {
    this.collapsed = !this.collapsed;
    localStorage.setItem(
      "edge-angular-sidebar-collapsed",
      this.collapsed ? "1" : "0",
    );
  }
  toggleDashboardStatus(): void {
    localStorage.setItem(
      "edge-angular-show-status",
      this.showDashboardStatus ? "1" : "0",
    );
  }

  async refreshData(persist = true): Promise<void> {
    if (this.databaseCleaning || this.refreshing) return;
    this.refreshing = true;
    const sessionToken = this.session?.token;
    const previous = new Map(
      this.channels.map((channel) => [channel.id, channel.history]),
    );
    try {
      if (
        this.session &&
        this.db.available &&
        this.appSettings["data.mode"] === "live"
      ) {
        const synced = await this.db.syncApi(this.session.token, persist);
        if (synced) {
          this.channels = synced.snapshot.channels;
          this.apiStatus = synced.snapshot.status;
          this.apiStale = synced.snapshot.stale;
          this.apiAgeSeconds = synced.snapshot.age_seconds;
          this.apiCollectedAt = synced.snapshot.collected_at;
        }
      } else {
        this.channels = createMockChannels().map((channel) => ({
          ...channel,
          history: previous.get(channel.id) ?? channel.history,
        }));
        if (this.session && this.db.available && persist) {
          await this.db.ingestSnapshot(
            this.session.token,
            { time: new Date().toISOString(), channels: this.channels },
            "mock",
          );
        }
      }
      if (sessionToken !== this.session?.token) return;
      this.refreshLimitDisplay();
      if (this.trendPaused)
        this.channels = this.channels.map((channel) => ({
          ...channel,
          history: previous.get(channel.id) ?? channel.history,
        }));
      this.syncError = "";
      this.alarmSnapshotReady = Boolean(this.session);
      this.syncAlarmSound();
      this.announceNewAlarms();
    } catch (error) {
      if (sessionToken !== this.session?.token) return;
      this.syncError = error instanceof Error ? error.message : "資料同步失敗";
      this.alarmSnapshotReady = Boolean(this.session);
      this.syncAlarmSound();
      if (this.session && this.alarmTracker.fail())
        void this.emitAlarm("資料同步失敗，請檢查設備 API、網路及資料庫連線。");
    } finally {
      this.refreshing = false;
    }
    this.lastUpdated = new Date();
    if (this.selectedSensor)
      this.selectedSensor =
        this.channels.find((item) => item.id === this.selectedSensor?.id) ??
        null;
  }

  private announceNewAlarms(): void {
    if (!this.session) return;
    const changed = this.alarmTracker.collect(this.channels, (channel) =>
      this.state(channel),
    );
    if (!changed.length) return;
    const summary = changed
      .slice(0, 5)
      .map(
        (channel) => `CH${channel.id} ${this.statusLabel(this.state(channel))}`,
      )
      .join("、");
    void this.emitAlarm(
      `偵測到 ${changed.length} 點新異常：${summary}${changed.length > 5 ? "…" : ""}`,
    );
  }
  /** Re-arm alarms the moment a one-minute release runs out, not at the next poll. */
  private expireAlarmReleases(): void {
    if (!this.session) return;
    const expired = Object.keys(this.alarmReleases).filter((id) =>
      alarmReleaseExpired(this.alarmReleases[id]),
    );
    if (!expired.length) return;
    this.refreshLimitDisplay();
    if (this.selectedSensor && expired.includes(this.selectedSensor.id)) {
      this.modalMessage = "解除已滿一分鐘，警報原因仍存在，已重新警報";
      this.modalFailed = true;
    }
    this.syncAlarmSound();
    this.announceNewAlarms();
  }
  private applyDatabaseSettings(): void {
    this.defaultLow = this.defaultLimits.low;
    this.defaultHigh = this.defaultLimits.high;
    this.refreshLimitDisplay();
    const interval = Number(this.appSettings["api.poll_interval_ms"] ?? 60000);
    this.pollIntervalMs = this.refreshOptions.includes(interval / 1000)
      ? interval
      : 60000;
    this.appSettings["api.poll_interval_ms"] = this.pollIntervalMs;
    this.soundEnabled = this.appSettings["alarms.sound_enabled"] !== false;
    const soundInterval = Number(
      this.appSettings["alarms.sound_interval_seconds"] ?? 3,
    );
    this.soundIntervalSeconds =
      Number.isInteger(soundInterval) &&
      soundInterval >= 1 &&
      soundInterval <= 300
        ? soundInterval
        : 3;
    this.pendingSoundIntervalSeconds = this.soundIntervalSeconds;
    this.notificationsEnabled =
      this.appSettings["notifications.enabled"] !== false;
    this.showDashboardStatus =
      this.appSettings["dashboard.show_status"] !== false;
    this.fontSizes = parseFontSizes(this.appSettings["ui.font_sizes"]);
    applyFontSizes(this.fontSizes);
    this.logo = parseLogo(this.appSettings["ui.logo"]);
    const titles = parseBrandTitles(this.appSettings["ui.titles"]);
    // Saving another setting must not discard titles still being typed.
    if (
      titles.title !== this.brandTitles.title ||
      titles.subtitle !== this.brandTitles.subtitle
    )
      this.brandTitlesDraft = { ...titles };
    this.brandTitles = titles;
    document.title = titles.title;
    window.clearInterval(this.dataTimer);
    this.dataTimer = window.setInterval(
      () => void this.refreshData(),
      this.pollIntervalMs,
    );
    this.syncAlarmSound();
  }

  get normalCount(): number {
    return this.channels.filter((channel) => this.state(channel) === "ok")
      .length;
  }
  get alarmCount(): number {
    return this.channels.filter((channel) => this.state(channel) === "alarm")
      .length;
  }
  get errorCount(): number {
    return this.channels.filter((channel) => this.state(channel) === "error")
      .length;
  }
  state(channel: SensorChannel): SensorState {
    return sensorState(channel);
  }
  reason(channel: SensorChannel): string | null {
    return sensorReason(channel);
  }
  statusLabel(state: SensorState): string {
    return { ok: "正常", alarm: "警報", error: "異常" }[state];
  }
  apiStatusLabel(status: string): string {
    return (
      (
        {
          disconnected: "未連線",
          connecting: "正在連線",
          connected: "已連線",
          reconnecting: "正在重新連線",
          no_com_port: "無可用 USB COM 埠",
          com_busy: "COM 被占用或拒絕存取",
          rtu_no_response: "USB 已開啟，但 RTU 無回應",
          io_error: "I/O 錯誤，將自動重連",
          connection_failed: "USB／COM 連線失敗",
          unknown: "狀態不明",
        } as Record<string, string>
      )[status] ?? `狀態不明 (${status})`
    );
  }
  formatValue(value: number | null): string {
    return value === null || !Number.isFinite(value) ? "--" : value.toFixed(1);
  }
  formatTime(value: string | Date): string {
    return new Date(value).toLocaleTimeString("zh-TW", { hour12: false });
  }
  formatRelativeTime(value: string | Date): string {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return this.formatTime(value);
    const seconds = Math.max(
      0,
      Math.floor((this.clock.getTime() - timestamp) / 1000),
    );
    return seconds <= 3 ? "剛剛" : `${seconds} 秒前`;
  }
  formatDateTime(value: string | Date): string {
    return new Date(value).toLocaleString("zh-TW", { hour12: false });
  }

  get filteredOverview(): SensorChannel[] {
    const text = this.overviewQuery.trim().toLocaleLowerCase("zh-TW");
    return this.channels.filter(
      (channel) =>
        (!text ||
          `CH${channel.id} ${channel.name}`
            .toLocaleLowerCase("zh-TW")
            .includes(text)) &&
        (this.overviewFilter === "all" ||
          this.state(channel) === this.overviewFilter),
    );
  }
  get overviewPages(): number[] {
    return Array.from(
      { length: Math.max(1, Math.ceil(this.filteredOverview.length / 50)) },
      (_, index) => index,
    );
  }
  get visibleSensors(): SensorChannel[] {
    return this.filteredOverview.slice(
      this.overviewPage * 50,
      (this.overviewPage + 1) * 50,
    );
  }
  selectOverviewFilter(filter: "all" | SensorState): void {
    this.overviewFilter = filter;
    this.overviewPage = 0;
  }
  get dataRefreshing(): boolean {
    return this.refreshing;
  }
  async refreshOverview(): Promise<void> {
    this.selectOverviewFilter("all");
    await this.refreshData(false);
  }
  showAlarms(filter: AlarmFilter): void {
    this.alarmFilter = filter;
    this.navigate("alarms");
  }
  openSensor(channel: SensorChannel): void {
    if (this.limitsSaving) return;
    const current =
      this.channels.find((item) => item.id === channel.id) ?? channel;
    const limits = this.channelLimits[current.id] ?? this.defaultLimits;
    this.selectedSensor = {
      ...current,
      web_lo: limits.low,
      web_hi: limits.high,
      limit_source: this.channelLimits[current.id] ? "custom" : "default",
    };
    this.editLow = limits.low;
    this.editHigh = limits.high;
    this.modalMessage = "";
    this.modalFailed = false;
    this.focusSensorEditor();
  }
  onSensorBackdropMouseDown(event: MouseEvent): void {
    // Angular treats a false listener result as preventDefault(), which blocks
    // input focus and native number spinners on clicks inside the dialog.
    if (event.target === event.currentTarget && !this.limitsSaving)
      this.selectedSensor = null;
  }
  onRefreshBackdropMouseDown(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.refreshDialogOpen = false;
  }
  private focusSensorEditor(): void {
    const id = this.selectedSensor?.id;
    window.setTimeout(async () => {
      if (!this.session || this.selectedSensor?.id !== id) return;
      // Do not take focus back if the user has already chosen an input.
      if (
        document.activeElement?.matches(
          'input, select, textarea, [contenteditable="true"]',
        )
      )
        return;
      await this.ensureEditorFocus();
      if (
        this.selectedSensor?.id !== id ||
        !this.canManageLimits ||
        this.limitsSaving
      )
        return;
      if (
        document.activeElement?.matches(
          'input, select, textarea, [contenteditable="true"]',
        )
      )
        return;
      this.sensorLowInput?.nativeElement.focus({ preventScroll: true });
    }, 0);
  }
  async ensureEditorFocus(): Promise<void> {
    // Called once when opening the editor, never by input clicks or polling.
    try {
      await this.db.focusEditor();
    } catch {
      /* Older desktop builds do not expose this optional helper. */
    }
  }
  get limitsAccessMessage(): string {
    if (!this.db.available)
      return this.db.desktopExpected
        ? "桌面連線模組未載入，請完整關閉程式後重新啟動。"
        : "瀏覽器預覽沒有桌面資料庫連線，請由 Electron 啟動。";
    if (!this.session?.permissions.includes("settings.manage"))
      return `目前帳號 ${this.session?.username ?? ""} 沒有系統設定權限，請重新登入確認。`;
    if (this.limitsSaving) return "正在等待資料庫完成儲存…";
    return `可編輯 · ${this.session.username} · 桌面連線模組已載入`;
  }
  get defaultLimits(): AlarmLimits {
    const limits = this.appSettings["alarms.default_limits"] as
      | AlarmLimits
      | undefined;
    return limits &&
      Number.isFinite(limits.low) &&
      Number.isFinite(limits.high) &&
      limits.low < limits.high
      ? limits
      : { low: 2, high: 8 };
  }
  get canManageLimits(): boolean {
    return Boolean(
      this.db.available &&
      this.session?.permissions.includes("settings.manage"),
    );
  }
  private refreshLimitDisplay(): void {
    const releases = { ...this.alarmReleases };
    this.channels = this.channels.map((channel): SensorChannel => {
      const limits = this.channelLimits[channel.id] ?? this.defaultLimits;
      const next: SensorChannel = {
        ...channel,
        web_lo: limits.low,
        web_hi: limits.high,
        limit_source: this.channelLimits[channel.id] ? "custom" : "default",
      };
      const latch = this.alarmLatches[channel.id] ?? null;
      const abnormal =
        sensorState({
          ...next,
          web_alarm_ack: false,
          alarm_release: null,
          alarm_latch: latch,
        }) !== "ok";
      // A release lasts one minute and only while abnormal; recovery, expiry
      // or a reading outside the limits re-arms the alarm.
      const held = releases[channel.id];
      if (
        !abnormal ||
        outsideLimits(next) ||
        (held && alarmReleaseExpired(held))
      )
        delete releases[channel.id];
      const release = releases[channel.id];
      const deviceAck = channel.web_alarm_ack && !channel.alarm_release;
      return {
        ...next,
        web_alarm_ack: abnormal && (Boolean(release) || deviceAck),
        alarm_release: release ?? null,
        alarm_latch: release ? null : latch,
      };
    });
    this.alarmReleases = releases;
    if (this.releaseBlocked) {
      const id = this.releaseBlocked.id;
      const current = this.channels.find((channel) => channel.id === id);
      this.releaseBlocked = current && outsideLimits(current) ? current : null;
    }
    if (this.selectedSensor)
      this.selectedSensor =
        this.channels.find(
          (channel) => channel.id === this.selectedSensor?.id,
        ) ?? this.selectedSensor;
  }
  /** Channels in alarm (not released) right before a limit change. */
  private limitAlarmSnapshot(): Map<string, string> {
    return new Map(
      this.channels
        .filter(
          (channel) =>
            !channel.alarm_release && this.state(channel) === "alarm",
        )
        .map((channel) => [channel.id, this.reason(channel) ?? "警報"]),
    );
  }
  /** Editing limits never clears an alarm by itself; it must be released. */
  private async latchLimitRecoveries(
    before: Map<string, string>,
  ): Promise<void> {
    const latchedAt = new Date().toISOString();
    const added: Record<string, string> = {};
    for (const channel of this.channels) {
      const reason = before.get(channel.id);
      if (!reason || this.alarmLatches[channel.id]) continue;
      if (sensorState({ ...channel, web_alarm_ack: false }) !== "ok") continue;
      this.alarmLatches = {
        ...this.alarmLatches,
        [channel.id]: { reason, latchedAt },
      };
      added[channel.id] = reason;
    }
    const token = this.session?.token;
    if (!token || !Object.keys(added).length) return;
    this.refreshLimitDisplay();
    const saved = await this.db.saveAlarmLatches(token, added);
    if (!saved || this.session?.token !== token) return;
    this.alarmLatches = saved;
    this.refreshLimitDisplay();
  }
  private notifyLimitAlarms(): void {
    this.syncAlarmSound();
    if (!this.session || !this.alarmSnapshotReady) return;
    const changed = this.alarmTracker.collect(this.channels, (channel) =>
      this.state(channel),
    );
    if (changed.length)
      void this.emitAlarm(
        `警報範圍已更新，偵測到 ${changed.length} 點新異常。`,
      );
  }
  requestSaveSensorLimits(useDefault = false): void {
    if (!this.selectedSensor || this.limitsSaving) return;
    this.modalFailed = true;
    if (!this.canManageLimits || !this.session) {
      this.modalMessage = this.limitsAccessMessage;
      return;
    }
    if (
      !useDefault &&
      (typeof this.editLow !== "number" ||
        typeof this.editHigh !== "number" ||
        !Number.isFinite(this.editLow) ||
        !Number.isFinite(this.editHigh) ||
        this.editLow >= this.editHigh)
    ) {
      this.modalMessage = "請輸入有效數值，且下限必須小於上限";
      return;
    }
    const limits = useDefault
      ? this.defaultLimits
      : { low: this.editLow!, high: this.editHigh! };
    const currentState = this.state(this.selectedSensor);
    const nextState = this.state({
      ...this.selectedSensor,
      web_lo: limits.low,
      web_hi: limits.high,
      limit_source: useDefault ? "default" : "custom",
      web_alarm_ack: false,
    });
    if (
      currentState !== nextState &&
      (currentState === "alarm" || nextState === "alarm")
    ) {
      this.pendingLimitChange = {
        useDefault,
        message:
          nextState === "alarm"
            ? "此範圍會讓目前讀值進入警報，是否儲存？"
            : "此範圍會讓目前讀值回到範圍內，但警報仍會保留；儲存後請按「解除警報」並填寫理由。是否儲存？",
      };
      this.modalFailed = false;
      return;
    }
    void this.saveSensorLimits(useDefault);
  }
  confirmLimitChange(): void {
    const change = this.pendingLimitChange;
    this.pendingLimitChange = null;
    if (change) void this.saveSensorLimits(change.useDefault);
  }
  cancelLimitChange(): void {
    this.pendingLimitChange = null;
  }
  get releaseReasons(): string[] {
    const value = this.appSettings["alarms.release_reasons"];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
  get canReleaseAlarm(): boolean {
    return Boolean(this.session?.permissions.includes("alarms.ack"));
  }
  get canManageReleaseReasons(): boolean {
    return Boolean(this.session?.permissions.includes("settings.manage"));
  }
  openReleaseDialog(channel: SensorChannel): void {
    if (!this.canReleaseAlarm || this.state(channel) === "ok") return;
    if (outsideLimits(channel)) {
      this.releaseBlocked = channel;
      return;
    }
    this.releaseTarget = channel;
    this.releaseChoice = this.releaseReasons[0] ?? RELEASE_REASON_OTHER;
    this.releaseCustomReason = "";
    this.releaseSaveAsOption = false;
    this.releaseError = "";
  }
  closeReleaseBlocked(): void {
    this.releaseBlocked = null;
    if (!this.canManageLimits) return;
    window.setTimeout(() =>
      document
        .querySelector<HTMLInputElement>(".sensor-modal .limit-inputs input")
        ?.select(),
    );
  }
  cancelReleaseDialog(): void {
    if (!this.releaseSaving) this.releaseTarget = null;
  }
  async confirmRelease(): Promise<void> {
    const target = this.releaseTarget;
    if (!target || !this.session || this.releaseSaving) return;
    const custom = this.releaseChoice === RELEASE_REASON_OTHER;
    const reason = (custom ? this.releaseCustomReason : this.releaseChoice)
      .trim()
      .replace(/\s+/g, " ");
    if (!reason) {
      this.releaseError = "請選擇或輸入解除理由";
      return;
    }
    if (reason.length > RELEASE_REASON_MAX_LENGTH) {
      this.releaseError = `解除理由不可超過 ${RELEASE_REASON_MAX_LENGTH} 個字`;
      return;
    }
    const saveAsOption =
      custom && this.releaseSaveAsOption && this.canManageReleaseReasons;
    const token = this.session.token;
    // A poll may have moved the reading while the dialog was open.
    const current =
      this.channels.find((channel) => channel.id === target.id) ?? target;
    if (outsideLimits(current)) {
      this.releaseTarget = null;
      this.releaseBlocked = current;
      return;
    }
    this.releaseSaving = true;
    this.releaseError = "";
    try {
      if (this.db.available) {
        const result = await this.db.releaseAlarm(
          token,
          target.id,
          reason,
          saveAsOption,
        );
        if (!result) throw new Error("未收到解除結果，請重新啟動桌面程式");
        if (this.session?.token !== token) return;
        this.alarmReleases = result.releases;
        if (result.recordCounts) this.alarmRecordCounts = result.recordCounts;
        if (result.latches) this.alarmLatches = result.latches;
        else delete this.alarmLatches[target.id];
        this.appSettings = result.settings;
        if (result.usage) this.releaseReasonUsage = result.usage;
        this.applyDatabaseSettings();
      } else {
        const record = {
          reason,
          username: this.session.username,
          displayName: this.session.displayName,
          releasedAt: new Date().toISOString(),
          alarmReason: this.reason({ ...target, alarm_release: null }) ?? "",
        };
        const latches = { ...this.alarmLatches };
        delete latches[target.id];
        this.alarmLatches = latches;
        this.localReleaseHistory = {
          ...this.localReleaseHistory,
          [target.id]: [record, ...(this.localReleaseHistory[target.id] ?? [])],
        };
        this.alarmRecordCounts = {
          ...this.alarmRecordCounts,
          [target.id]: this.localReleaseHistory[target.id].length,
        };
        this.releaseReasonUsage = {
          ...this.releaseReasonUsage,
          [reason]: (this.releaseReasonUsage[reason] ?? 0) + 1,
        };
        this.alarmReleases = {
          ...this.alarmReleases,
          [target.id]: {
            reason,
            username: this.session.username,
            displayName: this.session.displayName,
            releasedAt: new Date().toISOString(),
          },
        };
        if (saveAsOption && !this.releaseReasons.includes(reason))
          this.appSettings["alarms.release_reasons"] = [
            ...this.releaseReasons,
            reason,
          ];
      }
      this.refreshLimitDisplay();
      this.alarmTracker.collect(this.channels, (channel) =>
        this.state(channel),
      );
      this.syncAlarmSound();
      this.releaseTarget = null;
      if (this.selectedSensor?.id === target.id) {
        this.modalMessage = `已解除警報：${reason}`;
        this.modalFailed = false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "解除警報失敗";
      if (message.includes("數值仍超出警報範圍")) {
        this.releaseTarget = null;
        this.releaseBlocked = current;
      }
      this.releaseError = message;
    } finally {
      this.releaseSaving = false;
    }
  }
  alarmRecordCount(channel: SensorChannel): number {
    return this.alarmRecordCounts[channel.id] ?? 0;
  }
  async exportAlarmReleases(channel: SensorChannel): Promise<void> {
    if (!this.session || !this.alarmRecordCount(channel)) return;
    try {
      if (this.db.available) {
        const result = await this.db.exportAlarmReleases(
          this.session.token,
          channel.id,
        );
        if (result && !result.canceled) {
          this.modalMessage = `已匯出 ${result.rowCount} 筆解除警報紀錄：${result.filePath}`;
          this.modalFailed = false;
        }
        return;
      }
      const records = this.localReleaseHistory[channel.id] ?? [];
      if (!records.length) return;
      const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
      const content = [
        ["通道", "名稱", "警報原因", "解除理由", "解除人員", "帳號", "解除時間"],
        ...records.map((release) => [
          `CH${channel.id}`,
          channel.name,
          release.alarmReason,
          release.reason,
          release.displayName ?? "",
          release.username,
          this.formatDateTime(release.releasedAt),
        ]),
      ]
        .map((row) => row.map(cell).join(","))
        .join("\r\n");
      const url = URL.createObjectURL(
        new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `CH${channel.id}_解除警報紀錄_${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      this.modalMessage =
        error instanceof Error ? error.message : "解除警報紀錄匯出失敗";
      this.modalFailed = true;
    }
  }
  async addReleaseReason(): Promise<void> {
    const reason = this.newReleaseReason.trim().replace(/\s+/g, " ");
    this.releaseReasonsFailed = true;
    if (!reason) {
      this.releaseReasonsMessage = "請輸入解除理由";
      return;
    }
    if (reason.length > RELEASE_REASON_MAX_LENGTH) {
      this.releaseReasonsMessage = `解除理由不可超過 ${RELEASE_REASON_MAX_LENGTH} 個字`;
      return;
    }
    if (this.releaseReasons.includes(reason)) {
      this.releaseReasonsMessage = "此理由已存在";
      return;
    }
    if (await this.saveReleaseReasons([...this.releaseReasons, reason])) {
      this.newReleaseReason = "";
      this.releaseReasonsMessage = `已新增「${reason}」`;
    }
  }
  releaseReasonUseCount(reason: string): number {
    return this.releaseReasonUsage[reason] ?? 0;
  }
  async loadReleaseReasonUsage(): Promise<void> {
    if (!this.session || !this.db.available) return;
    try {
      const usage = await this.db.releaseReasonUsage(this.session.token);
      if (usage) this.releaseReasonUsage = usage;
    } catch {
      /* Usage only locks delete buttons; the database still enforces it. */
    }
  }
  startRenameReleaseReason(reason: string): void {
    this.renamingReleaseReason = reason;
    this.renameReleaseReasonText = reason;
    this.releaseReasonsMessage = "";
    window.setTimeout(() =>
      document
        .querySelector<HTMLInputElement>(".release-reason-rename")
        ?.select(),
    );
  }
  cancelRenameReleaseReason(): void {
    this.renamingReleaseReason = null;
    this.renameReleaseReasonText = "";
  }
  async confirmRenameReleaseReason(): Promise<void> {
    const from = this.renamingReleaseReason;
    if (!from || !this.session || this.releaseReasonsSaving) return;
    const to = this.renameReleaseReasonText.trim().replace(/\s+/g, " ");
    this.releaseReasonsFailed = true;
    if (!to) {
      this.releaseReasonsMessage = "請輸入解除理由";
      return;
    }
    if (to.length > RELEASE_REASON_MAX_LENGTH) {
      this.releaseReasonsMessage = `解除理由不可超過 ${RELEASE_REASON_MAX_LENGTH} 個字`;
      return;
    }
    if (to === from) {
      this.cancelRenameReleaseReason();
      return;
    }
    if (this.releaseReasons.includes(to)) {
      this.releaseReasonsMessage = "此理由已存在";
      return;
    }
    const token = this.session.token;
    this.releaseReasonsSaving = true;
    try {
      if (this.db.available) {
        const result = await this.db.renameReleaseReason(token, from, to);
        if (!result) throw new Error("未收到儲存結果，請重新啟動桌面程式");
        if (this.session?.token !== token) return;
        this.appSettings = result.settings;
        this.alarmReleases = result.releases;
        if (result.usage) this.releaseReasonUsage = result.usage;
        this.applyDatabaseSettings();
      } else {
        this.appSettings["alarms.release_reasons"] = this.releaseReasons.map(
          (item) => (item === from ? to : item),
        );
        const { [from]: count, ...usage } = this.releaseReasonUsage;
        this.releaseReasonUsage = count ? { ...usage, [to]: count } : usage;
        this.alarmReleases = Object.fromEntries(
          Object.entries(this.alarmReleases).map(([id, release]) => [
            id,
            release.reason === from ? { ...release, reason: to } : release,
          ]),
        );
        this.refreshLimitDisplay();
      }
      this.cancelRenameReleaseReason();
      this.releaseReasonsFailed = false;
      this.releaseReasonsMessage = `已將「${from}」改名為「${to}」`;
    } catch (error) {
      this.releaseReasonsMessage =
        error instanceof Error ? error.message : "改名失敗";
    } finally {
      this.releaseReasonsSaving = false;
    }
  }
  async removeReleaseReason(reason: string): Promise<void> {
    if (this.releaseReasonUseCount(reason)) {
      this.releaseReasonsFailed = true;
      this.releaseReasonsMessage = `「${reason}」已有解除紀錄，不能刪除，可改名`;
      return;
    }
    if (
      await this.saveReleaseReasons(
        this.releaseReasons.filter((item) => item !== reason),
      )
    )
      this.releaseReasonsMessage = `已刪除「${reason}」`;
  }
  private async saveReleaseReasons(reasons: string[]): Promise<boolean> {
    if (this.releaseReasonsSaving) return false;
    this.releaseReasonsSaving = true;
    this.releaseReasonsFailed = true;
    this.releaseReasonsMessage = "";
    try {
      const saved = await this.saveDatabaseSetting(
        "alarms.release_reasons",
        reasons,
      );
      if (!saved) {
        this.releaseReasonsMessage =
          this.settingsMessage || "解除理由儲存失敗";
        return false;
      }
      this.releaseReasonsFailed = false;
      return true;
    } finally {
      this.releaseReasonsSaving = false;
    }
  }
  private async saveSensorLimits(useDefault = false): Promise<void> {
    if (!this.selectedSensor || this.limitsSaving || !this.session) return;
    const token = this.session.token,
      id = this.selectedSensor.id;
    const limits = useDefault
      ? null
      : { low: this.editLow!, high: this.editHigh! };
    this.limitsSaving = true;
    this.modalMessage = "";
    try {
      const saved = await this.db.saveChannelLimits(token, id, limits);
      if (!saved) throw new Error("未收到儲存結果，請重新啟動桌面程式");
      if (this.session?.token !== token) return;
      const before = this.limitAlarmSnapshot();
      this.channelLimits = saved;
      this.refreshLimitDisplay();
      await this.latchLimitRecoveries(before);
      if (this.session?.token !== token) return;
      if (this.selectedSensor?.id === id) {
        const effective = saved[id] ?? this.defaultLimits;
        this.editLow = effective.low;
        this.editHigh = effective.high;
        this.modalMessage = useDefault
          ? "已恢復預設值，後續隨全域預設更新"
          : "個別上下限已儲存，刷新或重開後仍會保留";
        this.modalFailed = false;
      }
      this.notifyLimitAlarms();
    } catch (error) {
      this.modalMessage =
        error instanceof Error ? error.message : "上下限儲存失敗";
    } finally {
      this.limitsSaving = false;
    }
  }
  async saveDefaultLimits(): Promise<void> {
    if (this.limitsSaving) return;
    this.defaultLimitsFailed = true;
    if (!this.canManageLimits || !this.session) {
      this.defaultLimitsMessage = this.limitsAccessMessage;
      return;
    }
    if (
      typeof this.defaultLow !== "number" ||
      typeof this.defaultHigh !== "number" ||
      !Number.isFinite(this.defaultLow) ||
      !Number.isFinite(this.defaultHigh) ||
      this.defaultLow >= this.defaultHigh
    ) {
      this.defaultLimitsMessage = "請輸入有效數值，且下限必須小於上限";
      return;
    }
    const token = this.session.token;
    this.limitsSaving = true;
    this.defaultLimitsMessage = "";
    try {
      const settings = await this.db.saveSetting(
        token,
        "alarms.default_limits",
        { low: this.defaultLow, high: this.defaultHigh },
      );
      if (!settings) throw new Error("未收到儲存結果，請重新啟動桌面程式");
      if (this.session?.token !== token) return;
      const before = this.limitAlarmSnapshot();
      this.appSettings = settings;
      this.applyDatabaseSettings();
      await this.latchLimitRecoveries(before);
      if (this.session?.token !== token) return;
      this.defaultLimitsMessage = "預設上下限已儲存，未個別設定的通道已套用";
      this.defaultLimitsFailed = false;
      this.notifyLimitAlarms();
    } catch (error) {
      this.defaultLimitsMessage =
        error instanceof Error ? error.message : "預設上下限儲存失敗";
    } finally {
      this.limitsSaving = false;
    }
  }
  async setDisplayMode(
    mode: "compact" | "detailed" | "fullscreen",
    stage?: HTMLElement,
  ): Promise<void> {
    if (mode === "fullscreen" && stage?.requestFullscreen) {
      await stage.requestFullscreen();
      this.displayMode = "fullscreen";
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    this.displayMode = mode;
  }
  async applyRefreshRate(): Promise<void> {
    if (!this.refreshOptions.includes(this.pendingRefreshSeconds)) return;
    if (
      this.db.available &&
      this.session?.permissions.includes("settings.manage")
    ) {
      if (
        !(await this.saveDatabaseSetting(
          "api.poll_interval_ms",
          this.pendingRefreshSeconds * 1000,
        ))
      )
        return;
    } else {
      this.appSettings["api.poll_interval_ms"] =
        this.pendingRefreshSeconds * 1000;
      this.applyDatabaseSettings();
    }
    this.refreshDialogOpen = false;
  }

  get alarms(): SensorChannel[] {
    return this.channels.filter(
      (channel) =>
        this.state(channel) !== "ok" &&
        (this.alarmFilter === "all" ||
          this.state(channel) === this.alarmFilter),
    );
  }
  get allAbnormalCount(): number {
    return this.alarmCount + this.errorCount;
  }

  get filteredChannelRows(): SensorChannel[] {
    if (this.db.available && this.session) return this.reportRows;
    const text = this.channelQuery.trim().toLocaleLowerCase("zh-TW");
    return this.channels.filter(
      (channel) =>
        (!text ||
          `CH${channel.id} ${channel.name}`
            .toLocaleLowerCase("zh-TW")
            .includes(text)) &&
        (this.channelStatus === "all" ||
          this.state(channel) === this.channelStatus),
    );
  }
  get channelPageCount(): number {
    return Math.max(
      1,
      Math.ceil(
        (this.db.available && this.session
          ? this.reportTotal
          : this.filteredChannelRows.length) / this.channelPageSize,
      ),
    );
  }
  get channelRows(): SensorChannel[] {
    if (this.db.available && this.session) return this.reportRows;
    const page = Math.min(this.channelPage, this.channelPageCount);
    return this.filteredChannelRows.slice(
      (page - 1) * this.channelPageSize,
      page * this.channelPageSize,
    );
  }
  refreshReport(): void {
    this.channelPage = 1;
    void this.runReportQuery();
  }
  private reportFilter(includePage = true): ReportFilter {
    return {
      query: this.channelQuery,
      state: this.channelStatus,
      from: this.channelDateFrom,
      to: this.channelDateTo,
      applicant: this.reportApplicant.trim() || this.session?.username || "",
      phone: this.reportPhone.trim(),
      email: this.reportEmail.trim(),
      site: this.reportSite.trim(),
      limit: includePage ? this.channelPageSize : undefined,
      offset: includePage
        ? (this.channelPage - 1) * this.channelPageSize
        : undefined,
    };
  }
  async runReportQuery(): Promise<void> {
    if (!this.session || !this.db.available) return;
    const startedAt = performance.now();
    this.reportMessage = "";
    try {
      const result = await this.db.queryReport(
        this.session.token,
        this.reportFilter(),
      );
      if (!result) return;
      this.reportTotal = result.total;
      this.reportRows = result.rows.map((row: ReportRow) => ({
        id: row.id,
        name: row.name,
        pv: row.pv,
        sv: row.sv,
        st: row.state === "error" ? 2 : row.state === "alarm" ? 3 : 0,
        time: row.time,
        history: [],
        min: row.pv ?? 0,
        max: row.pv ?? 0,
        avg: row.pv ?? 0,
        count: 1,
        web_lo: row.web_lo ?? 0,
        web_hi: row.web_hi ?? 0,
        web_alarm: row.state === "alarm",
        web_alarm_ack: false,
        alarm_reason: row.reason,
      }));
      this.reportMessage = `完成查詢，共 ${result.total} 筆，耗時 ${(performance.now() - startedAt).toFixed(1)} ms`;
    } catch (error) {
      this.reportMessage =
        error instanceof Error ? error.message : "報表查詢失敗";
    }
  }
  async changeReportPage(page: number): Promise<void> {
    this.channelPage = Math.max(1, Math.min(this.channelPageCount, page));
    await this.runReportQuery();
  }
  async exportCsv(): Promise<void> {
    if (this.session && this.db.available) {
      try {
        const result = await this.db.exportReport(
          this.session.token,
          this.reportFilter(false),
        );
        if (result && !result.canceled)
          this.reportMessage = `已匯出 ${result.rowCount} 筆：${result.filePath}`;
      } catch (error) {
        this.reportMessage =
          error instanceof Error ? error.message : "匯出失敗";
      }
      return;
    }
    const header = "通道,名稱,狀態,PV (°C),SV (°C),MIN,MAX,更新時間";
    const rows = this.filteredChannelRows.map((channel) =>
      [
        `CH${channel.id}`,
        channel.name,
        this.statusLabel(this.state(channel)),
        channel.pv ?? "",
        channel.sv,
        channel.min,
        channel.max,
        this.formatDateTime(channel.time),
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(","),
    );
    const metadata = [
      [
        "申請人",
        this.reportApplicant.trim() || this.session?.username || "",
        "開始時間",
        this.reportTimeBoundary(this.channelDateFrom, false),
      ],
      [
        "手機",
        this.reportPhone.trim(),
        "結束時間",
        this.reportTimeBoundary(this.channelDateTo, true),
      ],
      [
        "信箱",
        this.reportEmail.trim(),
        "報表時間",
        this.formatDateTime(new Date()),
      ],
      ["場域", this.reportSite.trim()],
    ].map((row) =>
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","),
    );
    const url = URL.createObjectURL(
      new Blob(
        [
          `\ufeff${header}\r\n${rows.join("\r\n")}\r\n\r\n${metadata.join("\r\n")}`,
        ],
        {
          type: "text/csv;charset=utf-8",
        },
      ),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `報表資料_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  private reportTimeBoundary(date: string, isEnd: boolean): string {
    return date ? `${date} ${isEnd ? "23:59:59" : "00:00:00"}` : "";
  }

  get trendChannels(): SensorChannel[] {
    const text = this.trendQuery.trim().toLocaleLowerCase("zh-TW");
    return this.channels.filter(
      (channel) =>
        (!text ||
          `CH${channel.id} ${channel.name}`
            .toLocaleLowerCase("zh-TW")
            .includes(text)) &&
        (this.trendStatus === "all" ||
          this.state(channel) === this.trendStatus),
    );
  }
  get selectedTrendChannels(): SensorChannel[] {
    return this.selectedTrendIds
      .map((id) => this.channels.find((channel) => channel.id === id))
      .filter((item): item is SensorChannel => Boolean(item));
  }
  toggleTrend(id: string): void {
    if (this.selectedTrendIds.includes(id))
      this.selectedTrendIds = this.selectedTrendIds.filter(
        (item) => item !== id,
      );
    else if (this.selectedTrendIds.length < 8)
      this.selectedTrendIds = [...this.selectedTrendIds, id];
  }
  trendPolyline(channel: SensorChannel): string {
    const bounds = this.trendBounds;
    return channel.history
      .slice(-this.trendPointLimit)
      .map((point) => {
        const position = this.trendPointPosition(
          point.time,
          point.value,
          bounds,
        );
        return `${position.x},${position.y}`;
      })
      .join(" ");
  }
  /** Plot area in viewBox units; margins grow with the chart font size. */
  get trendPlot(): {
    scale: number;
    left: number;
    right: number;
    height: number;
  } {
    const scale = this.fontSizes.trends / 100;
    return {
      scale,
      left: 20 + 48 * scale,
      right: 1000 - 28 * scale,
      height: 382 + 48 * scale,
    };
  }
  get trendBounds(): {
    minValue: number;
    maxValue: number;
    minTime: number;
    maxTime: number;
  } {
    const points = this.selectedTrendChannels.flatMap((channel) =>
      channel.history.slice(-this.trendPointLimit),
    );
    const values = points.map((point) => point.value).filter(Number.isFinite);
    const times = points
      .map((point) => Date.parse(point.time))
      .filter(Number.isFinite);
    const valueMin = values.length ? Math.min(...values) : 0;
    const valueMax = values.length ? Math.max(...values) : 1;
    const padding = Math.max(0.5, (valueMax - valueMin) * 0.1);
    const now = Date.now();
    const minTime = times.length ? Math.min(...times) : now - 60000;
    const rawMaxTime = times.length ? Math.max(...times) : now;
    return {
      minValue: valueMin - padding,
      maxValue: valueMax + padding,
      minTime,
      maxTime: rawMaxTime > minTime ? rawMaxTime : minTime + 1000,
    };
  }
  get trendYTicks(): Array<{ y: number; value: number }> {
    const bounds = this.trendBounds;
    return Array.from({ length: 6 }, (_, index) => ({
      y: 22 + index * 72,
      value:
        bounds.maxValue - index * ((bounds.maxValue - bounds.minValue) / 5),
    }));
  }
  get trendXTicks(): Array<{ x: number; label: string }> {
    const bounds = this.trendBounds;
    const { left, right } = this.trendPlot;
    return Array.from({ length: 6 }, (_, index) => {
      const time =
        bounds.minTime + index * ((bounds.maxTime - bounds.minTime) / 5);
      return {
        x: left + index * ((right - left) / 5),
        label: this.formatTime(new Date(time)),
      };
    });
  }
  trendPointPosition(
    time: string,
    value: number,
    bounds = this.trendBounds,
  ): { x: number; y: number } {
    const { left, right } = this.trendPlot;
    const timestamp = Date.parse(time);
    const x =
      left +
      (((Number.isFinite(timestamp) ? timestamp : bounds.maxTime) -
        bounds.minTime) /
        (bounds.maxTime - bounds.minTime)) *
        (right - left);
    const y =
      22 +
      ((bounds.maxValue - value) / (bounds.maxValue - bounds.minValue)) * 360;
    return {
      x: Math.max(left, Math.min(right, x)),
      y: Math.max(22, Math.min(382, y)),
    };
  }
  trendLatestPoint(
    channel: SensorChannel,
  ): { x: number; y: number; value: number } | null {
    const point = channel.history.slice(-this.trendPointLimit).at(-1);
    return point
      ? {
          ...this.trendPointPosition(point.time, point.value),
          value: point.value,
        }
      : null;
  }

  private async prepareAlertAudio(): Promise<AudioContext> {
    if (!this.alertAudio || this.alertAudio.state === "closed")
      this.alertAudio = new AudioContext();
    if (this.alertAudio.state === "suspended") await this.alertAudio.resume();
    if (this.alertAudio.state !== "running")
      throw new Error("音訊尚未啟用，請在設定按「測試聲音」");
    return this.alertAudio;
  }

  get hasActiveSoundAlarm(): boolean {
    // A device-side acknowledgement does not mean the physical condition
    // recovered, so it keeps sounding; a Dashboard release with a reason
    // (alarm_release) silences that channel for one minute or until it
    // recovers, whichever comes first.
    return Boolean(
      this.session &&
      this.alarmSnapshotReady &&
      (this.syncError ||
        this.channels.some(
          (channel) =>
            sensorState({ ...channel, web_alarm_ack: false }) !== "ok",
        )),
    );
  }

  private stopAlarmSound(): void {
    window.clearInterval(this.alarmSoundTimer);
    this.alarmSoundTimer = undefined;
    this.alarmSoundTimerMs = 0;
    this.audioGeneration++;
    for (const oscillator of this.activeAlarmOscillators) {
      try {
        oscillator.stop();
      } catch {
        /* Already stopped. */
      }
    }
    this.activeAlarmOscillators.clear();
  }

  private syncAlarmSound(): void {
    if (!this.soundEnabled || !this.hasActiveSoundAlarm) {
      this.stopAlarmSound();
      return;
    }
    const interval = this.soundIntervalSeconds * 1000;
    if (
      this.alarmSoundTimer !== undefined &&
      this.alarmSoundTimerMs === interval
    )
      return;
    const startImmediately = this.alarmSoundTimer === undefined;
    this.stopAlarmSound();
    const play = () => {
      if (!this.soundEnabled || !this.hasActiveSoundAlarm) {
        this.stopAlarmSound();
        return;
      }
      void this.playAlertSound(true)
        .then(() => {
          this.soundMessage = "";
        })
        .catch((error) => {
          this.soundMessage =
            error instanceof Error ? error.message : "警報聲播放失敗";
        });
    };
    this.alarmSoundTimerMs = interval;
    this.alarmSoundTimer = window.setInterval(play, interval);
    if (startImmediately) play();
  }

  private async playAlertSound(automatic = false): Promise<void> {
    if (
      !this.soundEnabled ||
      this.soundStarting ||
      this.activeAlarmOscillators.size ||
      (automatic && !this.hasActiveSoundAlarm)
    )
      return;
    const generation = this.audioGeneration;
    this.soundStarting = true;
    try {
      const context = await this.prepareAlertAudio();
      if (
        !this.soundEnabled ||
        generation !== this.audioGeneration ||
        (automatic && !this.hasActiveSoundAlarm)
      )
        return;
      for (const offset of [0, 0.3, 0.6]) {
        const oscillator = context.createOscillator(),
          gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.1, context.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(
          0.001,
          context.currentTime + offset + 0.18,
        );
        this.activeAlarmOscillators.add(oscillator);
        oscillator.onended = () => {
          this.activeAlarmOscillators.delete(oscillator);
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(context.currentTime + offset);
        oscillator.stop(context.currentTime + offset + 0.2);
      }
    } finally {
      this.soundStarting = false;
    }
  }

  private async sendAlertNotification(
    body: string,
    test = false,
  ): Promise<void> {
    if (!this.notificationsEnabled || !this.session) return;
    if (this.db.available) {
      const result = await this.db.notify(this.session.token, body, test);
      if (!result?.sent)
        throw new Error(
          result?.message || "通知介面未就緒，請重新啟動桌面程式",
        );
      return;
    }
    if (!("Notification" in window)) throw new Error("此瀏覽器不支援桌面通知");
    const permission = test
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== "granted")
      throw new Error(
        "尚未允許通知，請在設定按「測試通知」授權，或使用 Electron 桌面版",
      );
    new Notification(test ? "C62 通知測試" : "C62 異常警報", {
      body,
      silent: true,
    });
  }

  private async emitAlarm(body: string): Promise<void> {
    const results = await Promise.allSettled([
      this.sendAlertNotification(body),
    ]);
    this.alertMessage = results
      .filter((result) => result.status === "rejected")
      .map((result) =>
        result.reason instanceof Error
          ? result.reason.message
          : "異常提醒發送失敗",
      )
      .join("；");
  }

  async testSound(): Promise<void> {
    if (!this.soundEnabled) {
      this.testMessage = "請先啟用警報聲音";
      return;
    }
    try {
      await this.playAlertSound();
      this.testMessage = "已播放測試聲音，請確認喇叭音量";
    } catch (error) {
      this.testMessage =
        error instanceof Error ? error.message : "聲音測試失敗";
    }
  }
  async testNotification(): Promise<void> {
    if (!this.notificationsEnabled) {
      this.testMessage = "請先啟用桌面通知";
      return;
    }
    try {
      await this.sendAlertNotification(
        "桌面通知測試：收到此訊息表示通知可正常顯示。",
        true,
      );
      this.testMessage =
        "已送出測試通知；若未顯示，請檢查 Windows 通知與勿擾設定";
    } catch (error) {
      this.testMessage =
        error instanceof Error ? error.message : "通知測試失敗";
    }
  }

  async setAlertEnabled(
    key:
      | "alarms.sound_enabled"
      | "notifications.enabled"
      | "notifications.snapshot_stale_enabled",
    value: boolean,
  ): Promise<void> {
    if (this.alertSettingsSaving) return;
    this.alertSettingsSaving = true;
    this.testMessage = "";
    try {
      if (key === "alarms.sound_enabled" && value)
        void this.prepareAlertAudio().catch(() => {});
      if (await this.saveDatabaseSetting(key, value)) this.alertMessage = "";
    } finally {
      this.alertSettingsSaving = false;
    }
  }

  async saveSoundInterval(): Promise<void> {
    const seconds = Number(this.pendingSoundIntervalSeconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) {
      this.soundMessage = "警報聲間隔需為 1～300 的整數秒";
      return;
    }
    if (this.alertSettingsSaving) return;
    this.alertSettingsSaving = true;
    try {
      if (
        await this.saveDatabaseSetting("alarms.sound_interval_seconds", seconds)
      )
        this.soundMessage = "";
    } finally {
      this.alertSettingsSaving = false;
    }
  }

  async addAccount(): Promise<void> {
    const index = this.accounts.length + 1;
    const account: LocalAccount = {
      username: `operator${index}`,
      displayName: `操作員 ${index}`,
      password: "1234",
      role: "Operator",
      roleCode: "operator",
      scope: "CH001-CH100",
      active: true,
    };
    this.permissionFailed = false;
    try {
      if (this.session && this.db.available) {
        const rows = await this.db.saveUser(this.session.token, account);
        if (rows) this.accounts = rows;
      } else {
        this.accounts = [...this.accounts, account];
        this.saveAccounts();
      }
      this.permissionMessage = this.db.available
        ? "帳號已新增"
        : "已新增展示帳號（僅限瀏覽器預覽）";
    } catch (error) {
      this.permissionFailed = true;
      this.permissionMessage =
        error instanceof Error ? error.message : "新增帳號失敗";
    }
  }
  async removeAccount(account: LocalAccount): Promise<void> {
    if (account.username === "admin") return;
    if (this.session && this.db.available && account.id) {
      const rows = await this.db.deleteUser(this.session.token, account.id);
      if (rows) this.accounts = rows;
    } else {
      this.accounts = this.accounts.filter(
        (item) => item.username !== account.username,
      );
      this.saveAccounts();
    }
    this.permissionMessage = `帳號 ${account.username} 已刪除`;
  }
  private async loadDatabaseUsers(): Promise<void> {
    if (this.session) {
      const [rows, roles] = await Promise.all([
        this.db.listUsers(this.session.token),
        this.db.listRoles(this.session.token),
      ]);
      if (rows) this.accounts = rows;
      if (roles) this.accountRoles = roles;
    }
  }

  get accountEditingAvailable(): boolean {
    return (
      this.db.available &&
      Boolean(this.session?.permissions.includes("users.manage"))
    );
  }
  get accountAccessProtected(): boolean {
    return (
      this.accountDraft?.username === "admin" ||
      this.accountDraft?.username === this.session?.username
    );
  }
  get selectedAccountPermissions(): Array<{ code: string; label: string }> {
    return (
      this.accountRoles.find(
        (role) => role.code === this.accountDraft?.roleCode,
      )?.permissions ?? []
    );
  }
  accountPermissionSummary(account: LocalAccount): string {
    const role = this.accountRoles.find(
      (item) => item.code === account.roleCode,
    );
    return role
      ? role.permissions.length
        ? `${role.permissions.length} 項權限`
        : "無授權功能"
      : "依角色授權";
  }

  async openAccountEditor(
    account: LocalAccount,
    dialog: HTMLDialogElement,
  ): Promise<void> {
    if (this.accountDraft || this.accountSaving) return;
    this.accountEditorElement = dialog;
    this.accountDraft = {
      ...account,
      password: undefined,
      active: account.active !== false && account.active !== 0,
    };
    this.accountEditorError = "";
    this.permissionMessage = "";
    this.accountEditorLoading = true;
    window.setTimeout(() => {
      if (this.accountDraft && !dialog.open) dialog.showModal();
    }, 0);
    try {
      if (!this.accountEditingAvailable || !this.session)
        throw new Error(
          "請使用 Electron 桌面版及具備帳號管理權限的帳號進行編輯。",
        );
      const roles = await this.db.listRoles(this.session.token);
      if (!roles?.length) throw new Error("角色資料讀取失敗，請關閉視窗後重試");
      this.accountRoles = roles;
    } catch (error) {
      this.accountEditorError =
        error instanceof Error ? error.message : "角色資料讀取失敗";
      this.accountRoles = [];
    } finally {
      this.accountEditorLoading = false;
    }
  }

  closeAccountEditor(): void {
    if (this.accountSaving) return;
    this.accountEditorElement?.close();
    this.accountDraft = null;
  }

  async saveAccountEdit(): Promise<void> {
    if (
      !this.accountDraft ||
      !this.session ||
      !this.accountEditingAvailable ||
      this.accountSaving ||
      this.accountEditorLoading
    )
      return;
    const input = {
      ...this.accountDraft,
      displayName: this.accountDraft.displayName.trim(),
      phone: this.accountDraft.phone?.trim() ?? "",
      email: this.accountDraft.email?.trim() ?? "",
      scope: this.accountDraft.scope.trim() || "all",
    };
    if (!input.displayName) {
      this.accountEditorError = "請輸入顯示名稱";
      return;
    }
    if (!this.accountRoles.some((role) => role.code === input.roleCode)) {
      this.accountEditorError = "請選擇有效角色";
      return;
    }
    this.accountSaving = true;
    this.accountEditorError = "";
    try {
      const rows = await this.db.saveUser(this.session.token, input);
      if (!rows) throw new Error("帳號儲存介面尚未就緒");
      this.accounts = rows;
      if (input.username === this.session.username)
        this.session.displayName = input.displayName;
      this.permissionFailed = false;
      this.permissionMessage = `已儲存 ${input.username} 的帳號與權限設定`;
      this.accountSaving = false;
      this.closeAccountEditor();
    } catch (error) {
      this.accountEditorError =
        error instanceof Error ? error.message : "帳號儲存失敗";
    } finally {
      this.accountSaving = false;
    }
  }
  private loadAccounts(): LocalAccount[] {
    const defaults: LocalAccount[] = [
      {
        username: "admin",
        displayName: "系統管理員",
        password: "SGS@1234",
        role: "Administrator",
        roleCode: "administrator",
        scope: "全部通道",
      },
      {
        username: "operator1",
        displayName: "操作員 1",
        password: "1234",
        role: "Operator",
        roleCode: "operator",
        scope: "CH001-CH100",
      },
      {
        username: "guest",
        displayName: "訪客",
        password: "",
        role: "Guest",
        roleCode: "guest",
        scope: "唯讀",
      },
    ];
    try {
      return (
        (JSON.parse(
          localStorage.getItem("edge-angular-accounts") ?? "",
        ) as LocalAccount[]) || defaults
      );
    } catch {
      return defaults;
    }
  }
  private saveAccounts(): void {
    localStorage.setItem(
      "edge-angular-accounts",
      JSON.stringify(this.accounts),
    );
  }

  get databaseStatusLabel(): string {
    return {
      checking: "檢查中",
      connected: "已連線",
      disconnected: "連線異常",
      browser: "未連線（瀏覽器模式）",
    }[this.databaseState];
  }

  get canCleanupDatabase(): boolean {
    return (
      this.databaseState === "connected" &&
      !this.databaseCleaning &&
      Boolean(this.session?.permissions.includes("settings.manage"))
    );
  }

  async checkDatabaseConnection(): Promise<void> {
    if (!this.db.available) {
      this.databaseState = "browser";
      return;
    }
    if (this.databaseChecking || this.databaseCleaning) return;
    this.databaseChecking = true;
    let timeout: number | undefined;
    try {
      const status = await Promise.race([
        this.db.status(),
        new Promise<never>((_resolve, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error("資料庫連線檢查逾時")),
            5000,
          );
        }),
      ]);
      if (!status) throw new Error("資料庫介面尚未就緒，請重新啟動桌面程式");
      this.databaseState = status.connected ? "connected" : "disconnected";
      this.databaseCheckedAt = status.checkedAt;
      this.databaseError = status.error ?? "";
    } catch (error) {
      this.databaseState = "disconnected";
      this.databaseCheckedAt = new Date().toISOString();
      this.databaseError =
        error instanceof Error ? error.message : "無法連線 SQLite";
    } finally {
      window.clearTimeout(timeout);
      this.databaseChecking = false;
    }
  }

  async cleanupDatabase(): Promise<void> {
    if (!this.canCleanupDatabase || !this.session) return;
    this.databaseCleaning = true;
    this.databaseCleanupMessage = "";
    this.databaseCleanupFailed = false;
    try {
      const result = await this.db.cleanupHistory(this.session.token);
      if (!result) throw new Error("資料庫清理介面尚未就緒");
      if (result.canceled) {
        this.databaseCleanupMessage = "已取消清理，資料未變更。";
        return;
      }
      this.channelPage = 1;
      this.reportRows = [];
      this.reportTotal = 0;
      this.reportMessage = "";
      this.databaseCleanupMessage = `已清理 ${result.readingsDeleted} 筆感測歷史、${result.logsDeleted} 筆同步紀錄。${result.warning || "已完成空間整理。"} 自動同步將繼續新增資料。`;
    } catch (error) {
      this.databaseCleanupFailed = true;
      this.databaseCleanupMessage =
        error instanceof Error ? error.message : "清理失敗，請稍後再試";
    } finally {
      this.databaseCleaning = false;
      await this.checkDatabaseConnection();
    }
  }

  get fontSizesAreDefault(): boolean {
    return FONT_SIZE_AREAS.every(
      ({ key }) => this.fontSizes[key] === DEFAULT_FONT_SIZES[key],
    );
  }
  setFontSize(area: FontSizeArea, percent: number): Promise<void> {
    return this.saveFontSizes({ ...this.fontSizes, [area]: percent });
  }
  resetFontSizes(): Promise<void> {
    return this.saveFontSizes({ ...DEFAULT_FONT_SIZES });
  }
  private async saveFontSizes(sizes: FontSizes): Promise<void> {
    if (this.fontSizeSaving) return;
    const previous = this.fontSizes;
    this.fontSizes = sizes;
    applyFontSizes(sizes);
    this.fontSizeSaving = true;
    this.fontSizeMessage = "";
    this.fontSizeFailed = !(await this.saveDatabaseSetting(
      "ui.font_sizes",
      sizes,
    ));
    this.fontSizeSaving = false;
    if (this.fontSizeFailed) {
      this.fontSizes = previous;
      applyFontSizes(previous);
    }
    this.fontSizeMessage = this.settingsMessage || "字級儲存失敗";
  }

  get brandTitlesAreDefault(): boolean {
    return [this.brandTitles, this.brandTitlesDraft].every(
      ({ title, subtitle }) =>
        title === DEFAULT_BRAND_TITLES.title &&
        subtitle === DEFAULT_BRAND_TITLES.subtitle,
    );
  }
  resetBrandTitles(): Promise<void> {
    this.brandTitlesDraft = { ...DEFAULT_BRAND_TITLES };
    return this.saveBrandTitles();
  }
  async saveBrandTitles(): Promise<void> {
    if (this.brandTitlesSaving) return;
    const clean = (text: string) => text.trim().replace(/\s+/g, " ");
    const titles = {
      title: clean(this.brandTitlesDraft.title),
      subtitle: clean(this.brandTitlesDraft.subtitle),
    };
    if (!titles.title) {
      this.brandTitlesFailed = true;
      this.brandTitlesMessage = "請輸入專案名稱";
      return;
    }
    this.brandTitlesSaving = true;
    this.brandTitlesMessage = "";
    this.brandTitlesFailed = !(await this.saveDatabaseSetting(
      "ui.titles",
      titles,
    ));
    this.brandTitlesSaving = false;
    if (!this.brandTitlesFailed) this.brandTitlesDraft = { ...titles };
    this.brandTitlesMessage = this.settingsMessage || "標題儲存失敗";
  }
  async selectLogo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Lets the same file be picked again after a failure.
    input.value = "";
    if (!file || this.logoSaving) return;
    this.logoSaving = true;
    this.logoMessage = "";
    try {
      await this.storeLogo(await readLogoFile(file));
    } catch (error) {
      this.logoFailed = true;
      this.logoMessage =
        error instanceof Error ? error.message : "Logo 儲存失敗";
    } finally {
      this.logoSaving = false;
    }
  }
  async resetLogo(): Promise<void> {
    if (this.logoSaving) return;
    this.logoSaving = true;
    this.logoMessage = "";
    try {
      await this.storeLogo("");
    } finally {
      this.logoSaving = false;
    }
  }
  private async storeLogo(logo: string): Promise<void> {
    this.logoFailed = !(await this.saveDatabaseSetting("ui.logo", logo));
    this.logoMessage = this.settingsMessage || "Logo 儲存失敗";
  }

  async saveDatabaseSetting(key: string, value: unknown): Promise<boolean> {
    if (!this.session) return false;
    if (!this.db.available) {
      if (
        ![
          "alarms.sound_enabled",
          "alarms.sound_interval_seconds",
          "notifications.enabled",
          "notifications.snapshot_stale_enabled",
          "api.poll_interval_ms",
          "alarms.release_reasons",
          "ui.font_sizes",
          "ui.titles",
          "ui.logo",
        ].includes(key)
      )
        return false;
      this.appSettings[key] = value;
      this.applyDatabaseSettings();
      this.settingsMessage = "設定已套用（瀏覽器預覽，僅本次有效）";
      return true;
    }
    this.settingsMessage = "";
    try {
      const settings = await this.db.saveSetting(
        this.session.token,
        key,
        value,
      );
      if (settings) {
        this.appSettings = settings;
        this.applyDatabaseSettings();
        this.settingsMessage = "設定已儲存";
        return true;
      }
    } catch (error) {
      this.settingsMessage =
        error instanceof Error ? error.message : "設定儲存失敗";
    }
    return false;
  }
}
