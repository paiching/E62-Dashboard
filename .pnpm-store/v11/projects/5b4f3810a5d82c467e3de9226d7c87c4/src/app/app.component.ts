import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { AlarmFilter, LocalAccount, SensorChannel, SensorState, UserSession, ViewKey, sensorState } from './dashboard.model';
import { createMockChannels } from './mock-data';
import { DatabaseMenu, DatabaseService, ReportFilter, ReportRow } from './database.service';
import { MaterialSvgIconDirective, registerDashboardMaterialIcons } from './material-icons';

interface NavItem { key: ViewKey; label: string; icon: string; }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MatIconModule, MaterialSvgIconDirective],
  templateUrl: './app.component.html',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly Math = Math;
  navItems: NavItem[] = [
    { key: 'overview', label: '儀錶板', icon: 'speed' },
    { key: 'trends', label: '趨勢圖', icon: 'trending_up' },
    { key: 'channels', label: '報表資料', icon: 'table_view' },
    { key: 'alarms', label: '警報中心', icon: 'notifications_active' },
    { key: 'permissions', label: '帳號權限', icon: 'verified_user' },
    { key: 'account', label: '測試', icon: 'science' },
    { key: 'settings', label: '設定', icon: 'settings' },
  ];
  readonly viewTitles: Record<ViewKey, string> = {
    overview: '儀錶板', trends: '即時趨勢圖', channels: '報表資料', alarms: '警報中心',
    permissions: '帳號權限', account: '系統測試', settings: '系統設定',
  };
  readonly pageSizes = [25, 50, 100];
  readonly pointOptions = [30, 60, 120, 300, 500];
  readonly seriesColors = ['#2364aa', '#f28e2b', '#16856b', '#c53b4b', '#7a5dc7', '#9a604e', '#087e8b', '#c77d10'];

  session: UserSession | null = null;
  appSettings: Record<string, unknown> = {};
  databasePath = '瀏覽器開發模式（Electron 啟動後使用 SQLite）';
  syncError = '';
  reportMessage = '';
  username = localStorage.getItem('edge-angular-last-username') ?? '';
  password = '';
  loginError = '';
  view: ViewKey = 'overview';
  collapsed = localStorage.getItem('edge-angular-sidebar-collapsed') === '1';
  mobileOpen = false;
  showDashboardStatus = localStorage.getItem('edge-angular-show-status') !== '0';
  clock = new Date();
  channels = createMockChannels();
  lastUpdated = new Date();
  pollIntervalMs = 3000;
  private dataTimer = window.setInterval(() => this.refreshData(), this.pollIntervalMs);
  private clockTimer = window.setInterval(() => this.clock = new Date(), 1000);

  overviewFilter: 'all' | SensorState = 'all';
  overviewQuery = '';
  overviewPage = 0;
  displayMode: 'compact' | 'detailed' | 'fullscreen' = 'compact';
  refreshDialogOpen = false;
  pendingRefreshSeconds = 3;
  selectedSensor: SensorChannel | null = null;
  editLow = 0;
  editHigh = 0;
  modalMessage = '';

  alarmFilter: AlarmFilter = 'all';
  channelQuery = '';
  channelStatus: 'all' | SensorState = 'all';
  channelDateFrom = '';
  channelDateTo = '';
  channelPage = 1;
  channelPageSize = 25;
  reportRows: SensorChannel[] = [];
  reportTotal = 0;
  trendQuery = '';
  trendStatus: 'all' | SensorState = 'all';
  trendPointLimit = 120;
  trendPaused = false;
  selectedTrendIds = this.channels.slice(0, 4).map((channel) => channel.id);
  testMessage = '';
  permissionMessage = '';
  accounts: LocalAccount[] = this.loadAccounts();

  constructor(private readonly db: DatabaseService, iconRegistry: MatIconRegistry, sanitizer: DomSanitizer) {
    registerDashboardMaterialIcons(iconRegistry, sanitizer);
  }

  async ngOnInit(): Promise<void> {
    const bootstrap = await this.db.bootstrap();
    if (bootstrap) {
      this.appSettings = bootstrap.settings;
      this.databasePath = bootstrap.databasePath;
      this.applyDatabaseSettings();
    }
  }

  ngOnDestroy(): void {
    window.clearInterval(this.dataTimer);
    window.clearInterval(this.clockTimer);
  }

  async login(): Promise<void> {
    if (this.db.available) {
      try {
        const result = await this.db.login(this.username, this.password);
        if (!result) throw new Error('SQLite Bridge 尚未就緒');
        this.session = result.session;
        this.navItems = result.menus.map((menu: DatabaseMenu) => ({ key: menu.key, label: menu.label, icon: menu.icon }));
        this.appSettings = result.settings;
        this.applyDatabaseSettings();
        this.view = (String(this.appSettings['ui.default_view'] ?? 'overview') as ViewKey);
        this.loginError = '';
        localStorage.setItem('edge-angular-last-username', result.session.username);
        this.password = '';
        await this.refreshData();
        if (result.session.permissions.includes('users.manage')) await this.loadDatabaseUsers();
        return;
      } catch (error) {
        this.loginError = error instanceof Error ? error.message : '登入失敗';
        return;
      }
    }
    const users: Record<string, { password: string; displayName: string; role: string }> = {
      admin: { password: 'SGS@1234', displayName: '系統管理員', role: 'Administrator' },
      operator1: { password: '1234', displayName: '操作員 1', role: 'Operator' },
      guest: { password: '', displayName: '訪客', role: 'Guest' },
    };
    const account = users[this.username.trim().toLowerCase()];
    if (!account || account.password !== this.password) {
      this.loginError = '帳號或密碼錯誤';
      return;
    }
    this.loginError = '';
    localStorage.setItem('edge-angular-last-username', this.username.trim().toLowerCase());
    this.session = { token: 'browser-demo', username: this.username.trim().toLowerCase(), displayName: account.displayName, role: account.role, roleCode: account.role.toLowerCase(), permissions: ['dashboard.view','trends.view','reports.view','reports.export','alarms.view','alarms.ack','users.manage','settings.manage','tests.run'] };
    this.password = '';
  }

  logout(): void { if (this.session && this.db.available) void this.db.logout(this.session.token); this.session = null; this.view = 'overview'; }
  navigate(view: ViewKey): void { this.view = view; this.mobileOpen = false; if (view === 'channels') void this.runReportQuery(); }
  toggleSidebar(): void {
    this.collapsed = !this.collapsed;
    localStorage.setItem('edge-angular-sidebar-collapsed', this.collapsed ? '1' : '0');
  }
  toggleDashboardStatus(): void {
    localStorage.setItem('edge-angular-show-status', this.showDashboardStatus ? '1' : '0');
  }

  async refreshData(): Promise<void> {
    if (this.trendPaused) return;
    const previous = new Map(this.channels.map((channel) => [channel.id, channel.history]));
    try {
      if (this.session && this.db.available && this.appSettings['data.mode'] === 'live') {
        const synced = await this.db.syncApi(this.session.token);
        if (synced) this.channels = synced.snapshot.channels;
      } else {
        this.channels = createMockChannels().map((channel) => ({ ...channel, history: previous.get(channel.id) ?? channel.history }));
        if (this.session && this.db.available) {
          await this.db.ingestSnapshot(this.session.token, { time: new Date().toISOString(), channels: this.channels }, 'mock');
        }
      }
      this.syncError = '';
    } catch (error) {
      this.syncError = error instanceof Error ? error.message : '資料同步失敗';
    }
    this.lastUpdated = new Date();
    if (this.selectedSensor) this.selectedSensor = this.channels.find((item) => item.id === this.selectedSensor?.id) ?? null;
  }

  private applyDatabaseSettings(): void {
    this.pollIntervalMs = Math.max(1000, Number(this.appSettings['api.poll_interval_ms'] ?? 3000));
    this.showDashboardStatus = this.appSettings['dashboard.show_status'] !== false;
    window.clearInterval(this.dataTimer);
    this.dataTimer = window.setInterval(() => void this.refreshData(), this.pollIntervalMs);
  }

  get normalCount(): number { return this.channels.filter((channel) => this.state(channel) === 'ok').length; }
  get alarmCount(): number { return this.channels.filter((channel) => this.state(channel) === 'alarm').length; }
  get errorCount(): number { return this.channels.filter((channel) => this.state(channel) === 'error').length; }
  state(channel: SensorChannel): SensorState { return sensorState(channel); }
  statusLabel(state: SensorState): string { return ({ ok: '正常', alarm: '警報', error: '斷線' })[state]; }
  formatValue(value: number | null): string { return value === null || !Number.isFinite(value) ? '--' : value.toFixed(1); }
  formatTime(value: string | Date): string { return new Date(value).toLocaleTimeString('zh-TW', { hour12: false }); }
  formatDateTime(value: string | Date): string { return new Date(value).toLocaleString('zh-TW', { hour12: false }); }

  get filteredOverview(): SensorChannel[] {
    const text = this.overviewQuery.trim().toLocaleLowerCase('zh-TW');
    return this.channels.filter((channel) =>
      (!text || `CH${channel.id} ${channel.name}`.toLocaleLowerCase('zh-TW').includes(text)) &&
      (this.overviewFilter === 'all' || this.state(channel) === this.overviewFilter));
  }
  get overviewPages(): number[] { return Array.from({ length: Math.max(1, Math.ceil(this.filteredOverview.length / 50)) }, (_, index) => index); }
  get visibleSensors(): SensorChannel[] { return this.filteredOverview.slice(this.overviewPage * 50, (this.overviewPage + 1) * 50); }
  selectOverviewFilter(filter: 'all' | SensorState): void { this.overviewFilter = filter; this.overviewPage = 0; }
  showAlarms(filter: AlarmFilter): void { this.alarmFilter = filter; this.navigate('alarms'); }
  openSensor(channel: SensorChannel): void {
    this.selectedSensor = channel; this.editLow = channel.web_lo; this.editHigh = channel.web_hi; this.modalMessage = '';
  }
  saveSensorLimits(): void {
    if (!this.selectedSensor || this.editLow >= this.editHigh) { this.modalMessage = '下限必須小於上限'; return; }
    this.channels = this.channels.map((channel) => channel.id === this.selectedSensor?.id ? { ...channel, web_lo: this.editLow, web_hi: this.editHigh } : channel);
    this.selectedSensor = this.channels.find((channel) => channel.id === this.selectedSensor?.id) ?? null;
    this.modalMessage = '感應器設定已儲存於本機展示資料';
  }
  acknowledgeAlarm(): void {
    if (!this.selectedSensor) return;
    this.channels = this.channels.map((channel) => channel.id === this.selectedSensor?.id ? { ...channel, web_alarm_ack: true } : channel);
    this.selectedSensor = this.channels.find((channel) => channel.id === this.selectedSensor?.id) ?? null;
    this.modalMessage = '警報已確認';
  }
  async setDisplayMode(mode: 'compact' | 'detailed' | 'fullscreen', stage?: HTMLElement): Promise<void> {
    if (mode === 'fullscreen' && stage?.requestFullscreen) { await stage.requestFullscreen(); this.displayMode = 'fullscreen'; return; }
    if (document.fullscreenElement) await document.exitFullscreen();
    this.displayMode = mode;
  }
  applyRefreshRate(): void {
    this.pollIntervalMs = this.pendingRefreshSeconds * 1000;
    window.clearInterval(this.dataTimer);
    this.dataTimer = window.setInterval(() => this.refreshData(), this.pollIntervalMs);
    this.refreshDialogOpen = false;
  }

  get alarms(): SensorChannel[] {
    return this.channels.filter((channel) => this.state(channel) !== 'ok' && (this.alarmFilter === 'all' || this.state(channel) === this.alarmFilter));
  }
  get allAbnormalCount(): number { return this.alarmCount + this.errorCount; }

  get filteredChannelRows(): SensorChannel[] {
    if (this.db.available && this.session) return this.reportRows;
    const text = this.channelQuery.trim().toLocaleLowerCase('zh-TW');
    return this.channels.filter((channel) => (!text || `CH${channel.id} ${channel.name}`.toLocaleLowerCase('zh-TW').includes(text)) && (this.channelStatus === 'all' || this.state(channel) === this.channelStatus));
  }
  get channelPageCount(): number { return Math.max(1, Math.ceil((this.db.available && this.session ? this.reportTotal : this.filteredChannelRows.length) / this.channelPageSize)); }
  get channelRows(): SensorChannel[] {
    if (this.db.available && this.session) return this.reportRows;
    const page = Math.min(this.channelPage, this.channelPageCount);
    return this.filteredChannelRows.slice((page - 1) * this.channelPageSize, page * this.channelPageSize);
  }
  resetChannelFilters(): void { this.channelQuery = ''; this.channelStatus = 'all'; this.channelDateFrom = ''; this.channelDateTo = ''; this.channelPage = 1; void this.runReportQuery(); }
  private reportFilter(includePage = true): ReportFilter {
    return { query: this.channelQuery, state: this.channelStatus, from: this.channelDateFrom, to: this.channelDateTo, limit: includePage ? this.channelPageSize : undefined, offset: includePage ? (this.channelPage - 1) * this.channelPageSize : undefined };
  }
  async runReportQuery(): Promise<void> {
    if (!this.session || !this.db.available) return;
    try {
      const result = await this.db.queryReport(this.session.token, this.reportFilter());
      if (!result) return;
      this.reportTotal = result.total;
      this.reportRows = result.rows.map((row: ReportRow) => ({
        id: row.id, name: row.name, pv: row.pv, sv: row.sv ?? 0, st: row.state === 'error' ? 1 : row.state === 'alarm' ? 2 : 0,
        time: row.time, history: [], min: row.pv ?? 0, max: row.pv ?? 0, avg: row.pv ?? 0, count: 1,
        web_lo: row.web_lo ?? 0, web_hi: row.web_hi ?? 0, web_alarm: row.state === 'alarm', web_alarm_ack: false,
      }));
      this.reportMessage = `已從 SQLite 查詢 ${result.total} 筆歷史資料`;
    } catch (error) { this.reportMessage = error instanceof Error ? error.message : '報表查詢失敗'; }
  }
  async changeReportPage(page: number): Promise<void> { this.channelPage = Math.max(1, Math.min(this.channelPageCount, page)); await this.runReportQuery(); }
  async exportCsv(): Promise<void> {
    if (this.session && this.db.available) {
      try {
        const result = await this.db.exportReport(this.session.token, this.reportFilter(false));
        if (result && !result.canceled) this.reportMessage = `已匯出 ${result.rowCount} 筆：${result.filePath}`;
      } catch (error) { this.reportMessage = error instanceof Error ? error.message : '匯出失敗'; }
      return;
    }
    const header = '通道,名稱,狀態,PV (°C),SV (°C),MIN,MAX,更新時間';
    const rows = this.filteredChannelRows.map((channel) => [
      `CH${channel.id}`, channel.name, this.statusLabel(this.state(channel)), channel.pv ?? '', channel.sv,
      channel.min, channel.max, this.formatDateTime(channel.time),
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));
    const url = URL.createObjectURL(new Blob([`\ufeff${header}\r\n${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `報表資料_${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  get trendChannels(): SensorChannel[] {
    const text = this.trendQuery.trim().toLocaleLowerCase('zh-TW');
    return this.channels.filter((channel) => (!text || `CH${channel.id} ${channel.name}`.toLocaleLowerCase('zh-TW').includes(text)) && (this.trendStatus === 'all' || this.state(channel) === this.trendStatus));
  }
  get selectedTrendChannels(): SensorChannel[] { return this.selectedTrendIds.map((id) => this.channels.find((channel) => channel.id === id)).filter((item): item is SensorChannel => Boolean(item)); }
  toggleTrend(id: string): void {
    if (this.selectedTrendIds.includes(id)) this.selectedTrendIds = this.selectedTrendIds.filter((item) => item !== id);
    else if (this.selectedTrendIds.length < 8) this.selectedTrendIds = [...this.selectedTrendIds, id];
  }
  trendPolyline(channel: SensorChannel): string {
    const selected = this.selectedTrendChannels.flatMap((item) => item.history.map((point) => point.value));
    const min = Math.min(...selected) - 1; const max = Math.max(...selected) + 1; const range = Math.max(1, max - min);
    return channel.history.slice(-this.trendPointLimit).map((point, index, points) => `${68 + index * (904 / Math.max(1, points.length - 1))},${22 + ((max - point.value) / range) * 360}`).join(' ');
  }

  testSound(): void {
    const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain();
    oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 880; gain.gain.value = .08; oscillator.start(); oscillator.stop(context.currentTime + .25); this.testMessage = '測試聲音已播放';
  }
  async testNotification(): Promise<void> {
    if (!('Notification' in window)) { this.testMessage = '此環境不支援通知'; return; }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') { new Notification('E62 Angular Dashboard', { body: '測試通知正常' }); this.testMessage = '測試通知已發送'; }
    else this.testMessage = '通知權限未開啟';
  }

  async addAccount(): Promise<void> {
    const index = this.accounts.length + 1;
    const account: LocalAccount = { username: `operator${index}`, displayName: `操作員 ${index}`, password: '1234', role: 'Operator', roleCode: 'operator', scope: 'CH001-CH100', active: true };
    if (this.session && this.db.available) {
      const rows = await this.db.saveUser(this.session.token, account); if (rows) this.accounts = rows;
    } else { this.accounts = [...this.accounts, account]; this.saveAccounts(); }
    this.permissionMessage = '帳號已寫入 SQLite';
  }
  async removeAccount(account: LocalAccount): Promise<void> {
    if (account.username === 'admin') return;
    if (this.session && this.db.available && account.id) {
      const rows = await this.db.deleteUser(this.session.token, account.id); if (rows) this.accounts = rows;
    } else { this.accounts = this.accounts.filter((item) => item.username !== account.username); this.saveAccounts(); }
    this.permissionMessage = `帳號 ${account.username} 已刪除`;
  }
  private async loadDatabaseUsers(): Promise<void> { if (this.session) { const rows = await this.db.listUsers(this.session.token); if (rows) this.accounts = rows; } }
  private loadAccounts(): LocalAccount[] {
    const defaults: LocalAccount[] = [
      { username: 'admin', displayName: '系統管理員', password: 'SGS@1234', role: 'Administrator', roleCode: 'administrator', scope: '全部通道' },
      { username: 'operator1', displayName: '操作員 1', password: '1234', role: 'Operator', roleCode: 'operator', scope: 'CH001-CH100' },
      { username: 'guest', displayName: '訪客', password: '', role: 'Guest', roleCode: 'guest', scope: '唯讀' },
    ];
    try { return JSON.parse(localStorage.getItem('edge-angular-accounts') ?? '') as LocalAccount[] || defaults; } catch { return defaults; }
  }
  private saveAccounts(): void { localStorage.setItem('edge-angular-accounts', JSON.stringify(this.accounts)); }

  async saveDatabaseSetting(key: string, value: unknown): Promise<void> {
    if (!this.session || !this.db.available) return;
    try {
      const settings = await this.db.saveSetting(this.session.token, key, value);
      if (settings) { this.appSettings = settings; this.applyDatabaseSettings(); this.reportMessage = '設定已寫入 SQLite'; }
    } catch (error) { this.reportMessage = error instanceof Error ? error.message : '設定儲存失敗'; }
  }
}
