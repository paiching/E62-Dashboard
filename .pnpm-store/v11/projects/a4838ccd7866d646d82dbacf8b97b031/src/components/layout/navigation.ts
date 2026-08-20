import {
  BellRing,
  FlaskConical,
  FileSpreadsheet,
  Gauge,
  Settings,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import type { ViewKey } from '../../types/dashboard';

export const navigationItems = [
  { key: 'overview' as ViewKey, label: '儀錶板', icon: Gauge },
  { key: 'trends' as ViewKey, label: '趨勢圖', icon: TrendingUp },
  { key: 'channels' as ViewKey, label: '報表資料', icon: FileSpreadsheet },
  { key: 'alarms' as ViewKey, label: '警報中心', icon: BellRing },
  { key: 'permissions' as ViewKey, label: '帳號權限', icon: ShieldCheck },
  { key: 'account' as ViewKey, label: '測試', icon: FlaskConical },
  { key: 'settings' as ViewKey, label: '設定', icon: Settings },
];
