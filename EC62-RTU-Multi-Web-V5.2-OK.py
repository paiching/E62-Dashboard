#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
E62/C62 溫度監控（CH01~CH30 + CH Number 1~30 可設定 + ERR Event Log + 警報解除紀錄）
V5.0H WEB Mobile/Desktop — Bilingual 中文/English + Email / LINE 密碼保護 + 多 LAN IP / Port 手動設定 + CH Number 1~30
V5.0H 修正：Web Hi / Low 警戒值大小寫統一、Config 儲存/載入、重新開機自動套用、CH01~CH30 同步
USB CONNECT FIX 2026-08-11：USB 掃描 fallback + pymodbus device_id/slave/unit 相容 + USB/RTU 狀態分離
-------------------------------------------------------------------------------
✅ 本版修正重點
1) 背景執行緒不直接更新 Tkinter GUI，統一使用 safe_gui()
2) monitor_ports() 不直接呼叫 GUI 更新，避免 main thread is not in main loop
3) exit_program() 加入 closing 旗標，避免離開後 after callback 繼續執行
4) _read_holding() 相容 pymodbus v2/v3：unit / slave
5) connect() 避免重複排程 reconnect
6) 設定上鎖/解鎖、通訊參數、CH 新增/移除、PV/SV log 格式維持原邏輯
7) V3.7C：關閉 pymodbus console 警告，COM 被占用時先偵測並跳過
8) V3.8Q：取消趨勢頻率選單，改為滑鼠操作趨勢圖
9) V3.8P：MAX/MIN 歸零只重設統計起點，不清除趨勢圖、CSV、PDF、Trend_History
10) V3.8R：取消滑鼠滾輪縮放與拖曳平移，避免趨勢圖左右移動不穩；保留「自動範圍」與雙擊復原
11) V3.8U：新增趨勢圖設定存檔，可保存 CH 勾選、保留筆數、自動更新與自動範圍狀態
12) V3.8V：CONFIG / PV / Error / Trend_History / 報表全部集中於共用資料夾 C:\\SGS\\EC62
13) V3.8Y：三組功能鍵改為重疊浮動顯示，避免展開後太下方
13) V5.2E：修正趨勢圖下方 Ribbon 功能鍵被圖表蓋住；Ribbon 固定底部，圖表固定高度。
14) V5.2F：Ribbon 功能鍵固定在趨勢圖上方；下拉選單優先向下展開。
15) V5.2G：Ribbon 功能鍵固定在趨勢圖上方，並縮小按鍵高度、字體、間距。
13) V3.8X：趨勢圖下方按鍵改為三組收合功能鍵，避免按鍵太寬或消失
14) V3.8AF：離開鍵移到主功能列，變成「報表功能 / 設定功能 / 趨勢功能 / 離開」
14) V3.8AE：取消範圍/重畫/放大/縮小按鍵，改用滑鼠左鍵框選放大、右鍵縮小、雙擊全圖
14) V3.8AC：存檔與列印視窗加入格式、路徑、取樣日期、開始/結束時間確認
14) V3.8AB：修正 Sampling Start / Sampling End 換行、200:00 時間、CSV/PDF 嚴格依取樣時間篩選
15) V3.9 WEB：新增內建 Web Server，瀏覽器可看即時 PV/SV、狀態與 JSON API
16) V4.0 WEB Mobile/Desktop：手機優先響應式 Dashboard、即時趨勢小圖、MAX/MIN、PWA manifest、LAN 網址顯示
17) V4.1 WEB：Web 增加 MAX/MIN 清除、Web MAX/MIN 警戒設定、即時數值補強與手機操作按鍵
18) V4.1B WEB：手機 Web 增加警報聲、開啟聲音、靜音、測試聲音
19) V4.2 WEB：新增 Email / LINE 警報通知、測試通知、Recovery 與防重複發送
20) V4.3 WEB：Email / LINE 設定需密碼解鎖才顯示
21) V4.3B WEB：Web 頁面 LAN 網址未解鎖時隱藏，解鎖後才顯示
22) V4.3C WEB：Header 操作功能列移至第 2 行
23) V4.4 WEB：SETTING / CONFIG PANEL 加寬，並可用中間分隔線向左拉寬
24) V4.5 WEB：新增中文 / English 一鍵切換，GUI 與 Web Dashboard 同步切換並儲存設定
25) V4.6 WEB：新增 LAN IP 手動設定與 Web Port 可自行設定（預設 8080），手機需與電腦同網段
26) V4.7 WEB：LAN IP 可輸入多組，Web Server 固定監聽 0.0.0.0，畫面同時顯示多個 LAN 網址
27) V4.7A WEB：測試聲音 / 測試通知增加英文，並移至下一行顯示
28) V4.8 WEB：新增 CH Number 設定，可設定 1~30CH，GUI / Web / Trend / Log 同步更新
29) V4.9B WEB：新增 ERR Event Log，Web 超溫/通訊 ERR 發生瞬間自動記錄，警報解除後畫面移除，並寫入 YYYYMMDD_ERROR.txt
22) V4.3C WEB：首頁 Header 改雙排版，輸入密碼/重新連線等功能移至下一行

⚠️ Log 格式不變：PV Log = [{id,time,value,st}, ...]
⚠️ SV Log 格式不變：SV Log = [{id,time,value}, ...]
"""

import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from pymodbus.client import ModbusSerialClient
import serial
import serial.tools.list_ports
import threading
import time
import os
import json
import csv
import glob
import calendar
import platform
import subprocess
import logging
import socket
import webbrowser
import sys
import math
import smtplib
import ssl
from email.message import EmailMessage
from urllib import request as urlrequest
from urllib import parse as urlparse_lib
from urllib import error as urlerror
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from datetime import datetime, timezone, timedelta

def _demo_sensor_count(argv):
    """Parse ``--demo [count]`` without affecting the normal acquisition mode."""
    try:
        index = argv.index("--demo")
    except ValueError:
        return 0
    if index + 1 < len(argv):
        try:
            return max(1, min(2000, int(argv[index + 1])))
        except (TypeError, ValueError):
            pass
    return 6


DEMO_SENSOR_COUNT = _demo_sensor_count(sys.argv)
DEMO_MODE = DEMO_SENSOR_COUNT > 0

# ===== 關閉 pymodbus/serial console 警告 =====
# 避免一直顯示：No response received after 1 retries / could not open port COMx
logging.getLogger("pymodbus").setLevel(logging.CRITICAL)
logging.getLogger("pymodbus.logging").setLevel(logging.CRITICAL)
logging.getLogger("serial").setLevel(logging.CRITICAL)

# ===== 內嵌趨勢圖 matplotlib =====
# 注意：使用 TkAgg 內嵌在 Tkinter，不會跳出獨立 matplotlib 視窗。
try:
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
    MATPLOTLIB_OK = True
except Exception:
    Figure = None
    FigureCanvasTkAgg = None
    MATPLOTLIB_OK = False


# ===== 預設暫存器位址（fallback）=====
PV_ADDR_DEFAULT = 0x40
SV_ADDR_DEFAULT = 0x41
MAX_CHANNELS = 30
DEFAULT_CHANNEL_COUNT = 1

# ===== CH01~CH30 對應 Unit ID 1~30 =====
# PV/SV 位址依 E62/C62 規則遞增
DEFAULT_ADDRS = {
    i: {
        "PV": 64 * i,
        "SV": 64 * i + 1,
    }
    for i in range(1, MAX_CHANNELS + 1)
}

# ===== 密碼 =====
DEFAULT_PASSWORD = "SGS@1234"
MAX_FAILS = 3
LOCKOUT_SECONDS = 30

# ===== 偏好設定 =====
PREFERRED_DEV = "/dev/USB01"      # Linux 可用 symlink，沒有可留空 ""
USB_ONLY = True
PREFER_BY_ID_SYMLINK = True

KNOWN_USB_BRANDS = (
    "FTDI", "USB-SERIAL", "USB Serial", "Prolific", "CH340", "CP210",
    "Silicon Labs", "wch.cn", "QinHeng", "FT232", "FT2232", "CDC", "USB-UART"
)

# ===== 通訊參數預設 =====
DEFAULT_SERIAL = {
    "baudrate": 19200,
    "parity": "E",       # N/E/O
    "stopbits": 1,       # 1/2
    "bytesize": 8,       # 7/8
    "timeout": 2.0,      # seconds
}


# =========================================================
# 工具函式
# =========================================================
def user_path(default_path_under_home: str) -> str:
    """將 'SGS/EC62' 這類相對路徑展開成 ~/SGS/EC62，並確保目錄存在。"""
    try:
        p = default_path_under_home
        if not p.startswith("~"):
            p = os.path.join("~", default_path_under_home.strip("/"))
        p = os.path.expanduser(p)
        os.makedirs(p, exist_ok=True)
        return p
    except Exception:
        try:
            os.makedirs(default_path_under_home, exist_ok=True)
        except Exception:
            pass
        return default_path_under_home




def get_common_ec62_folder() -> str:
    """取得 EC62 共用資料夾。

    Windows：固定使用 C:\\SGS\\EC62
    Linux / Raspberry Pi：使用 ~/SGS/EC62

    所有 CONFIG、PV LOG、Error LOG、Trend_History、PDF、CSV、PNG
    都集中在這個資料夾底下，方便備份、移機與 SGS 專案管理。
    """
    try:
        if platform.system().lower() == "windows":
            base = os.path.normpath(r"C:/SGS/EC62")
        else:
            base = os.path.expanduser("~/SGS/EC62")
        os.makedirs(base, exist_ok=True)
        return base
    except Exception:
        # fallback：若 C 槽或目錄建立失敗，仍回到使用者家目錄。
        return user_path("SGS/EC62")


def ensure_ec62_common_folders(base_folder: str) -> dict:
    """建立 EC62 共用資料夾結構並回傳各資料夾路徑。

    目錄結構：
        C:\\SGS\\EC62\\config_e62_multi.json
        C:\\SGS\\EC62\\PV
        C:\\SGS\\EC62\\Error
        C:\\SGS\\EC62\\Trend_History
        C:\\SGS\\EC62\\YYYY_MM_DD
    """
    base = os.path.normpath(base_folder)
    paths = {
        "base": base,
        "pv": os.path.join(base, "PV"),
        "error": os.path.join(base, "Error"),
        "trend_history": os.path.join(base, "Trend_History"),
    }
    for p in paths.values():
        try:
            os.makedirs(p, exist_ok=True)
        except Exception:
            pass
    return paths


def _linux_serial_by_id():
    """Linux /dev/serial/by-id 掃描。"""
    base = "/dev/serial/by-id"
    if not os.path.isdir(base):
        return []

    out = []
    for name in os.listdir(base):
        p = os.path.join(base, name)
        try:
            real = os.path.realpath(p)
            if os.path.exists(real):
                out.append((p, real))
        except Exception:
            pass
    return out


def _is_usb_port(pi) -> bool:
    """判斷 serial.tools.list_ports 的 port 是否像 USB 串口。

    USB FIX：除了描述文字，也直接接受 Linux 常見 ttyUSB/ttyACM，
    避免部分 CP210x/CH340 驅動沒有 manufacturer/description 時被誤過濾。
    """
    dev = str(getattr(pi, "device", "") or "")
    if dev.startswith(("/dev/ttyUSB", "/dev/ttyACM")):
        return True

    t = f"{dev} {getattr(pi, 'description', '')} {getattr(pi, 'manufacturer', '')} {getattr(pi, 'hwid', '')}".lower()
    return any(k in t for k in (
        "usb", "cp210", "ch340", "ch341", "ftdi", "ft232", "ft2232",
        "prolific", "pl2303", "wch", "qinheng", "silicon labs", "cdc",
        "usb-uart", "usb serial", "usb-serial"
    ))


def _usb_port_candidates():
    """依 OS 回傳排序後的 USB/COM 候選清單。

    USB FIX：
    1) Linux 的 /dev/ttyUSB*、/dev/ttyACM* 不再因描述缺失被排除。
    2) Windows 若 USB_ONLY 過濾後為空，自動 fallback 到所有 COM，
       避免特殊/舊版驅動顯示名稱不含 USB/CP210/CH340 時完全掃不到。
    """
    sysname = platform.system().lower()
    ports_info = list(serial.tools.list_ports.comports())

    if sysname == "linux":
        ordered = []

        if PREFERRED_DEV and os.path.exists(PREFERRED_DEV):
            ordered.append(PREFERRED_DEV)

        if PREFER_BY_ID_SYMLINK:
            for symlink, _real in _linux_serial_by_id():
                if symlink not in ordered:
                    ordered.append(symlink)

        for pi in ports_info:
            dev = str(pi.device or "")
            # ttyUSB / ttyACM 本身就是主要 USB 串口命名，不再被 USB_ONLY 誤擋。
            if dev.startswith(("/dev/ttyUSB", "/dev/ttyACM")):
                if dev not in ordered:
                    ordered.append(dev)
                continue
            if USB_ONLY and not _is_usb_port(pi):
                continue
            if dev and dev not in ordered:
                ordered.append(dev)

        return ordered

    if sysname == "windows":
        def score(pi):
            t = f"{pi.device} {pi.description} {pi.manufacturer} {pi.hwid}".lower()
            s = 0
            if _is_usb_port(pi):
                s += 100
            for kw in KNOWN_USB_BRANDS:
                if kw.lower() in t:
                    s += 10
            try:
                n = int(str(pi.device).upper().replace("COM", ""))
                s += max(0, 20 - n)
            except Exception:
                pass
            return s

        usb_pis = [pi for pi in ports_info if _is_usb_port(pi)] if USB_ONLY else list(ports_info)
        # 若驅動資訊不足導致判斷不到 USB，fallback 到所有 COM，不讓下拉選單變空。
        pis = usb_pis if usb_pis else list(ports_info)
        pis = sorted(pis, key=score, reverse=True)
        return [pi.device for pi in pis if getattr(pi, "device", None)]

    out = []
    for pi in ports_info:
        if USB_ONLY and not _is_usb_port(pi):
            continue
        if getattr(pi, "device", None):
            out.append(pi.device)
    if not out and ports_info:
        out = [pi.device for pi in ports_info if getattr(pi, "device", None)]
    return out


def parse_int_maybe_hex(s: str, fallback: int) -> int:
    """支援 '64' 或 '0x40' 輸入，錯誤回 fallback。"""
    try:
        t = (s or "").strip().lower()
        if not t:
            return fallback
        if t.startswith("0x"):
            return int(t, 16)
        return int(t, 10)
    except Exception:
        return fallback


def parse_float(s: str, fallback: float) -> float:
    """安全轉 float。"""
    try:
        t = (s or "").strip()
        if not t:
            return float(fallback)
        return float(t)
    except Exception:
        return float(fallback)


class E62GUI:
    def __init__(self, root):
        self.root = root
        self.root.title("E62/C62 RTU V5.0")

        self.client = None
        self.running = False
        self.closing = False
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._poll_thread = None
        self._reconnect_after_id = None

        # ✅ V4.8：最大支援 CH01~CH30；實際顯示數量由 CH Number 控制
        self.max_unit_id = MAX_CHANNELS
        self.channel_count = DEFAULT_CHANNEL_COUNT
        self.unit_ids = list(range(1, self.channel_count + 1))
        self.unit_names = {
            i: f"CH{i:02d}" for i in range(1, self.max_unit_id + 1)
        }

        self.unit_addrs = {}
        for i in range(1, self.max_unit_id + 1):
            base = DEFAULT_ADDRS.get(
                i,
                {"PV": PV_ADDR_DEFAULT, "SV": SV_ADDR_DEFAULT},
            )
            self.unit_addrs[i] = {"PV": int(base["PV"]), "SV": int(base["SV"])}

        # GUI 變數
        self.com_var = tk.StringVar()
        self.status_var = tk.StringVar(value="未連線")
        self.interval_var = tk.IntVar(value=60)
        self.channel_count_var = tk.IntVar(value=self.channel_count)

        # ===== V3.7 Trend SCADA 即時趨勢圖 =====
        self.trend_data = {uid: [] for uid in range(1, self.max_unit_id + 1)}   # uid -> [(time_str, pv_value), ...]
        self.trend_max_points_var = tk.IntVar(value=500)      # 每 CH 保留最近筆數
        self.trend_update_var = tk.StringVar(value="1分")     # 圖表刷新頻率
        self.trend_enable_var = tk.BooleanVar(value=True)     # 是否自動更新圖表
        self._trend_lock = threading.Lock()
        self.trend_canvas = None
        self.trend_fig = None
        self.trend_ax = None
        self.trend_window = None
        self._trend_after_id = None
        self.trend_info_var = tk.StringVar(value="Trend Ready")
        self.trend_stats_text_var = tk.StringVar(value="MAX / MIN Ready")
        # V3.8I：趨勢圖 CH 勾選顯示，多 CH 可同時顯示/隱藏
        self.trend_ch_vars = {uid: tk.BooleanVar(value=True) for uid in range(1, self.max_unit_id + 1)}

        # V3.8R：趨勢圖顯示範圍狀態
        # 中文說明：
        # 1. 取消滑鼠滾輪縮放，避免現場操作時圖表左右跳動不穩。
        # 2. 取消左鍵拖曳平移，讓趨勢圖固定穩定顯示。
        # 3. 保留「↔ 自動範圍」按鈕與雙擊圖表復原全部資料範圍。
        self.trend_zoom_manual = False
        self._trend_current_xlim = None
        self._trend_drag_start = None

        # V3.8P：MAX/MIN 歸零用的「統計起點」
        # 說明：
        # 1. 這裡只記錄每個 CH 從第幾筆資料開始重新計算 MAX / MIN。
        # 2. 不會刪除 self.trend_data 的舊資料。
        # 3. 不會刪除 Trend_History、CSV、PDF 或已存出的報表。
        # 4. AVG / COUNT 仍以完整趨勢資料計算，方便保留整段測試紀錄。
        self.trend_minmax_reset_index = {uid: 0 for uid in range(1, self.max_unit_id + 1)}

        self.unit_enable_vars = {
            uid: tk.BooleanVar(value=True)
            for uid in range(1, self.max_unit_id + 1)
        }
        self.unit_name_vars = {
            uid: tk.StringVar(value=self.unit_names[uid])
            for uid in range(1, self.max_unit_id + 1)
        }
        self.unit_pv_vars = {
            uid: tk.StringVar(value=str(self.unit_addrs[uid]["PV"]))
            for uid in range(1, self.max_unit_id + 1)
        }
        self.unit_sv_vars = {
            uid: tk.StringVar(value=str(self.unit_addrs[uid]["SV"]))
            for uid in range(1, self.max_unit_id + 1)
        }

        # PV/SV 顯示區
        self.pv_vars = {}
        self.sv_vars = {}
        self.pv_labels = {}
        self.sv_labels = {}

        # =====================================================
        # V3.8V：EC62 共用資料夾集中管理
        #
        # Windows 固定：C:\\SGS\\EC62
        # Linux / Raspberry Pi：~/SGS/EC62
        #
        # 所有資料集中：
        #   config_e62_multi.json  -> 程式設定
        #   PV                     -> SV/PV LOG
        #   Error                  -> Error / Audit LOG
        #   Trend_History          -> 趨勢歷史資料
        #   YYYY_MM_DD             -> PDF / CSV / PNG 報表
        #
        # 優點：避免 OneDrive 鎖檔、方便備份、移機時只需複製整個資料夾。
        # =====================================================
        self.common_folder = get_common_ec62_folder()
        self.common_paths = ensure_ec62_common_folders(self.common_folder)

        self.log_folder = self.common_paths["base"]
        self.error_folder = self.common_paths["error"]
        self.sv_log_folder = self.common_paths["pv"]
        self.trend_report_folder = self.common_paths["base"]
        self.trend_history_folder = self.common_paths["trend_history"]

        self.report_title_var = tk.StringVar(value="SGS Temperature Validation Report")
        self.company_name_var = tk.StringVar(value="CM LAB")
        self.customer_name_var = tk.StringVar(value="ADVANTECH")
        self.calibration_no_var = tk.StringVar(value="CM-2026-001")
        today_text = datetime.now().strftime("%Y-%m-%d")
        self.sample_start_date_var = tk.StringVar(value=today_text)
        self.sample_start_time_var = tk.StringVar(value="08:00:00")
        self.sample_end_date_var = tk.StringVar(value=today_text)
        self.sample_end_time_var = tk.StringVar(value="17:00:00")
        self.report_folder_var = tk.StringVar(value=self.trend_report_folder)
        self.report_format_var = tk.StringVar(value="全部")   # 全部 / CSV / PNG / PDF

        # V3.8V：CONFIG 固定存放於共用資料夾。
        # Windows：C:\\SGS\\EC62\\config_e62_multi.json
        # Linux：~/SGS/EC62/config_e62_multi.json
        self.config_path = os.path.join(self.common_folder, "config_e62_multi.json")

        # 重連退避
        self._reconnect_backoff_s = 1.5

        # COM 埠被其他程式占用時，暫時列入黑名單，避免一直洗畫面
        self._blocked_ports = {}
        self._port_error_cache = {}
        self._port_block_seconds = 120

        # ===== V3.9 WEB：內建 Web 即時監看 =====
        self.web_port = 8080
        # V4.6：LAN IP / Web Port 可手動設定。
        # LAN IP 留空時自動偵測；手機/平板需與此電腦在同一個網段 / Wi-Fi。
        self.web_lan_ip = ""
        self.web_lan_ip_var = tk.StringVar(value="")
        self.web_port_var = tk.StringVar(value=str(self.web_port))
        self.web_title = "E62 / EC62 Web V5.0"
        self.web_server = None
        self.web_thread = None
        self.web_lock = threading.Lock()
        self.web_latest = {
            uid: {
                "id": f"{uid:02d}",
                "name": self.unit_names.get(uid, f"CH{uid:02d}"),
                "pv": None,
                "sv": None,
                "st": 1,
                "time": "--",
            }
            for uid in range(1, self.max_unit_id + 1)
        }
        # V4.1 WEB：Web 端 MAX/MIN 警戒設定。None 表示不啟用該界限。
        self.web_alarm_limits = {
            uid: {"lo": None, "hi": None}
            for uid in range(1, self.max_unit_id + 1)
        }

        # V4.3 WEB：Email / LINE 警報通知設定（密碼解鎖後才顯示設定欄位）
        self.notify_cfg = self.default_notify_config()
        self.notify_vars = {}
        self.notify_password_var = None
        self.notify_token_var = None
        self.notify_frame = None
        self.notify_alarm_state = {uid: False for uid in range(1, self.max_unit_id + 1)}
        self.notify_last_sent = {uid: 0.0 for uid in range(1, self.max_unit_id + 1)}
        # V4.9B：手動解除後，該 CH 的目前警報從 Web 畫面移除，直到數值恢復正常才重新開放新警報。
        self.web_alarm_ack = {uid: False for uid in range(1, self.max_unit_id + 1)}
        # V4.9：Alarm / Recovery 稽核記錄預設欄位。
        # 這兩個欄位會在密碼解鎖後的設定區預先帶入，Web 解除記錄也會預填。
        self.alarm_operator_var = tk.StringVar(value="admin")
        self.alarm_reason_var = tk.StringVar(value="Temperature Returned to Normal")
        self.alarm_operator = "admin"
        self.alarm_reason = "Temperature Returned to Normal"
        self.lan_url_var = tk.StringVar(value=f"LAN：--")

        # 密碼/鎖定
        self.password = DEFAULT_PASSWORD
        self.is_unlocked = False
        self._fail_count = 0
        self._lockout_until = 0.0
        self.password_window = None

        # 通訊參數
        self.serial_cfg = dict(DEFAULT_SERIAL)
        self.baud_var = tk.IntVar(value=self.serial_cfg["baudrate"])
        self.parity_var = tk.StringVar(value=self.serial_cfg["parity"])
        self.stopbits_var = tk.IntVar(value=self.serial_cfg["stopbits"])
        self.bytesize_var = tk.IntVar(value=self.serial_cfg["bytesize"])
        self.timeout_var = tk.StringVar(value=str(self.serial_cfg["timeout"]))

        # V4.5：中 / English 語言切換
        self.language = "zh"
        self.language_var = tk.StringVar(value="中文")

        # 鎖定元件集合
        self._lock_widgets = []

        # GUI / 掃描 COM
        self.build_gui()
        self.scan_and_pick_port()

        # 載入設定
        self.load_config()
        self.apply_language()

        # V3.8L：開機自動載入今日趨勢歷史，斷線/重開後可延續線圖。
        self.load_trend_history_today()

        # 依設定重建顯示
        self.apply_unit_selection(rebuild_only=True)

        # Demo 必須在已儲存的 CH 設定套用後初始化，避免重新被覆蓋成 1 CH。
        if DEMO_MODE:
            self.enable_demo_mode()
            self._sync_enable_vars_from_unit_ids()
            self.rebuild_station_rows()

        # 開機預設上鎖
        self.lock_settings(init=True)

        # 如要開機自動跳密碼，取消下一行註解
        # self.root.after(300, self.unlock_dialog)

        if not DEMO_MODE:
            # 熱插拔監控
            threading.Thread(target=self.monitor_ports, daemon=True).start()

            # 自動連線
            self.safe_gui(self.connect)

        # V3.9 WEB：開機自動啟動本機 Web Server
        self.start_web_server()

        self.root.protocol("WM_DELETE_WINDOW", self.exit_program)

    # =========================================================
    # Tkinter 執行緒安全工具
    # =========================================================
    def safe_gui(self, func, *args, **kwargs):
        """安全從背景執行緒呼叫 GUI 更新。"""
        if self.closing:
            return
        try:
            self.root.after(0, lambda: self._safe_call(func, *args, **kwargs))
        except Exception:
            pass

    def _safe_call(self, func, *args, **kwargs):
        """實際執行 GUI 更新，避免視窗已關閉時報錯。"""
        if self.closing:
            return
        try:
            if not self.root.winfo_exists():
                return
            func(*args, **kwargs)
        except Exception:
            pass

    def schedule_reconnect(self, delay_ms=None):
        """統一排程重連，避免重複 after。"""
        if self.closing:
            return

        if delay_ms is None:
            delay_ms = int(min(self._reconnect_backoff_s, 30.0) * 1000)
            self._reconnect_backoff_s = min(
                self._reconnect_backoff_s * 2.0,
                30.0,
            )

        try:
            if self._reconnect_after_id is not None:
                self.root.after_cancel(self._reconnect_after_id)
        except Exception:
            pass

        try:
            self._reconnect_after_id = self.root.after(delay_ms, self.connect)
        except Exception:
            pass

    def auto_reconnect_after_fix(self, reason="設定修正完成"):
        """設定修正 / 儲存 / 套用後自動重新連線。

        作用：
        1) 取消舊的重連排程，避免重複連線。
        2) 清除 COM 黑名單，讓剛釋放的 COM 可立即再試。
        3) 重新掃描 USB COM。
        4) 延遲 300ms 後自動 connect()。
        """
        if self.closing:
            return

        try:
            if self._reconnect_after_id is not None:
                self.root.after_cancel(self._reconnect_after_id)
        except Exception:
            pass
        self._reconnect_after_id = None

        # 修正完成後允許立即重試所有 COM，避免需要人工按「重新連線」。
        try:
            self._blocked_ports.clear()
            self._port_error_cache.clear()
        except Exception:
            self._blocked_ports = {}
            self._port_error_cache = {}

        # 重設退避時間，讓自動重連立即開始。
        self._reconnect_backoff_s = 1.5

        # 先停止目前輪詢與舊 client，避免舊 COM 還被自己占用造成重新連線失敗。
        try:
            self._stop_event.set()
            self.running = False
            if self.client:
                self.client.close()
            self.client = None
        except Exception as e:
            self.write_error_log(f"auto reconnect close old client error: {e}")

        try:
            self.scan_and_pick_port()
        except Exception as e:
            self.write_error_log(f"auto reconnect scan port error: {e}")

        self.set_status(f"🔄 {reason}，自動重新掃描 COM 並重新連線中...", "yellow")
        try:
            self._reconnect_after_id = self.root.after(500, self.connect)
        except Exception:
            self.connect()

    # =========================================================
    # 稽核/錯誤
    # =========================================================
    def audit(self, action: str, detail: str = ""):
        try:
            fname = datetime.now().strftime("%Y-%m-%d_Audit.txt")
            full_path = os.path.join(self.error_folder, fname)
            now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            with open(full_path, "a", encoding="utf-8") as f:
                detail_text = f" | {detail}" if detail else ""
                f.write(f"[{now}] {action}{detail_text}\n")
        except Exception:
            pass

    def write_error_log(self, msg: str):
        try:
            fname = datetime.now().strftime("%Y-%m-%d_Error.txt")
            full_path = os.path.join(self.error_folder, fname)
            now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            with open(full_path, "a", encoding="utf-8") as f:
                f.write(f"[{now}] {msg}\n")
        except Exception:
            pass

    def _alarm_audit_defaults(self):
        """回傳警報解除記錄預設 Operator / Reason，供 GUI、Web、Log 共用。"""
        try:
            op = str(self.alarm_operator_var.get() or "").strip()
        except Exception:
            op = str(getattr(self, "alarm_operator", "") or "").strip()
        try:
            reason = str(self.alarm_reason_var.get() or "").strip()
        except Exception:
            reason = str(getattr(self, "alarm_reason", "") or "").strip()
        if not op:
            op = "System"
        if not reason:
            reason = "Temperature Returned to Normal"
        self.alarm_operator = op
        self.alarm_reason = reason
        return op, reason

    def _ec62_limit_float_or_none(self, value):
        """V5.0：Hi / Low 共用轉換；支援空白、None、舊版 Lo/Hi。"""
        try:
            if value is None:
                return None
            t = str(value).strip()
            if t == "" or t.lower() in ("none", "null", "--", "nan"):
                return None
            return float(t)
        except Exception:
            return None

    def normalize_web_alarm_limits(self):
        """V5.0：把 CH01~CH30 的 Web LOW/HIGH 統一成小寫 lo/hi，避免存檔遺失。"""
        fixed = {}
        try:
            src = getattr(self, "web_alarm_limits", {}) or {}
            for uid in range(1, self.max_unit_id + 1):
                old = src.get(uid, src.get(str(uid), {}))
                if not isinstance(old, dict):
                    old = {}
                lo = self._ec62_limit_float_or_none(old.get("lo", old.get("Lo", None)))
                hi = self._ec62_limit_float_or_none(old.get("hi", old.get("Hi", None)))
                if lo is not None and hi is not None and lo > hi:
                    lo, hi = hi, lo
                fixed[uid] = {"lo": lo, "hi": hi}
            self.web_alarm_limits = fixed
        except Exception:
            self.web_alarm_limits = {uid: {"lo": None, "hi": None} for uid in range(1, self.max_unit_id + 1)}
        return self.web_alarm_limits

    def web_alarm_limits_for_config(self):
        """V5.0：Config 一律輸出小寫 lo/hi。"""
        self.normalize_web_alarm_limits()
        return {
            str(uid): {
                "lo": self.web_alarm_limits.get(uid, {}).get("lo"),
                "hi": self.web_alarm_limits.get(uid, {}).get("hi"),
            }
            for uid in range(1, self.max_unit_id + 1)
        }

    def get_web_alarm_limit(self, uid):
        """V5.0：讀取單一 CH 的 LOW/HIGH，兼容舊版 Lo/Hi。"""
        try:
            uid = int(uid)
            old = self.web_alarm_limits.get(uid, self.web_alarm_limits.get(str(uid), {}))
            if not isinstance(old, dict):
                old = {}
            lo = self._ec62_limit_float_or_none(old.get("lo", old.get("Lo", None)))
            hi = self._ec62_limit_float_or_none(old.get("hi", old.get("Hi", None)))
            if lo is not None and hi is not None and lo > hi:
                lo, hi = hi, lo
            self.web_alarm_limits[uid] = {"lo": lo, "hi": hi}
            return self.web_alarm_limits[uid]
        except Exception:
            return {"lo": None, "hi": None}

    def write_alarm_event_log(self, uid, event, pv=None, operator=None, reason="", source="SYSTEM"):
        """V4.9B：ERR / Recovery 專用事件紀錄，JSONL + CSV + YYYYMMDD_ERROR.txt 同步保存。"""
        try:
            uid = int(uid)
            op_default, reason_default = self._alarm_audit_defaults()
            op = (str(operator or "").strip() or op_default)
            rsn = (str(reason or "").strip() or reason_default)
            now_local = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            name = self.unit_names.get(uid, f"CH{uid:02d}")
            value = None
            try:
                if pv is not None:
                    value = round(float(pv), 1)
            except Exception:
                value = None
            row = {
                "time": now_local,
                "utc": now_utc,
                "channel": f"CH{uid:02d}",
                "name": name,
                "event": str(event or ""),
                "value": value,
                "unit": "°C",
                "operator": op,
                "reason": rsn,
                "source": str(source or "SYSTEM"),
            }
            os.makedirs(self.error_folder, exist_ok=True)
            json_path = os.path.join(self.error_folder, datetime.now().strftime("%Y-%m-%d_Alarm_Event.jsonl"))
            with open(json_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
            csv_path = os.path.join(self.error_folder, datetime.now().strftime("%Y-%m-%d_Alarm_Event.csv"))
            csv_exists = os.path.exists(csv_path)
            with open(csv_path, "a", encoding="utf-8-sig", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=["time","utc","channel","name","event","value","unit","operator","reason","source"])
                if not csv_exists:
                    writer.writeheader()
                writer.writerow(row)

            # V4.9B：每日 Error 文字紀錄，檔名符合現場需求：20260627_ERROR.txt
            txt_path = os.path.join(self.error_folder, datetime.now().strftime("%Y%m%d_ERROR.txt"))
            txt_line = (
                f"[{row['time']}] {row['channel']} {row['name']} "
                f"EVENT={row['event']} PV={row['value']} {row['unit']} "
                f"OPERATOR={op} REASON={rsn} SOURCE={row['source']}\n"
            )
            with open(txt_path, "a", encoding="utf-8") as f:
                f.write(txt_line)

            self.audit("ERR_EVENT", f"{row['channel']} {row['event']} PV={row['value']} OP={op} REASON={rsn}")
            return row
        except Exception as e:
            self.write_error_log(f"write_alarm_event_log error: {e}")
            return None

    def read_alarm_event_history(self, limit=200):
        """讀取目前未解除的 ERR 事件，供 Web Alarm History 顯示。

        V4.9B：Web 畫面只顯示「尚未解除」的 ERR。
        使用者按解除後，畫面移除；完整 ERR / Recovery 仍保存於：
        - YYYYMMDD_ERROR.txt
        - YYYY-MM-DD_Alarm_Event.jsonl
        - YYYY-MM-DD_Alarm_Event.csv
        """
        rows = []
        try:
            limit = max(1, min(1000, int(limit or 200)))
            files = sorted(glob.glob(os.path.join(self.error_folder, "*_Alarm_Event.jsonl")), reverse=True)[:14]
            for path in files:
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        lines = f.readlines()[-1000:]
                    for line in lines:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rows.append(json.loads(line))
                        except Exception:
                            pass
                except Exception:
                    pass

            # 每個 CH 只看最後一筆事件：最後是 ERR 才代表目前仍未解除。
            rows.sort(key=lambda x: str(x.get("time", "")))
            latest_by_ch = {}
            for r in rows:
                ch = str(r.get("channel", ""))
                if ch:
                    latest_by_ch[ch] = r
            active = []
            for r in latest_by_ch.values():
                ev = str(r.get("event", "")).upper()
                if ev.startswith("ERR") or ev in ("ALARM", "WEB_ALARM", "COMMUNICATION ERROR"):
                    active.append(r)
            active.sort(key=lambda x: str(x.get("time", "")), reverse=True)
            return active[:limit]
        except Exception as e:
            self.write_error_log(f"read_alarm_event_history error: {e}")
            return []

    # =========================================================
    # 溫度解碼
    # =========================================================
    @staticmethod
    def decode_e62_temp(raw: int) -> float:
        raw16 = int(raw) & 0xFFFF

        # 特殊偏移碼判斷
        if 15000 <= raw16 <= 25000:
            val = (raw16 + 1 - 20000) / 10.0
            if -200.0 <= val <= 850.0:
                return val

        # 一般 signed int16 /10
        signed = raw16 - 0x10000 if raw16 >= 0x8000 else raw16
        val_tc = signed / 10.0
        if -200.0 <= val_tc <= 850.0:
            return val_tc

        # fallback
        return (raw16 + 1) / 10.0

    # =========================================================
    # Port 掃描
    # =========================================================
    def scan_and_pick_port(self):
        ports = _usb_port_candidates()
        picked = ports[0] if ports else ""
        self.com_cb["values"] = ports
        self.com_var.set(picked or "")

    # =========================================================
    # pymodbus 相容
    # =========================================================
    def _read_holding(self, address, count, unit_id=1):
        """讀取 Holding Register，相容多個 pymodbus 版本。

        pymodbus 不同版本曾使用 device_id / slave / unit。
        USB FIX：逐一嘗試，避免 USB 已開啟卻因關鍵字版本不同被判定為連線失敗。
        """
        if not self.client:
            raise RuntimeError("Modbus client 尚未連線")

        fn = self.client.read_holding_registers
        last_type_error = None

        # 新版優先 device_id，再相容 slave / unit。
        for key in ("device_id", "slave", "unit"):
            try:
                return fn(address=address, count=count, **{key: unit_id})
            except TypeError as e:
                last_type_error = e

        # 極舊版本最後嘗試位置參數。
        try:
            return fn(address, count, unit_id)
        except TypeError:
            if last_type_error is not None:
                raise last_type_error
            raise

    # =========================================================
    # V4.5 Bilingual：中 / English 語言切換
    # =========================================================
    def tr(self, zh_text: str) -> str:
        """依目前語言回傳介面文字。原始 key 一律使用中文。"""
        table = {
            "輸入密碼以顯示設定": "Enter Settings Password",
            "重新連線": "Reconnect",
            "開啟資料夾": "Open Folder",
            "趨勢圖": "Trend",
            "離開": "Exit",
            "RTU 通訊參數": "RTU Communication",
            "讀取設定": "Read Settings",
            "間隔秒數": "Interval (sec)",
            "CH 管理": "CH Manage",
            "CH 數量": "CH Number",
            "套用 CH 數量": "Apply CH Number",
            "新增": "Add",
            "移除": "Remove",
            "套用通訊": "Apply Comm",
            "套用 CH": "Apply CH",
            "套用名稱": "Apply Names",
            "儲存設定": "Save Config",
            "解鎖": "Unlock",
            "上鎖": "Lock",
            "修改密碼": "Change Password",
            "管理者": "Admin",
            "管理者登入": "Admin Login",
            "管理者密碼": "Admin Password",
            "管理者設定": "Admin Settings",
            "管理者權限": "Admin Privileges",
            "管理者刪除": "Admin Delete",
            "使用者登入": "User Login",
            "使用者管理": "User Management",
            "使用者": "User Name",
            "密碼": "Password",
            "登入": "Login",
            "登出": "Logout",
            "操作員": "Operator",
            "訪客": "Guest",
            "參數設定解鎖": "Settings Unlock",
            "E62 / C62 參數設定解鎖": "E62 / C62 Settings Unlock",
            "密碼驗證": "Password Verification",
            "請輸入密碼": "Please Enter Password",
            "解鎖後可修改 RTU 通訊參數、CH、PV/SV 位址、Email / LINE 設定": "After unlocking, you can edit RTU communication, CH, PV/SV addresses, and Email/LINE settings",
            "顯示密碼": "Show Password",
            "確認": "OK",
            "取消": "Cancel",
            "鎖定中": "Locked",
            "提醒": "Notice",
            "錯誤": "Error",
            "完成": "Done",
            "目前密碼：": "Current Password:",
            "新密碼：": "New Password:",
            "再輸入一次：": "Confirm Password:",
            "更新密碼": "Update Password",
            "請先解鎖後再修改密碼": "Please unlock before changing the password",
            "目前密碼不正確": "Current password is incorrect",
            "新密碼至少 4 碼": "New password must be at least 4 characters",
            "兩次輸入的新密碼不一致": "New passwords do not match",
            "密碼已修改並儲存": "Password changed and saved",
            "密碼已更新": "Password updated",
            "設定已上鎖，請輸入密碼解鎖": "Settings locked. Please enter password to unlock",
            "設定已解鎖，可修改 / 套用 / 儲存": "Settings unlocked. You can edit / apply / save",
            "設定(按上鎖可關閉）": "Settings (press Lock to close)",
            "語言：中文": "Language: Chinese",
            "密碼錯誤": "Password incorrect",
            "已鎖定，請": "Locked, try again after",
            "秒後再試": "seconds",
            "錯誤 3 次，已鎖定": "3 wrong attempts, locked for",
            "秒": "sec",
            "密碼錯誤，剩餘": "Password incorrect,",
            "次機會": "attempts left",
            "自動更新": "Auto Update",
            "保留筆數": "Keep Points",
            "存檔": "Save",
            "列印": "Print",
            "路徑": "Folder",
            "全部": "All",
            "開啟資料夾": "Open Folder",
            "趨勢設定": "Trend Config",
            "MAX/MIN請除": "Clear MAX/MIN",
            "取樣日期": "Sample Date",
            "報表設定": "Report Setting",
            "SGS 報表設定": "SGS Report Setting",
            "報表標題": "Report Title",
            "公司名稱": "Company",
            "客戶名稱": "Customer",
            "校正編號": "Calibration No.",
            "開始日期": "Start Date",
            "開始時間": "Start Time",
            "結束日期": "End Date",
            "結束時間": "End Time",
            "報表路徑": "Report Folder",
            "選擇": "Browse",
            "Email 啟用": "Email Enable",
            "寄件帳號": "SMTP User",
            "SMTP 密碼": "SMTP Password",
            "寄件人": "Sender",
            "收件人": "Recipients",
            "主旨": "Subject",
            "LINE 啟用": "LINE Enable",
            "LINE 模式": "LINE Mode",
            "重送間隔(分)": "Cooldown (min)",
            "恢復正常通知": "Recovery Notice",
            "紀錄人": "Operator",
            "解除原因": "Recovery Reason",
            "警報解除記錄": "Alarm Recovery Log",
            "儲存通知設定": "Save Notify Config",
            "測試 Email": "Test Email",
            "測試 LINE": "Test LINE",
            "測試聲音 / Test Sound": "Test Sound / 測試聲音",
            "測試通知 / Test Notification": "Test Notification / 測試通知",
            "中文": "中文",
            "英文": "English",
        }
        if self.language == "en":
            return table.get(str(zh_text), str(zh_text))
        return str(zh_text)

    def _walk_widgets(self, widget):
        """遞迴列出所有 Tk/ttk 子元件。"""
        yield widget
        try:
            children = widget.winfo_children()
        except Exception:
            children = []
        for ch in children:
            yield from self._walk_widgets(ch)

    def apply_language(self):
        """套用 GUI 文字語言。採保守方式，不改變原本功能與排版。"""
        try:
            self.language_var.set("中文" if self.language == "zh" else "English")
            self.root.title("E62/C62 RTU V5.2G Trend Ribbon Top Small")
            for w in self._walk_widgets(self.root):
                try:
                    txt = w.cget("text")
                except Exception:
                    txt = None
                if txt is not None:
                    try:
                        if not hasattr(w, "_orig_i18n_text"):
                            # 去掉常見 emoji 後保存中文 key；顯示時保留 emoji 前綴。
                            w._orig_i18n_text = str(txt)
                        orig = getattr(w, "_orig_i18n_text", str(txt))
                        prefix = ""
                        body = orig
                        for p in ("🔐 ", "📈 ", "🌐 ", "✅ ", "📝 ", "💾 ", "🔓 ", "🔒 ", "🔑 ", "🖨 ", "📂 ", "📄 ", "♻ ", "📅 ", "📋 ", "➕ ", "➖ "):
                            if body.startswith(p):
                                prefix = p
                                body = body[len(p):]
                                break
                        new_text = prefix + self.tr(body)
                        w.configure(text=new_text)
                    except Exception:
                        pass
            try:
                if hasattr(self, "lang_btn"):
                    self.lang_btn.configure(text="🌐 中文 / English" if self.language == "zh" else "🌐 English / 中文")
            except Exception:
                pass
        except Exception as e:
            try:
                self.write_error_log(f"apply_language error: {e}")
            except Exception:
                pass

    def toggle_language(self):
        """GUI 一鍵切換中文 / English，並立即寫入 config。"""
        self.language = "en" if self.language == "zh" else "zh"
        self.apply_language()
        try:
            cfg = {}
            if os.path.exists(self.config_path):
                with open(self.config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f) or {}
            cfg["language"] = self.language
            cfg.setdefault("web", {})["language"] = self.language
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
        except Exception as e:
            self.write_error_log(f"save language error: {e}")
        self.set_status("🌐 Language: English" if self.language == "en" else "🌐 語言：中文", "green")

    def web_set_language(self, lang):
        """Web 端切換語言，同步更新 GUI 與 config。"""
        try:
            lang = "en" if str(lang).lower().startswith("en") else "zh"
            self.language = lang
            self.safe_gui(self.apply_language)
            cfg = {}
            if os.path.exists(self.config_path):
                with open(self.config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f) or {}
            cfg["language"] = self.language
            cfg.setdefault("web", {})["language"] = self.language
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            return {"ok": True, "language": self.language, "message": "Language updated" if self.language == "en" else "語言已更新"}
        except Exception as e:
            self.write_error_log(f"web_set_language error: {e}")
            return {"ok": False, "message": str(e)}

    def place_main_sash_safe(self):
        """安全調整左右分隔線；右側設定面板隱藏時不執行，避免 invalid sash index。"""
        try:
            if not hasattr(self, "main_pane"):
                return
            panes = list(self.main_pane.panes())
            if len(panes) < 2:
                return
            x = max(520, self.root.winfo_width() - 650)
            self.main_pane.sash_place(0, x, 0)
        except Exception:
            pass

    def show_workspace_tab(self, tab):
        """切換桌面工作區；設定功能維持密碼保護。"""
        self.workspace_tab = tab
        if tab != "dashboard" and not self.is_unlocked:
            self.unlock_dialog()
            return

        try:
            panes = [str(pane) for pane in self.main_pane.panes()]
            if tab == "dashboard":
                if str(self.right_wrap) in panes:
                    self.main_pane.forget(self.right_wrap)
            elif str(self.right_wrap) not in panes:
                self.main_pane.add(self.right_wrap, minsize=560)
                self.root.after(100, self.place_main_sash_safe)
        except Exception:
            pass

        for name, button in getattr(self, "workspace_tab_buttons", {}).items():
            selected = name == tab
            button.config(
                bg="#0891b2" if selected else "#1e293b",
                fg="white" if selected else "#cbd5e1",
                activebackground="#0e7490" if selected else "#334155",
            )

        if tab == "dashboard" or not hasattr(self, "sel_frame"):
            return

        tools_row = getattr(self, "config_tools_row", 0)
        visible_rows = {
            "settings": {1, 2},
            "channels": set(range(3, tools_row + 1)),
            "tools": {tools_row},
        }.get(tab, set())
        for widget in self.sel_frame.grid_slaves():
            try:
                row = int(widget.grid_info().get("row", -1))
                if row == 0 or row in visible_rows:
                    widget.grid()
                else:
                    widget.grid_remove()
            except Exception:
                pass

    # =========================================================
    # GUI 建立
    # =========================================================
    def build_gui(self):
        """建立 PR20 SCADA 風格 GUI。"""
        self.root.configure(bg="#08111f")
        self.root.geometry("1380x900")
        self.root.minsize(1180, 760)
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(1, weight=1)

        # =====================================================
        # 上方 Header：系統名稱 / 狀態 / COM / 操作
        # =====================================================
        header = tk.Frame(self.root, bg="#111827", padx=12, pady=10)
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=0)
        header.columnconfigure(1, weight=1)

        title_box = tk.Frame(header, bg="#111827")
        title_box.grid(row=0, column=0, sticky="w")

        tk.Label(
            title_box,
            text="CM LAB",
            bg="#111827",
            fg="#38bdf8",
            font=("Arial", 24, "bold"),
        ).pack(anchor="w")

        tk.Label(
            title_box,
            text="E62 / C62 RTU SCADA V5.0 | Email / LINE",
            bg="#111827",
            fg="#cbd5e1",
            font=("Arial", 11, "bold"),
        ).pack(anchor="w")

        status_box = tk.Frame(header, bg="#111827")
        status_box.grid(row=0, column=1, sticky="ew", padx=20)
        status_box.columnconfigure(1, weight=1)

        self.run_led = tk.Label(
            status_box,
            text="●",
            bg="#111827",
            fg="#64748b",
            font=("Arial", 26, "bold"),
        )
        self.run_led.grid(row=0, column=0, padx=(0, 8), sticky="w")

        self.status_label = tk.Label(
            status_box,
            textvariable=self.status_var,
            bg="#111827",
            fg="#22c55e",
            font=("Arial", 18, "bold"),
            anchor="w",
        )
        self.status_label.grid(row=0, column=1, sticky="ew")

        self.time_var = tk.StringVar(value="--")
        tk.Label(
            status_box,
            textvariable=self.time_var,
            bg="#111827",
            fg="#facc15",
            font=("Arial", 13, "bold"),
        ).grid(row=1, column=1, sticky="w")

        tk.Label(
            status_box,
            textvariable=self.lan_url_var,
            bg="#111827",
            fg="#38bdf8",
            font=("Arial", 12, "bold"),
        ).grid(row=2, column=1, sticky="w")

        # V4.3C：操作功能列移到第 2 行，避免第 1 頁 Header 按鈕太擠
        ctrl_box = tk.Frame(header, bg="#111827")
        ctrl_box.grid(row=1, column=0, columnspan=2, sticky="ew", pady=(10, 0))
        ctrl_box.columnconfigure(9, weight=1)

        tk.Label(
            ctrl_box,
            text="COM",
            bg="#111827",
            fg="#cbd5e1",
            font=("Arial", 11, "bold"),
        ).grid(row=0, column=0, padx=4)

        self.com_cb = ttk.Combobox(
            ctrl_box,
            textvariable=self.com_var,
            width=20,
            state="readonly",
        )
        self.com_cb.grid(row=0, column=1, padx=4)

        self.btn_toggle_config = tk.Button(
            ctrl_box,
            text="🔐 輸入密碼以顯示設定",
            command=self.unlock_dialog,
            bg="#64748b",
            fg="black",
            activebackground="#94a3b8",
            activeforeground="black",
            font=("Arial", 12, "bold"),
            width=24,
        )
        self.btn_toggle_config.grid(row=0, column=2, padx=4)

        tk.Button(
            ctrl_box,
            text="重新連線",
            command=self.connect,
            bg="#0284c7",
            fg="white",
            activebackground="#0369a1",
            activeforeground="white",
            font=("Arial", 12, "bold"),
            width=10,
        ).grid(row=0, column=3, padx=4)

        tk.Button(
            ctrl_box,
            text="開啟資料夾",
            command=self.open_log_folder,
            bg="#16a34a",
            fg="white",
            activebackground="#15803d",
            activeforeground="white",
            font=("Arial", 12, "bold"),
            width=10,
        ).grid(row=0, column=4, padx=4)

        self.trend_open_btn = tk.Button(
            ctrl_box,
            text="📈 趨勢圖",
            command=self.open_trend_window,
            bg="#7c3aed",
            fg="white",
            activebackground="#6d28d9",
            activeforeground="white",
            font=("Arial", 12, "bold"),
            width=10,
        )
        self.trend_open_btn.grid(row=0, column=5, padx=4)

        self.web_open_btn = tk.Button(
            ctrl_box,
            text="🌐 Web",
            command=self.open_web_page,
            bg="#0891b2",
            fg="white",
            activebackground="#0e7490",
            activeforeground="white",
            font=("Arial", 12, "bold"),
            width=8,
        )
        self.web_open_btn.grid(row=0, column=6, padx=4)

        self.lang_btn = tk.Button(
            ctrl_box,
            text="🌐 中文 / English",
            command=self.toggle_language,
            bg="#facc15",
            fg="black",
            activebackground="#fde047",
            activeforeground="black",
            font=("Arial", 12, "bold"),
            width=14,
        )
        self.lang_btn.grid(row=0, column=7, padx=4)

        self.exit_button = tk.Button(
            ctrl_box,
            text="離開",
            command=self.exit_program,
            bg="#dc2626",
            fg="white",
            activebackground="#991b1b",
            activeforeground="white",
            font=("Arial", 12, "bold"),
            width=8,
        )
        self.exit_button.grid(row=0, column=8, padx=4)

        workspace_tabs = tk.Frame(header, bg="#111827")
        workspace_tabs.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        tk.Label(
            workspace_tabs,
            text="WORKSPACE",
            bg="#111827",
            fg="#64748b",
            font=("Arial", 9, "bold"),
        ).pack(side="left", padx=(2, 10))
        self.workspace_tab_buttons = {}
        for key, text in (
            ("dashboard", "即時監控"),
            ("settings", "設備設定"),
            ("channels", "CH 管理"),
            ("tools", "趨勢 / 報表 / 通知"),
        ):
            button = tk.Button(
                workspace_tabs,
                text=text,
                command=lambda tab=key: self.show_workspace_tab(tab),
                bg="#0891b2" if key == "dashboard" else "#1e293b",
                fg="white" if key == "dashboard" else "#cbd5e1",
                activebackground="#0e7490",
                activeforeground="white",
                relief="flat",
                bd=0,
                padx=16,
                pady=7,
                font=("Arial", 11, "bold"),
            )
            button.pack(side="left", padx=(0, 6))
            self.workspace_tab_buttons[key] = button

        # =====================================================
        # 主畫面：左 CH 卡片 + 右設定區
        # =====================================================
        main = tk.Frame(self.root, bg="#08111f", padx=12, pady=12)
        main.grid(row=1, column=0, sticky="nsew")
        main.columnconfigure(0, weight=1)
        main.rowconfigure(0, weight=1)
        main.rowconfigure(1, weight=0)

        # V4.4：左右分割視窗，可用中間分隔線把 SETTING / CONFIG PANEL 向左拉寬
        self.main_pane = tk.PanedWindow(
            main,
            orient=tk.HORIZONTAL,
            bg="#08111f",
            bd=0,
            sashwidth=10,
            sashrelief="raised",
        )
        self.main_pane.grid(row=0, column=0, sticky="nsew")

        # 左側 Canvas + Scrollbar，放 CH 卡片
        left_wrap = tk.Frame(self.main_pane, bg="#08111f")
        left_wrap.columnconfigure(0, weight=1)
        left_wrap.rowconfigure(0, weight=1)

        self.card_canvas = tk.Canvas(
            left_wrap,
            bg="#08111f",
            highlightthickness=0,
            borderwidth=0,
        )
        self.card_canvas.grid(row=0, column=0, sticky="nsew")

        card_scroll = tk.Scrollbar(
            left_wrap,
            orient="vertical",
            command=self.card_canvas.yview,
            width=18,
        )
        card_scroll.grid(row=0, column=1, sticky="ns")
        self.card_canvas.configure(yscrollcommand=card_scroll.set)

        self.stations_frame = tk.Frame(self.card_canvas, bg="#08111f")
        self.card_window = self.card_canvas.create_window(
            (0, 0),
            window=self.stations_frame,
            anchor="nw",
        )

        def _on_card_configure(_event=None):
            self.card_canvas.configure(
                scrollregion=self.card_canvas.bbox("all"),
            )
            try:
                self.card_canvas.itemconfigure(
                    self.card_window,
                    width=self.card_canvas.winfo_width(),
                )
            except Exception:
                pass

        self.stations_frame.bind("<Configure>", _on_card_configure)
        self.card_canvas.bind("<Configure>", _on_card_configure)
        self.card_canvas.bind_all(
            "<MouseWheel>",
            lambda e: self.card_canvas.yview_scroll(
                int(-1 * (e.delta / 120)),
                "units",
            ),
        )

        # 設定區（PR20 模式：預設隱藏，密碼解鎖後才展開）
        self.right_wrap = tk.Frame(self.main_pane, bg="#08111f")
        self.right_wrap.rowconfigure(0, weight=1)
        self.right_wrap.columnconfigure(0, weight=1)

        # V4.4：加入左右窗格；解鎖後可拖曳中間分隔線調整設定面板寬度
        try:
            self.main_pane.add(left_wrap, minsize=520)
            self.main_pane.add(self.right_wrap, minsize=560)
            self.root.after(300, self.place_main_sash_safe)
        except Exception:
            pass

        self.right_canvas = tk.Canvas(
            self.right_wrap,
            bg="#0b0f14",
            highlightthickness=0,
            borderwidth=0,
            width=560,
        )
        self.right_canvas.grid(row=0, column=0, sticky="nsew")

        right_scroll = tk.Scrollbar(
            self.right_wrap,
            orient="vertical",
            command=self.right_canvas.yview,
            width=18,
        )
        right_scroll.grid(row=0, column=1, sticky="ns")

        self.right_canvas.configure(yscrollcommand=right_scroll.set)

        self.sel_frame = tk.Frame(
            self.right_canvas,
            bg="#111827",
            padx=16,
            pady=12,
            width=660,
        )

        self.right_window = self.right_canvas.create_window(
            (0, 0),
            window=self.sel_frame,
            anchor="nw",
        )

        def _on_right_configure(_event=None):
            self.right_canvas.configure(
                scrollregion=self.right_canvas.bbox("all")
            )
            try:
                self.right_canvas.itemconfigure(
                    self.right_window,
                    width=self.right_canvas.winfo_width(),
                )
            except Exception:
                pass

        self.sel_frame.bind("<Configure>", _on_right_configure)
        self.right_canvas.bind("<Configure>", _on_right_configure)

        self.right_canvas.bind_all(
            "<Shift-MouseWheel>",
            lambda e: self.right_canvas.yview_scroll(
                int(-1 * (e.delta / 120)),
                "units",
            ),
        )

        tk.Label(
            self.sel_frame,
            text="SETTING / CONFIG PANEL",
            bg="#111827",
            fg="#38bdf8",
            font=("Arial", 16, "bold"),
        ).grid(row=0, column=0, columnspan=5, sticky="we", pady=(0, 8))
        # V4.4：設定面板欄位加寬，Name / PV / SV / Email / LINE 較不擠
        for _c in range(5):
            self.sel_frame.columnconfigure(_c, weight=1 if _c in (2, 3, 4) else 0)


        # 通訊參數
        serial_box = tk.LabelFrame(
            self.sel_frame,
            text="RTU 通訊參數",
            bg="#111827",
            fg="#e5e7eb",
            padx=6,
            pady=6,
        )
        serial_box.grid(
            row=1,
            column=0,
            columnspan=5,
            sticky="we",
            pady=(0, 8),
        )

        for c in range(4):
            serial_box.columnconfigure(c, weight=1)

        tk.Label(
            serial_box,
            text="Baud",
            bg="#111827",
            fg="#e5e7eb",
            font=("Arial", 10, "bold"),
        ).grid(row=0, column=0, sticky="w")
        baud_cb = ttk.Combobox(
            serial_box,
            textvariable=self.baud_var,
            values=[
                "1200",
                "2400",
                "4800",
                "9600",
                "19200",
                "38400",
                "57600",
                "115200",
                    ],
            width=8,
            state="readonly",
        )
        baud_cb.grid(row=0, column=1, padx=4, sticky="w")
        self._lock_widgets.append(baud_cb)

        tk.Label(
            serial_box,
            text="Parity",
            bg="#111827",
            fg="#e5e7eb",
            font=("Arial", 10, "bold"),
        ).grid(row=0, column=2, sticky="w")
        parity_cb = ttk.Combobox(
            serial_box,
            textvariable=self.parity_var,
            values=["N", "E", "O"],
            width=4,
            state="readonly",
        )
        parity_cb.grid(row=0, column=3, padx=4, sticky="w")
        self._lock_widgets.append(parity_cb)

        tk.Label(
            serial_box,
            text="Stop",
            bg="#111827",
            fg="#e5e7eb",
            font=("Arial", 10, "bold"),
        ).grid(row=1, column=0, sticky="w", pady=(6, 0))
        stop_cb = ttk.Combobox(
            serial_box,
            textvariable=self.stopbits_var,
            values=["1", "2"],
            width=4,
            state="readonly",
        )
        stop_cb.grid(row=1, column=1, padx=4, sticky="w", pady=(6, 0))
        self._lock_widgets.append(stop_cb)

        tk.Label(
            serial_box,
            text="Bits",
            bg="#111827",
            fg="#e5e7eb",
            font=("Arial", 10, "bold"),
        ).grid(row=1, column=2, sticky="w", pady=(6, 0))
        bits_cb = ttk.Combobox(
            serial_box,
            textvariable=self.bytesize_var,
            values=["7", "8"],
            width=4,
            state="readonly",
        )
        bits_cb.grid(row=1, column=3, padx=4, sticky="w", pady=(6, 0))
        self._lock_widgets.append(bits_cb)

        tk.Label(
            serial_box,
            text="Timeout",
            bg="#111827",
            fg="#e5e7eb",
            font=("Arial", 10, "bold"),
        ).grid(row=2, column=0, sticky="w", pady=(6, 0))
        timeout_ent = tk.Entry(
            serial_box,
            textvariable=self.timeout_var,
            width=8,
            bg="#1f2937",
            fg="white",
            insertbackground="white",
        )
        timeout_ent.grid(row=2, column=1, padx=4, sticky="w", pady=(6, 0))
        self._lock_widgets.append(timeout_ent)

        self.apply_serial_btn = tk.Button(
            serial_box,
            text="套用通訊",
            command=self.apply_serial_settings,
            bg="#334155",
            fg="white",
            font=("Arial", 10, "bold"),
        )
        self.apply_serial_btn.grid(
            row=2,
            column=2,
            columnspan=2,
            sticky="we",
            pady=(6, 0),
        )
        self._lock_widgets.append(self.apply_serial_btn)

        # 間隔設定
        interval_box = tk.LabelFrame(
            self.sel_frame,
            text="讀取設定",
            bg="#111827",
            fg="#e5e7eb",
            padx=6,
            pady=6,
        )
        interval_box.grid(
            row=2,
            column=0,
            columnspan=5,
            sticky="we",
            pady=(0, 8),
        )

        tk.Label(
            interval_box,
            text="間隔秒數",
            bg="#111827",
            fg="#e5e7eb",
            font=("Arial", 11, "bold"),
        ).grid(row=0, column=0, sticky="w")
        interval_ent = tk.Entry(
            interval_box,
            textvariable=self.interval_var,
            width=8,
            bg="#1f2937",
            fg="white",
            insertbackground="white",
            font=("Arial", 12, "bold"),
        )
        interval_ent.grid(row=0, column=1, padx=6, sticky="w")
        self._lock_widgets.append(interval_ent)

        # V4.6 WEB：LAN IP / Port 手動設定
        tk.Label(
            interval_box,
            text="LAN IP",
            bg="#111827",
            fg="#e5e7eb",
            font=("Arial", 11, "bold"),
        ).grid(row=1, column=0, sticky="w", pady=(8, 0))
        lan_ip_ent = tk.Entry(
            interval_box,
            textvariable=self.web_lan_ip_var,
            width=16,
            bg="#1f2937",
            fg="white",
            insertbackground="white",
            font=("Arial", 11, "bold"),
        )
        lan_ip_ent.grid(row=1, column=1, padx=6, sticky="w", pady=(8, 0))
        self._lock_widgets.append(lan_ip_ent)

        tk.Label(
            interval_box,
            text="Port",
            bg="#111827",
            fg="#e5e7eb",
            font=("Arial", 11, "bold"),
        ).grid(row=1, column=2, sticky="w", padx=(10, 0), pady=(8, 0))
        web_port_ent = tk.Entry(
            interval_box,
            textvariable=self.web_port_var,
            width=8,
            bg="#1f2937",
            fg="white",
            insertbackground="white",
            font=("Arial", 11, "bold"),
        )
        web_port_ent.grid(row=1, column=3, padx=6, sticky="w", pady=(8, 0))
        self._lock_widgets.append(web_port_ent)

        self.apply_web_btn = tk.Button(
            interval_box,
            text="套用 Web",
            command=self.apply_web_settings,
            bg="#0891b2",
            fg="white",
            font=("Arial", 10, "bold"),
        )
        self.apply_web_btn.grid(row=2, column=0, columnspan=4, sticky="we", padx=2, pady=(8, 0))
        self._lock_widgets.append(self.apply_web_btn)

        tk.Label(
            interval_box,
            text="可輸入多個 LAN IP，用逗號或空白分隔；留空 = 自動偵測；Server 監聽 0.0.0.0",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 9, "bold"),
            wraplength=500,
            justify="left",
        ).grid(row=3, column=0, columnspan=4, sticky="w", padx=2, pady=(6, 0))

        # =====================================================
        # CH 新增 / 刪除控制（取代打勾方式）
        # =====================================================
        ch_ctrl = tk.Frame(self.sel_frame, bg="#111827")
        ch_ctrl.grid(row=3, column=0, columnspan=5, sticky="we", pady=(0, 14))

        tk.Label(
            ch_ctrl,
            text="CH 管理",
            bg="#111827",
            fg="#38bdf8",
            font=("Arial", 11, "bold"),
        ).pack(side="left", padx=(0, 8))

        tk.Label(
            ch_ctrl,
            text="CH 數量",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 10, "bold"),
        ).pack(side="left", padx=(0, 4))

        self.channel_count_cb = ttk.Combobox(
            ch_ctrl,
            textvariable=self.channel_count_var,
            values=[str(i) for i in range(1, self.max_unit_id + 1)],
            width=5,
            state="readonly",
        )
        self.channel_count_cb.pack(side="left", padx=(0, 4))
        self._lock_widgets.append(self.channel_count_cb)

        self.apply_ch_count_btn = tk.Button(
            ch_ctrl,
            text="套用 CH 數量",
            command=self.apply_channel_count,
            bg="#0ea5e9",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        )
        self.apply_ch_count_btn.pack(side="left", padx=(0, 10))
        self._lock_widgets.append(self.apply_ch_count_btn)

        self.add_ch_var = tk.StringVar(value="CH01")

        add_ch_cb = ttk.Combobox(
            ch_ctrl,
            textvariable=self.add_ch_var,
            values=[f"CH{i:02d}" for i in range(1, self.max_unit_id + 1)],
            width=10,
            state="readonly",
        )
        add_ch_cb.pack(side="left")
        self._lock_widgets.append(add_ch_cb)

        tk.Button(
            ch_ctrl,
            text="➕ 新增",
            command=self.add_channel,
            bg="#00AA00",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).pack(side="left", padx=4)

        tk.Button(
            ch_ctrl,
            text="➖ 移除",
            command=self.remove_channel,
            bg="#AA2222",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).pack(side="left", padx=4)

        # CH 設定表頭
        tk.Label(
            self.sel_frame,
            text="CH",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 10, "bold"),
        ).grid(row=5, column=0, sticky="w", padx=3, pady=(8, 4))
        tk.Label(
            self.sel_frame,
            text="Slave",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 10, "bold"),
        ).grid(row=5, column=1, sticky="w", padx=3, pady=(8, 4))
        tk.Label(
            self.sel_frame,
            text="Name",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 10, "bold"),
        ).grid(row=5, column=2, sticky="w", padx=3, pady=(8, 4))
        tk.Label(
            self.sel_frame,
            text="PV",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 10, "bold"),
        ).grid(row=5, column=3, sticky="w", padx=3, pady=(8, 4))
        tk.Label(
            self.sel_frame,
            text="SV",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 10, "bold"),
        ).grid(row=5, column=4, sticky="w", padx=3, pady=(8, 4))

        self.check_buttons = {}

        for uid in range(1, self.max_unit_id + 1):
            row = 6 + uid

            tk.Label(
                self.sel_frame,
                text=f"CH{uid:02d}",
                bg="#111827",
                fg="#22c55e",
                font=("Arial", 10, "bold"),
                width=6,
            ).grid(row=row, column=0, sticky="w", padx=2)

            self.check_buttons[uid] = None

            tk.Label(
                self.sel_frame,
                text=str(uid),
                bg="#111827",
                fg="#38bdf8",
                font=("Arial", 10, "bold"),
                width=4,
            ).grid(row=row, column=1, sticky="w", padx=2)

            e_name = tk.Entry(
                self.sel_frame,
                textvariable=self.unit_name_vars[uid],
                width=14,
                bg="#1f2937",
                fg="white",
                insertbackground="white",
            )
            e_name.grid(row=row, column=2, sticky="we", padx=2)
            self._lock_widgets.append(e_name)

            e_pv = tk.Entry(
                self.sel_frame,
                textvariable=self.unit_pv_vars[uid],
                width=8,
                bg="#1f2937",
                fg="white",
                insertbackground="white",
            )
            e_pv.grid(row=row, column=3, sticky="we", padx=2)
            self._lock_widgets.append(e_pv)

            e_sv = tk.Entry(
                self.sel_frame,
                textvariable=self.unit_sv_vars[uid],
                width=8,
                bg="#1f2937",
                fg="white",
                insertbackground="white",
            )
            e_sv.grid(row=row, column=4, sticky="we", padx=2)
            self._lock_widgets.append(e_sv)

        base_row = 6 + self.max_unit_id + 2
        self.config_tools_row = base_row

        # =====================================================
        # 功能按鈕區（重新對齊 PR20 風格）
        # =====================================================
        btn_area = tk.Frame(self.sel_frame, bg="#111827")
        btn_area.grid(
            row=base_row,
            column=0,
            columnspan=5,
            sticky="we",
            pady=(10, 6),
        )

        for c in range(2):
            btn_area.columnconfigure(c, weight=1)

        self.apply_btn = tk.Button(
            btn_area,
            text="✅ 套用 CH",
            command=self.apply_unit_selection,
            bg="#00AA00",
            fg="white",
            activebackground="#00CC00",
            activeforeground="white",
            relief="flat",
            font=("Courier", 11, "bold"),
            height=2,
        )
        self.apply_btn.grid(row=0, column=0, sticky="we", padx=4, pady=4)
        self._lock_widgets.append(self.apply_btn)

        self.apply_name_btn = tk.Button(
            btn_area,
            text="📝 套用名稱",
            command=self.apply_names_and_reconnect,
            bg="#2563EB",
            fg="white",
            activebackground="#3B82F6",
            activeforeground="white",
            relief="flat",
            font=("Courier", 11, "bold"),
            height=2,
        )
        self.apply_name_btn.grid(row=0, column=1, sticky="we", padx=4, pady=4)
        self._lock_widgets.append(self.apply_name_btn)

        self.save_btn = tk.Button(
            btn_area,
            text="💾 儲存設定",
            command=self.save_config,
            bg="#F59E0B",
            fg="black",
            activebackground="#FBBF24",
            activeforeground="black",
            relief="flat",
            font=("Courier", 11, "bold"),
            height=2,
        )
        self.save_btn.grid(
            row=1,
            column=0,
            columnspan=2,
            sticky="we",
            padx=4,
            pady=4,
        )
        self._lock_widgets.append(self.save_btn)

        self.unlock_btn = tk.Button(
            btn_area,
            text="🔓 解鎖",
            command=self.unlock_dialog,
            font=("Arial", 11, "bold"),
            bg="#0ea5e9",
            fg="white",
            relief="flat",
            height=2,
        )
        self.unlock_btn.grid(row=2, column=0, sticky="we", padx=4, pady=4)

        self.lock_btn = tk.Button(
            btn_area,
            text="🔒 上鎖",
            command=self.lock_settings,
            font=("Arial", 11, "bold"),
            bg="#ef4444",
            fg="white",
            relief="flat",
            height=2,
        )
        self.lock_btn.grid(row=2, column=1, sticky="we", padx=4, pady=4)

        self.change_pw_btn = tk.Button(
            btn_area,
            text="🔑 修改密碼",
            command=self.change_password_dialog,
            font=("Arial", 11, "bold"),
            bg="#facc15",
            fg="black",
            relief="flat",
            height=2,
        )
        self.change_pw_btn.grid(
            row=3,
            column=0,
            columnspan=2,
            sticky="we",
            padx=4,
            pady=4,
        )
        self._lock_widgets.append(self.change_pw_btn)

        # Trend 設定：可設定每秒或每分自動更新
        trend_ctrl = tk.LabelFrame(
            btn_area,
            text="📈 Trend 趨勢圖",
            bg="#111827",
            fg="#e5e7eb",
            padx=6,
            pady=6,
        )
        trend_ctrl.grid(
            row=4,
            column=0,
            columnspan=2,
            sticky="we",
            padx=4,
            pady=(8, 4),
        )
        trend_ctrl.columnconfigure(1, weight=1)

        tk.Checkbutton(
            trend_ctrl,
            text="自動更新",
            variable=self.trend_enable_var,
            bg="#111827",
            fg="#22c55e",
            selectcolor="#111827",
            activebackground="#111827",
            activeforeground="#22c55e",
            font=("Arial", 10, "bold"),
        ).grid(row=0, column=0, sticky="w", padx=2, pady=2)

        # V3.8R：取消畫面上的「滑鼠滾輪放大/縮小」提示文字。
        # 保留空白位置，避免後面元件排版大幅位移。
        tk.Label(
            trend_ctrl,
            text="",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 10, "bold"),
        ).grid(row=0, column=1, columnspan=2, sticky="w", padx=2)

        tk.Label(
            trend_ctrl,
            text="保留筆數",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 10, "bold"),
        ).grid(row=1, column=0, sticky="w", padx=2, pady=(4, 2))

        trend_points_cb = ttk.Combobox(
            trend_ctrl,
            textvariable=self.trend_max_points_var,
            values=["100", "300", "600", "1200", "3600", "7200", "14400", "28800", "57600"],
            width=8,
            state="readonly",
        )
        trend_points_cb.grid(row=1, column=1, sticky="w", padx=2, pady=(4, 2))
        self._lock_widgets.append(trend_points_cb)

        tk.Button(
            trend_ctrl,
            text="📈 趨勢圖",
            command=self.open_trend_window,
            bg="#7c3aed",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=1, column=2, sticky="we", padx=2, pady=(4, 2))

        tk.Button(
            trend_ctrl,
            text="💾 存檔",
            command=self.save_trend_report,
            bg="#16a34a",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=2, column=0, sticky="we", padx=2, pady=(4, 2))

        tk.Button(
            trend_ctrl,
            text="🖨 列印",
            command=self.print_trend_report,
            bg="#0ea5e9",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=2, column=1, sticky="we", padx=2, pady=(4, 2))

        tk.Button(
            trend_ctrl,
            text="📂 路徑",
            command=self.choose_report_folder,
            bg="#64748b",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=4, column=0, sticky="we", padx=2, pady=(4, 2))

        ttk.Combobox(
            trend_ctrl,
            textvariable=self.report_format_var,
            values=["全部", "CSV", "PNG", "PDF"],
            width=8,
            state="readonly",
        ).grid(row=4, column=1, sticky="we", padx=2, pady=(4, 2))

        tk.Button(
            trend_ctrl,
            text="📄 PDF",
            command=lambda: self.save_trend_report(show_message=True, report_format="PDF"),
            bg="#9333ea",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=4, column=2, sticky="we", padx=2, pady=(4, 2))

        tk.Button(
            trend_ctrl,
            text="📂 開啟資料夾",
            command=self.open_today_report_folder,
            bg="#0891b2",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=5, column=0, columnspan=3, sticky="we", padx=2, pady=(4, 2))

        tk.Button(
            trend_ctrl,
            text="💾 趨勢設定",
            command=self.save_trend_setting_only,
            bg="#f59e0b",
            fg="black",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=6, column=0, columnspan=3, sticky="we", padx=2, pady=(4, 2))

        tk.Button(
            trend_ctrl,
            text="♻ MAX/MIN請除",
            command=self.clear_trend_stats,
            bg="#f97316",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=2, column=2, sticky="we", padx=2, pady=(4, 2))

        tk.Button(
            trend_ctrl,
            text="📅 取樣日期",
            command=self.open_sample_setting_dialog,
            bg="#0f766e",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=3, column=0, sticky="we", padx=2, pady=(4, 2))

        tk.Button(
            trend_ctrl,
            text="📋 報表設定",
            command=self.open_report_setting_dialog,
            bg="#334155",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
        ).grid(row=3, column=1, columnspan=2, sticky="we", padx=2, pady=(4, 2))

        # =====================================================
        # V3.8F SGS Report Setting：報表標題/公司/客戶/校正編號/路徑
        # =====================================================
        report_box = tk.LabelFrame(
            btn_area,
            text="📄 SGS 報表設定",
            bg="#111827",
            fg="#e5e7eb",
            padx=6,
            pady=6,
        )
        report_box.grid(row=5, column=0, columnspan=2, sticky="we", padx=4, pady=(8, 4))
        report_box.columnconfigure(1, weight=1)

        def _add_report_row(r, label_text, var, width=28):
            tk.Label(
                report_box,
                text=label_text,
                bg="#111827",
                fg="#facc15",
                font=("Arial", 10, "bold"),
                width=10,
                anchor="w",
            ).grid(row=r, column=0, sticky="w", padx=2, pady=2)
            ent = tk.Entry(
                report_box,
                textvariable=var,
                width=width,
                bg="#1f2937",
                fg="white",
                insertbackground="white",
            )
            ent.grid(row=r, column=1, sticky="we", padx=2, pady=2)
            self._lock_widgets.append(ent)
            return ent

        _add_report_row(0, "報表標題", self.report_title_var)
        _add_report_row(1, "公司名稱", self.company_name_var)
        _add_report_row(2, "客戶名稱", self.customer_name_var)
        _add_report_row(3, "校正編號", self.calibration_no_var)
        _add_report_row(4, "開始日期", self.sample_start_date_var)
        tk.Button(report_box, text="📅", command=lambda: self._choose_date_calendar(self.sample_start_date_var, "選擇開始日期"), bg="#0f766e", fg="white", relief="flat", font=("Arial", 10, "bold"), width=4).grid(row=4, column=2, sticky="we", padx=2, pady=2)
        _add_report_row(5, "開始時間", self.sample_start_time_var)
        _add_report_row(6, "結束日期", self.sample_end_date_var)
        tk.Button(report_box, text="📅", command=lambda: self._choose_date_calendar(self.sample_end_date_var, "選擇結束日期"), bg="#0f766e", fg="white", relief="flat", font=("Arial", 10, "bold"), width=4).grid(row=6, column=2, sticky="we", padx=2, pady=2)
        _add_report_row(7, "結束時間", self.sample_end_time_var)
        _add_report_row(8, "報表路徑", self.report_folder_var)

        choose_btn = tk.Button(
            report_box,
            text="📂 選擇",
            command=self.choose_report_folder,
            bg="#64748b",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
            width=8,
        )
        choose_btn.grid(row=8, column=2, sticky="we", padx=2, pady=2)
        self._lock_widgets.append(choose_btn)

        # =====================================================
        # V4.3 Email / LINE 設定：只有密碼解鎖後才顯示
        # =====================================================
        self.build_notify_setting_box(btn_area)

        self.apply_names_to_checkbox()

        # 開機先隱藏設定區，像 PR20 一樣等密碼正確後再顯示
        try:
            if hasattr(self, "main_pane"):
                self.main_pane.forget(self.right_wrap)
            else:
                self.right_wrap.grid_remove()
        except Exception:
            pass

        # 趨勢圖不在主畫面顯示；按「📈 趨勢圖」功能鍵才開啟獨立視窗
        self.update_clock()

    def _parse_date_for_calendar(self, date_text=None):
        """將 YYYY-MM-DD 轉成 datetime；格式錯誤時使用今天。"""
        try:
            return datetime.strptime((date_text or "").strip(), "%Y-%m-%d")
        except Exception:
            return datetime.now()

    def _choose_date_calendar(self, target_var, title="選擇日期"):
        """V3.8H：簡易萬年曆日期選擇，不需安裝 tkcalendar。"""
        if self.closing:
            return

        current = self._parse_date_for_calendar(target_var.get())
        year_var = tk.IntVar(value=current.year)
        month_var = tk.IntVar(value=current.month)

        win = tk.Toplevel(self.root)
        win.title(title)
        win.geometry("360x360")
        win.configure(bg="#111827")
        win.resizable(False, False)
        win.transient(self.root)
        win.grab_set()

        header = tk.Frame(win, bg="#111827")
        header.pack(fill="x", padx=12, pady=(12, 6))

        days_frame = tk.Frame(win, bg="#111827")
        days_frame.pack(fill="both", expand=True, padx=12, pady=6)

        def month_name():
            return f"{year_var.get():04d}-{month_var.get():02d}"

        title_var = tk.StringVar(value=month_name())

        def shift_month(delta):
            y = year_var.get()
            m = month_var.get() + delta
            while m < 1:
                m += 12
                y -= 1
            while m > 12:
                m -= 12
                y += 1
            year_var.set(y)
            month_var.set(m)
            title_var.set(month_name())
            render_days()

        tk.Button(header, text="◀", command=lambda: shift_month(-1), bg="#334155", fg="white", relief="flat", width=4).pack(side="left")
        tk.Label(header, textvariable=title_var, bg="#111827", fg="#38bdf8", font=("Arial", 18, "bold")).pack(side="left", expand=True)
        tk.Button(header, text="▶", command=lambda: shift_month(1), bg="#334155", fg="white", relief="flat", width=4).pack(side="right")

        def pick(day):
            target_var.set(f"{year_var.get():04d}-{month_var.get():02d}-{day:02d}")
            win.destroy()
            self.set_status(f"📅 日期已選擇：{target_var.get()}", "green")

        def render_days():
            for w in days_frame.winfo_children():
                w.destroy()
            week_names = ["一", "二", "三", "四", "五", "六", "日"]
            for c, name in enumerate(week_names):
                tk.Label(days_frame, text=name, bg="#111827", fg="#facc15", font=("Arial", 11, "bold"), width=4).grid(row=0, column=c, padx=2, pady=3)
            cal = calendar.Calendar(firstweekday=0).monthdayscalendar(year_var.get(), month_var.get())
            today = datetime.now()
            for r, week in enumerate(cal, start=1):
                for c, day in enumerate(week):
                    if day == 0:
                        tk.Label(days_frame, text="", bg="#111827", width=4).grid(row=r, column=c, padx=2, pady=2)
                    else:
                        bg = "#2563eb" if (year_var.get() == today.year and month_var.get() == today.month and day == today.day) else "#1f2937"
                        tk.Button(days_frame, text=str(day), command=lambda d=day: pick(d), bg=bg, fg="white", relief="flat", font=("Arial", 11, "bold"), width=4).grid(row=r, column=c, padx=2, pady=2)

        render_days()

        bottom = tk.Frame(win, bg="#111827")
        bottom.pack(fill="x", padx=12, pady=(6, 12))
        tk.Button(bottom, text="今天", command=lambda: pick(datetime.now().day) if (year_var.get()==datetime.now().year and month_var.get()==datetime.now().month) else (year_var.set(datetime.now().year), month_var.set(datetime.now().month), title_var.set(month_name()), render_days()), bg="#0f766e", fg="white", relief="flat", font=("Arial", 11, "bold"), width=10).pack(side="left", padx=4)
        tk.Button(bottom, text="取消", command=win.destroy, bg="#475569", fg="white", relief="flat", font=("Arial", 11, "bold"), width=10).pack(side="right", padx=4)

    def _close_trend_window_red(self, btn=None):
        """V3.8H：關閉鍵按下時先變紅，再關閉趨勢視窗。"""
        try:
            if btn is not None:
                btn.config(bg="#dc2626", activebackground="#991b1b", fg="white")
                if self.trend_window is not None and self.trend_window.winfo_exists():
                    self.trend_window.after(120, self.close_trend_window)
                    return
        except Exception:
            pass
        self.close_trend_window()

    def open_sample_setting_dialog(self):
        """V3.8G：取樣日期 / 時間設定視窗。"""
        self._open_report_dialog(mode="sample")

    def open_report_setting_dialog(self):
        """V3.8G：報表標題 / 公司 / 客戶 / 校正編號 / 路徑設定視窗。"""
        self._open_report_dialog(mode="report")

    def _open_report_dialog(self, mode="report"):
        """報表設定共用視窗。mode='sample' 只顯示取樣欄位；mode='report' 顯示完整報表欄位。"""
        if self.closing:
            return

        win = tk.Toplevel(self.root)
        win.title("取樣日期設定" if mode == "sample" else "SGS 報表設定")
        win.geometry("640x520" if mode != "sample" else "560x320")
        win.configure(bg="#111827")
        win.resizable(False, False)
        win.transient(self.root)
        win.grab_set()

        title_text = "📅 取樣日期設定" if mode == "sample" else "📋 SGS 報表設定"
        tk.Label(
            win,
            text=title_text,
            bg="#111827",
            fg="#38bdf8",
            font=("Arial", 18, "bold"),
        ).pack(anchor="w", padx=18, pady=(16, 10))

        body = tk.Frame(win, bg="#111827")
        body.pack(fill="both", expand=True, padx=18, pady=4)
        body.columnconfigure(1, weight=1)

        row = 0
        def add_row(label_text, var, width=38):
            nonlocal row
            tk.Label(
                body,
                text=label_text,
                bg="#111827",
                fg="#facc15",
                font=("Arial", 11, "bold"),
                width=12,
                anchor="w",
            ).grid(row=row, column=0, sticky="w", padx=4, pady=5)
            ent = tk.Entry(
                body,
                textvariable=var,
                width=width,
                bg="#1f2937",
                fg="white",
                insertbackground="white",
                font=("Arial", 11, "bold"),
            )
            ent.grid(row=row, column=1, sticky="we", padx=4, pady=5)
            row += 1
            return ent

        if mode != "sample":
            add_row("報表標題", self.report_title_var)
            add_row("公司名稱", self.company_name_var)
            add_row("客戶名稱", self.customer_name_var)
            add_row("校正編號", self.calibration_no_var)

        add_row("開始日期", self.sample_start_date_var)
        tk.Button(body, text="📅", command=lambda: self._choose_date_calendar(self.sample_start_date_var, "選擇開始日期"), bg="#0f766e", fg="white", relief="flat", font=("Arial", 10, "bold"), width=6).grid(row=row-1, column=2, sticky="we", padx=4, pady=5)
        add_row("開始時間", self.sample_start_time_var)
        add_row("結束日期", self.sample_end_date_var)
        tk.Button(body, text="📅", command=lambda: self._choose_date_calendar(self.sample_end_date_var, "選擇結束日期"), bg="#0f766e", fg="white", relief="flat", font=("Arial", 10, "bold"), width=6).grid(row=row-1, column=2, sticky="we", padx=4, pady=5)
        add_row("結束時間", self.sample_end_time_var)

        if mode != "sample":
            add_row("報表路徑", self.report_folder_var)
            def browse_folder():
                try:
                    init = os.path.expanduser(self.report_folder_var.get() or self.trend_report_folder)
                    os.makedirs(init, exist_ok=True)
                except Exception:
                    init = os.path.expanduser("~")
                folder = filedialog.askdirectory(title="選擇報表存放位置", initialdir=init)
                if folder:
                    folder = self.normalize_report_folder(folder)
                    self.report_folder_var.set(folder)
                    self.trend_report_folder = folder
            tk.Button(
                body,
                text="📂 選擇",
                command=browse_folder,
                bg="#64748b",
                fg="white",
                relief="flat",
                font=("Arial", 10, "bold"),
                width=8,
            ).grid(row=row-1, column=2, sticky="we", padx=4, pady=5)

        hint = tk.Label(
            win,
            text="日期格式：YYYY-MM-DD    時間格式：HH:MM:SS",
            bg="#111827",
            fg="#94a3b8",
            font=("Arial", 10, "bold"),
        )
        hint.pack(anchor="w", padx=18, pady=(2, 6))

        btns = tk.Frame(win, bg="#111827")
        btns.pack(fill="x", padx=18, pady=(4, 14))

        def apply_only():
            try:
                self.trend_report_folder = self.normalize_report_folder(self.report_folder_var.get() or self.trend_report_folder)
                self.report_folder_var.set(self.trend_report_folder)
            except Exception:
                pass
            self.set_status("✅ 報表 / 取樣設定已套用", "green")
            win.destroy()

        def save_and_close():
            apply_only()
            if self.is_unlocked:
                self.save_config()
            else:
                self.save_report_config_only()

        tk.Button(btns, text="套用", command=apply_only, bg="#16a34a", fg="white", relief="flat", font=("Arial", 11, "bold"), width=10).pack(side="right", padx=4)
        tk.Button(btns, text="儲存", command=save_and_close, bg="#f59e0b", fg="black", relief="flat", font=("Arial", 11, "bold"), width=10).pack(side="right", padx=4)
        tk.Button(btns, text="取消", command=win.destroy, bg="#475569", fg="white", relief="flat", font=("Arial", 11, "bold"), width=10).pack(side="right", padx=4)

        win.bind("<Return>", lambda _e: apply_only())
        win.bind("<Escape>", lambda _e: win.destroy())

    def save_report_config_only(self):
        """未解鎖時也可儲存報表標題、公司、客戶、校正編號、取樣日期與路徑。"""
        try:
            cfg = {}
            if os.path.exists(self.config_path):
                with open(self.config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f) or {}
            cfg.setdefault("report", {})
            clean_report_folder = self.normalize_report_folder(self.report_folder_var.get() or self.trend_report_folder)
            self.report_folder_var.set(clean_report_folder)
            self.trend_report_folder = clean_report_folder
            cfg["report"].update({
                "title": self._report_text(self.report_title_var, "SGS Temperature Validation Report"),
                "company_name": self._report_text(self.company_name_var, "CM LAB"),
                "customer_name": self._report_text(self.customer_name_var, "ADVANTECH"),
                "calibration_no": self._report_text(self.calibration_no_var, "CM-2026-001"),
                "start_date": self._report_metadata()["start_date"].replace("/", "-"),
                "start_time": self._report_metadata()["start_time"],
                "end_date": self._report_metadata()["end_date"].replace("/", "-"),
                "end_time": self._report_metadata()["end_time"],
                "folder": clean_report_folder,
                "format": self.report_format_var.get() or "全部",
            })
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            self.set_status("💾 報表設定已儲存", "green")
        except Exception as e:
            self.write_error_log(f"save report config only error: {e}")
            messagebox.showerror("錯誤", f"❌ 報表設定儲存失敗：{e}")

    def update_clock(self):
        """Header 時鐘。"""
        if self.closing:
            return
        try:
            self.time_var.set(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
            self.root.after(1000, self.update_clock)
        except Exception:
            pass

    # =========================================================
    # V3.7 Trend SCADA：內嵌即時滾動趨勢圖
    # =========================================================
    def open_trend_window(self):
        """按「趨勢圖」功能鍵時，才開啟即時滾動趨勢視窗。
        V3.8I：圖表放上方，控制列/CH 勾選移到最下方，方便多 CH 顯示。
        """
        if self.closing:
            return

        # 已經開啟時，只拉到最前面
        try:
            if self.trend_window is not None and self.trend_window.winfo_exists():
                self.trend_window.lift()
                self.trend_window.focus_force()
                self._draw_trend_plot()
                return
        except Exception:
            pass

        win = tk.Toplevel(self.root)
        self.trend_window = win
        win.title("EC62 即時滾動趨勢圖 V5.2L SCADA Top Ribbon / CH / Button Zoom Third Line")
        win.geometry("1280x820")
        win.minsize(1100, 680)
        win.configure(bg="#0b0f14")
        win.transient(self.root)

        # 視窗關閉時只關趨勢圖，不影響主程式讀取
        win.protocol("WM_DELETE_WINDOW", self.close_trend_window)

        # =====================================================
        # V5.2L：SCADA 趨勢視窗固定版面
        #
        # 說明：
        # 1) Ribbon 功能鍵固定第一行，永遠看得到。
        # 2) CH 勾選/選擇列固定第二行，不會被趨勢圖蓋住。
        # 3) Button Zoom / CH / X / Y 狀態文字固定第三行。
        # 4) 取消 MAX / MIN / AVG / Sample 統計文字顯示。
        # 5) 趨勢圖從第三行下方開始，增加圖表可視範圍。
        # =====================================================
        scroll_wrap = tk.Frame(win, bg="#0b0f14")
        scroll_wrap.pack(fill="both", expand=True)

        trend_scroll_canvas = tk.Canvas(
            scroll_wrap,
            bg="#0b0f14",
            highlightthickness=0,
            borderwidth=0,
        )
        trend_scrollbar = tk.Scrollbar(
            scroll_wrap,
            orient="vertical",
            command=trend_scroll_canvas.yview,
            width=18,
        )
        trend_scroll_canvas.configure(yscrollcommand=trend_scrollbar.set)
        trend_scroll_canvas.pack(side="left", fill="both", expand=True)
        trend_scrollbar.pack(side="right", fill="y")

        trend_body = tk.Frame(trend_scroll_canvas, bg="#0b0f14")
        trend_body_window = trend_scroll_canvas.create_window(
            (0, 0),
            window=trend_body,
            anchor="nw",
        )

        def _trend_scroll_configure(_event=None):
            try:
                trend_scroll_canvas.configure(scrollregion=trend_scroll_canvas.bbox("all"))
                trend_scroll_canvas.itemconfigure(
                    trend_body_window,
                    width=trend_scroll_canvas.winfo_width(),
                )
            except Exception:
                pass

        trend_body.bind("<Configure>", _trend_scroll_configure)
        trend_scroll_canvas.bind("<Configure>", _trend_scroll_configure)

        def _trend_mousewheel(event):
            try:
                delta = -1 if getattr(event, "delta", 0) > 0 else 1
                if getattr(event, "num", None) == 4:
                    delta = -1
                elif getattr(event, "num", None) == 5:
                    delta = 1
                trend_scroll_canvas.yview_scroll(delta * 3, "units")
            except Exception:
                pass

        for _w in (win, scroll_wrap, trend_scroll_canvas, trend_body):
            try:
                _w.bind("<MouseWheel>", _trend_mousewheel)
                _w.bind("<Button-4>", _trend_mousewheel)
                _w.bind("<Button-5>", _trend_mousewheel)
            except Exception:
                pass

        # 圖表區：固定高度，避免 expand=True 把下方 Ribbon 功能列擠掉 / 蓋住
        graph_frame = tk.Frame(trend_body, bg="#020617", padx=8, pady=8, height=500)
        graph_frame.pack(fill="x", expand=False, padx=10, pady=(10, 4))
        graph_frame.pack_propagate(False)

        if not MATPLOTLIB_OK:
            tk.Label(
                graph_frame,
                text="未安裝 matplotlib，請執行：pip install matplotlib",
                bg="#020617",
                fg="#ef4444",
                font=("Arial", 18, "bold"),
            ).pack(fill="both", expand=True)
            return

        self.trend_fig = Figure(figsize=(11.2, 5.0), dpi=100)
        self.trend_ax = self.trend_fig.add_subplot(111)
        self.trend_fig.patch.set_facecolor("#020617")

        self.trend_canvas = FigureCanvasTkAgg(self.trend_fig, master=graph_frame)
        self.trend_canvas.get_tk_widget().pack(fill="both", expand=True)
        try:
            self.trend_canvas.get_tk_widget().bind("<MouseWheel>", _trend_mousewheel)
            self.trend_canvas.get_tk_widget().bind("<Button-4>", _trend_mousewheel)
            self.trend_canvas.get_tk_widget().bind("<Button-5>", _trend_mousewheel)
        except Exception:
            pass

        # V3.8R：取消滑鼠滾輪縮放與拖曳平移。
        # 原因：現場使用滾輪時圖表會左右跳動不穩。
        # 目前只保留「雙擊圖表」恢復全部範圍，不再綁定 scroll_event / motion_notify_event。
        try:
            self.trend_canvas.mpl_connect("button_press_event", self.on_trend_mouse_press)
            self.trend_canvas.mpl_connect("button_release_event", self.on_trend_mouse_release)
        except Exception as e:
            self.write_error_log(f"trend mouse event connect error: {e}")

        # 狀態 / 統計區
        info = tk.Label(
            trend_body,
            textvariable=self.trend_info_var,
            bg="#0b0f14",
            fg="#facc15",
            font=("Arial", 11, "bold"),
            anchor="w",
            padx=10,
        )
        info.pack(fill="x", pady=(2, 0))

        stats = tk.Label(
            trend_body,
            textvariable=self.trend_stats_text_var,
            bg="#0b0f14",
            fg="#22c55e",
            font=("Consolas", 10, "bold"),
            justify="left",
            anchor="w",
            padx=10,
        )
        stats.pack(fill="x", pady=(2, 2))

        # =====================================================
        # V5.2D：CH 勾選區改成按鍵彈出，不固定佔用趨勢圖高度
        # =====================================================
        trend_ch_summary_var = tk.StringVar(value="")

        def _update_trend_ch_summary():
            try:
                selected = self.get_selected_trend_channels()
                if len(selected) >= self.channel_count:
                    txt = f"已選擇：全部 CH01~CH{self.channel_count:02d}"
                elif len(selected) <= 8:
                    txt = "已選擇：" + ", ".join([f"CH{x:02d}" for x in selected])
                else:
                    txt = f"已選擇：{len(selected)} CH"
                trend_ch_summary_var.set(txt)
            except Exception:
                trend_ch_summary_var.set("已選擇：--")

        def _draw_and_update_ch_summary():
            try:
                _update_trend_ch_summary()
                self._draw_trend_plot()
            except Exception:
                pass

        def _select_all_ch_popup():
            try:
                self.select_all_trend_channels()
                _update_trend_ch_summary()
            except Exception:
                pass

        def _clear_ch_popup():
            try:
                self.clear_all_trend_channels()
                _update_trend_ch_summary()
            except Exception:
                pass

        def _open_trend_ch_popup():
            try:
                old = getattr(self, "_trend_ch_popup", None)
                if old is not None and old.winfo_exists():
                    old.lift()
                    old.focus_force()
                    return
            except Exception:
                pass

            popup = tk.Toplevel(win)
            self._trend_ch_popup = popup
            popup.title("CH 圖表顯示選擇 / Select CH")
            popup.geometry("520x520")
            popup.minsize(460, 360)
            popup.configure(bg="#0b0f14")
            popup.transient(win)

            header = tk.Frame(popup, bg="#111827", padx=10, pady=8)
            header.pack(fill="x")
            tk.Label(
                header,
                text="CH 勾選設定 / Select CH for Trend",
                bg="#111827",
                fg="#38bdf8",
                font=("Arial", 14, "bold"),
                anchor="w",
            ).pack(side="left", fill="x", expand=True)
            tk.Button(
                header,
                text="關閉",
                command=popup.destroy,
                bg="#dc2626",
                fg="white",
                activebackground="#991b1b",
                activeforeground="white",
                relief="flat",
                font=("Arial", 10, "bold"),
                width=8,
            ).pack(side="right")

            action = tk.Frame(popup, bg="#0b0f14", padx=10, pady=8)
            action.pack(fill="x")
            tk.Button(
                action,
                text="全選",
                command=_select_all_ch_popup,
                bg="#16a34a",
                fg="white",
                relief="flat",
                font=("Arial", 10, "bold"),
                width=10,
            ).pack(side="left", padx=(0, 8))
            tk.Button(
                action,
                text="清除",
                command=_clear_ch_popup,
                bg="#dc2626",
                fg="white",
                relief="flat",
                font=("Arial", 10, "bold"),
                width=10,
            ).pack(side="left", padx=(0, 8))
            tk.Label(
                action,
                textvariable=trend_ch_summary_var,
                bg="#0b0f14",
                fg="#facc15",
                font=("Arial", 10, "bold"),
                anchor="w",
            ).pack(side="left", fill="x", expand=True)

            body_wrap = tk.Frame(popup, bg="#0b0f14", padx=10, pady=0)
            body_wrap.pack(fill="both", expand=True)
            canvas = tk.Canvas(body_wrap, bg="#111827", highlightthickness=0)
            vsb = tk.Scrollbar(body_wrap, orient="vertical", command=canvas.yview, width=18)
            canvas.configure(yscrollcommand=vsb.set)
            canvas.pack(side="left", fill="both", expand=True)
            vsb.pack(side="right", fill="y")

            body = tk.Frame(canvas, bg="#111827", padx=10, pady=10)
            body_id = canvas.create_window((0, 0), window=body, anchor="nw")

            def _popup_config(_event=None):
                try:
                    canvas.configure(scrollregion=canvas.bbox("all"))
                    canvas.itemconfigure(body_id, width=canvas.winfo_width())
                except Exception:
                    pass

            body.bind("<Configure>", _popup_config)
            canvas.bind("<Configure>", _popup_config)

            def _popup_wheel(event):
                try:
                    delta = -1 if getattr(event, "delta", 0) > 0 else 1
                    if getattr(event, "num", None) == 4:
                        delta = -1
                    elif getattr(event, "num", None) == 5:
                        delta = 1
                    canvas.yview_scroll(delta * 3, "units")
                except Exception:
                    pass

            for target in (popup, body_wrap, canvas, body):
                try:
                    target.bind("<MouseWheel>", _popup_wheel, add="+")
                    target.bind("<Button-4>", _popup_wheel, add="+")
                    target.bind("<Button-5>", _popup_wheel, add="+")
                except Exception:
                    pass

            for c in range(5):
                body.columnconfigure(c, weight=1)
            for idx, uid in enumerate(range(1, self.max_unit_id + 1)):
                cb = tk.Checkbutton(
                    body,
                    text=f"CH{uid:02d}",
                    variable=self.trend_ch_vars[uid],
                    command=_draw_and_update_ch_summary,
                    bg="#111827",
                    fg="#cbd5e1",
                    selectcolor="#111827",
                    activebackground="#111827",
                    activeforeground="#22c55e",
                    font=("Arial", 10, "bold"),
                    anchor="w",
                    padx=6,
                    pady=4,
                )
                cb.grid(row=idx // 5, column=idx % 5, sticky="w", padx=5, pady=3)
                try:
                    cb.bind("<MouseWheel>", _popup_wheel, add="+")
                    cb.bind("<Button-4>", _popup_wheel, add="+")
                    cb.bind("<Button-5>", _popup_wheel, add="+")
                except Exception:
                    pass

            footer = tk.Frame(popup, bg="#0b0f14", padx=10, pady=8)
            footer.pack(fill="x")
            tk.Label(
                footer,
                text="勾選後會立即更新趨勢圖；清除時會保留第一個 CH，避免空圖。",
                bg="#0b0f14",
                fg="#94a3b8",
                font=("Arial", 9, "bold"),
                anchor="w",
            ).pack(side="left", fill="x", expand=True)
            popup.bind("<Escape>", lambda _e: popup.destroy())
            _update_trend_ch_summary()
            _popup_config()

        ch_select_bar = tk.Frame(trend_body, bg="#111827", padx=10, pady=7)
        ch_select_bar.pack(fill="x", padx=10, pady=(4, 4))
        tk.Button(
            ch_select_bar,
            text="📋 CH 勾選設定...",
            command=_open_trend_ch_popup,
            bg="#0ea5e9",
            fg="white",
            activebackground="#0284c7",
            activeforeground="white",
            relief="flat",
            font=("Arial", 11, "bold"),
            width=18,
        ).pack(side="left", padx=(0, 10))
        tk.Label(
            ch_select_bar,
            textvariable=trend_ch_summary_var,
            bg="#111827",
            fg="#facc15",
            font=("Arial", 10, "bold"),
            anchor="w",
        ).pack(side="left", fill="x", expand=True)
        _update_trend_ch_summary()

        # V3.8X：趨勢設定按鈕已移到下方「⚙️ 設定功能」收合區內，避免 CH 勾選區太擠。

        # =====================================================
        # V3.8Y：即時滾動趨勢圖操作列
        #
        # 修改重點：
        # 1. 原本所有按鍵擠在同一列，螢幕較小時會導致按鍵太寬或消失。
        # 2. 改成 4 個主功能鍵：📄 報表功能 / ⚙️ 設定功能 / 📈 趨勢功能 / ❌ 離開。
        # 3. 前三組按下後才展開，再按一次收合。
        # 4. 離開鍵固定顯示在最右側，不再藏在趨勢功能內。
        # =====================================================
        # V5.2F：Ribbon 功能列固定在 win 上方，不放在可捲動 trend_body 內。
        # 先把已建立的捲動區暫時取消 pack，再依「Ribbon 上、趨勢圖下」重新 pack。
        try:
            scroll_wrap.pack_forget()
        except Exception:
            pass
        bottom = tk.Frame(win, bg="#111827", padx=6, pady=4)
        bottom.pack(side="top", fill="x", padx=8, pady=(6, 2))
        scroll_wrap.pack(side="top", fill="both", expand=True)
        for c in range(4):
            bottom.columnconfigure(c, weight=1)

        # V5.2H：原本 CH 選擇列在捲動區內，改為固定在 Ribbon 下方。
        # 先隱藏舊的 ch_select_bar，避免畫面重複顯示。
        try:
            ch_select_bar.pack_forget()
        except Exception:
            pass

        # V5.2L：取消原本在圖表下方的狀態/統計文字。
        # 其中 trend_info_var 會改放到固定第三行；MAX/MIN/AVG/Sample 不顯示。
        try:
            info.pack_forget()
        except Exception:
            pass
        try:
            stats.pack_forget()
        except Exception:
            pass

        # 標題列：只保留必要設定，避免功能按鍵太擠。
        title_row = tk.Frame(bottom, bg="#111827")
        title_row.grid(row=0, column=0, columnspan=4, sticky="ew", pady=(0, 3))
        title_row.columnconfigure(6, weight=1)

        tk.Label(
            title_row,
            text="📈 趨勢",
            bg="#111827",
            fg="#38bdf8",
            font=("Arial", 11, "bold"),
        ).grid(row=0, column=0, sticky="w", padx=(0, 8))

        tk.Checkbutton(
            title_row,
            text="自動更新",
            variable=self.trend_enable_var,
            bg="#111827",
            fg="#22c55e",
            selectcolor="#111827",
            activebackground="#111827",
            activeforeground="#22c55e",
            font=("Arial", 9, "bold"),
        ).grid(row=0, column=1, sticky="w", padx=3)

        tk.Label(
            title_row,
            text="保留",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 9, "bold"),
        ).grid(row=0, column=2, sticky="e", padx=(6, 2))

        ttk.Combobox(
            title_row,
            textvariable=self.trend_max_points_var,
            values=["100", "300", "600", "1200", "3600"],
            width=6,
            state="readonly",
        ).grid(row=0, column=3, sticky="w", padx=4)


        # V5.1B：離開鍵移到標題列右側，底部四鍵固定為「趨勢 / 報表 / 分析 / 設定」。
        title_exit_btn = tk.Button(
            title_row,
            text="❌ 離開",
            command=None,
            bg="#dc2626",
            fg="white",
            activebackground="#991b1b",
            activeforeground="white",
            relief="flat",
            font=("Arial", 9, "bold"),
            height=1,
            width=7,
        )
        title_exit_btn.config(command=lambda b=title_exit_btn: self._close_trend_window_red(b))
        title_exit_btn.grid(row=0, column=7, sticky="e", padx=(6, 0))

        # =====================================================
        # V5.2F：工業版 Ribbon 風格（Office 類似介面）
        #
        # 修改重點：
        # 1. 取消浮動 popup / 展開面板，改用 Button + 可捲動 Toplevel 下拉框。
        # 2. 上方固定一條 Ribbon bar，不會被圖表蓋住，也不會隨內容捲動消失。
        # 3. 四組功能固定顯示：趨勢功能 / 報表功能 / 分析功能 / 設定功能。
        # 4. CH01~CH30 放入「趨勢功能」下拉選單，避免按鍵過多。
        # =====================================================
        ribbon = tk.Frame(bottom, bg="#0f172a", bd=1, relief="ridge", padx=5, pady=3)
        ribbon.grid(row=1, column=0, columnspan=4, sticky="ew", pady=(1, 0))
        for c in range(4):
            ribbon.columnconfigure(c, weight=1)

        # V5.2H：固定 CH 選擇列。放在 Ribbon 正下方，趨勢圖上方。
        fixed_ch_bar = tk.Frame(bottom, bg="#0f172a", padx=5, pady=3)
        fixed_ch_bar.grid(row=2, column=0, columnspan=4, sticky="ew", pady=(2, 0))
        fixed_ch_bar.columnconfigure(1, weight=1)
        tk.Button(
            fixed_ch_bar,
            text="CH 選擇",
            command=_open_trend_ch_popup,
            bg="#0ea5e9",
            fg="white",
            activebackground="#0284c7",
            activeforeground="white",
            relief="flat",
            font=("Arial", 9, "bold"),
            height=1,
            width=9,
            padx=3,
            pady=1,
        ).grid(row=0, column=0, sticky="w", padx=(0, 8))
        tk.Label(
            fixed_ch_bar,
            textvariable=trend_ch_summary_var,
            bg="#0f172a",
            fg="#facc15",
            font=("Arial", 9, "bold"),
            anchor="w",
        ).grid(row=0, column=1, sticky="ew")

        # V5.2L：第三行固定顯示 Button Zoom / CH / X / Y 狀態文字。
        fixed_info_bar = tk.Frame(bottom, bg="#020617", padx=8, pady=3)
        fixed_info_bar.grid(row=3, column=0, columnspan=4, sticky="ew", pady=(2, 0))
        fixed_info_bar.columnconfigure(0, weight=1)
        tk.Label(
            fixed_info_bar,
            textvariable=self.trend_info_var,
            bg="#020617",
            fg="#facc15",
            font=("Consolas", 9, "bold"),
            anchor="w",
        ).grid(row=0, column=0, sticky="ew")

        # V5.2L：取消 MAX / MIN / AVG / Sample 統計文字列。
        # 注意：self.trend_stats_text_var 仍會更新，供報表/分析功能使用。

        def _safe_popup_close(popup):
            """安全關閉下拉捲動框。"""
            try:
                if popup is not None and popup.winfo_exists():
                    popup.destroy()
            except Exception:
                pass

        def _make_scroll_dropdown(col, text, bg, build_func, width=360, height=360):
            """V5.2A：建立可捲動 Ribbon 下拉框。

            Tkinter 原生 Menu 不支援捲動；CH01~CH30 或功能很多時會超出螢幕。
            本函式改用 Button + Toplevel + Canvas + Scrollbar，讓下拉框內容可用滑鼠滾輪捲動。
            """
            btn = tk.Button(
                ribbon,
                text=text,
                bg=bg,
                fg="white",
                activebackground=bg,
                activeforeground="white",
                relief="raised",
                bd=1,
                font=("Arial", 9, "bold"),
                height=1,
                padx=4,
                pady=2,
            )
            btn.grid(row=0, column=col, sticky="ew", padx=3, pady=1)

            def open_popup():
                try:
                    old = getattr(btn, "_scroll_popup", None)
                    if old is not None and old.winfo_exists():
                        old.destroy()
                        return
                except Exception:
                    pass

                popup = tk.Toplevel(win)
                btn._scroll_popup = popup
                popup.withdraw()
                popup.overrideredirect(True)
                popup.configure(bg="#020617")
                try:
                    popup.attributes("-topmost", True)
                except Exception:
                    pass

                outer = tk.Frame(popup, bg="#020617", bd=1, relief="solid")
                outer.pack(fill="both", expand=True)

                header = tk.Frame(outer, bg=bg)
                header.pack(fill="x")
                tk.Label(
                    header,
                    text=text.replace(" ▼", ""),
                    bg=bg,
                    fg="white",
                    font=("Arial", 9, "bold"),
                    anchor="w",
                    padx=8,
                    pady=4,
                ).pack(side="left", fill="x", expand=True)
                tk.Button(
                    header,
                    text="×",
                    command=lambda: _safe_popup_close(popup),
                    bg="#dc2626",
                    fg="white",
                    activebackground="#991b1b",
                    activeforeground="white",
                    relief="flat",
                    font=("Arial", 9, "bold"),
                    width=3,
                ).pack(side="right")

                body_wrap = tk.Frame(outer, bg="#111827")
                body_wrap.pack(fill="both", expand=True)

                canvas = tk.Canvas(body_wrap, bg="#111827", highlightthickness=0, width=width, height=height)
                vsb = tk.Scrollbar(body_wrap, orient="vertical", command=canvas.yview)
                canvas.configure(yscrollcommand=vsb.set)
                vsb.pack(side="right", fill="y")
                canvas.pack(side="left", fill="both", expand=True)

                body = tk.Frame(canvas, bg="#111827", padx=6, pady=6)
                body_id = canvas.create_window((0, 0), window=body, anchor="nw")

                def _on_body_config(_event=None):
                    try:
                        canvas.configure(scrollregion=canvas.bbox("all"))
                        canvas.itemconfigure(body_id, width=canvas.winfo_width())
                    except Exception:
                        pass

                body.bind("<Configure>", _on_body_config)
                canvas.bind("<Configure>", _on_body_config)

                def _wheel(event):
                    try:
                        delta = -1 if getattr(event, "delta", 0) > 0 else 1
                        if getattr(event, "num", None) == 4:
                            delta = -1
                        elif getattr(event, "num", None) == 5:
                            delta = 1
                        canvas.yview_scroll(delta * 3, "units")
                    except Exception:
                        pass

                for target in (popup, outer, body_wrap, canvas, body):
                    try:
                        target.bind("<MouseWheel>", _wheel)
                        target.bind("<Button-4>", _wheel)
                        target.bind("<Button-5>", _wheel)
                    except Exception:
                        pass

                build_func(body, popup)
                _on_body_config()

                popup.update_idletasks()
                try:
                    bx = btn.winfo_rootx()
                    by = btn.winfo_rooty()
                    bh = btn.winfo_height()
                    sw = popup.winfo_screenwidth()
                    sh = popup.winfo_screenheight()
                    pw = min(max(width + 28, popup.winfo_reqwidth()), sw - 40)
                    ph = min(max(220, popup.winfo_reqheight()), height + 70, sh - 80)
                    x = max(10, min(bx, sw - pw - 10))
                    # V5.2F：Ribbon 固定在上方，選單優先往下展開；空間不足才往上。
                    y = by + bh + 4
                    if y + ph > sh - 10:
                        y = max(10, by - ph - 4)
                    popup.geometry(f"{int(pw)}x{int(ph)}+{int(x)}+{int(y)}")
                except Exception:
                    pass

                popup.deiconify()
                popup.focus_force()
                popup.bind("<Escape>", lambda _e: _safe_popup_close(popup))
                try:
                    popup.bind("<FocusOut>", lambda _e: popup.after(180, lambda: None if popup.focus_displayof() else _safe_popup_close(popup)))
                except Exception:
                    pass

            btn.configure(command=open_popup)
            return btn

        def _dropdown_cmd(parent, label, command, bg="#1f2937", close_popup=None):
            def _run():
                try:
                    command()
                finally:
                    if close_popup is not None:
                        _safe_popup_close(close_popup)
            b = tk.Button(
                parent,
                text=label,
                command=_run,
                bg=bg,
                fg="white",
                activebackground="#2563eb",
                activeforeground="white",
                relief="flat",
                anchor="w",
                font=("Arial", 9, "bold"),
                padx=8,
                pady=4,
            )
            b.pack(fill="x", pady=1)
            return b

        def _dropdown_sep(parent):
            tk.Frame(parent, bg="#334155", height=1).pack(fill="x", pady=5)

        def _dropdown_check(parent, label, variable, command=None):
            cb = tk.Checkbutton(
                parent,
                text=label,
                variable=variable,
                command=command,
                bg="#111827",
                fg="#e5e7eb",
                selectcolor="#111827",
                activebackground="#111827",
                activeforeground="#22c55e",
                anchor="w",
                font=("Arial", 9, "bold"),
                padx=6,
                pady=2,
            )
            cb.pack(fill="x", pady=1)
            return cb

        def _build_trend_dropdown(parent, popup):
            _dropdown_check(parent, "自動更新 / Auto Update", self.trend_enable_var, self._draw_trend_plot)
            _dropdown_cmd(parent, "↔ 自動範圍 / Auto Range", self.auto_fit_trend_view, close_popup=popup)
            _dropdown_cmd(parent, "♻ 清除 MAX/MIN", self.clear_trend_stats, close_popup=popup)
            _dropdown_sep(parent)
            _dropdown_cmd(parent, "✅ 全選 CH01~CH30", self.select_all_trend_channels)
            _dropdown_cmd(parent, "清除 CH（保留第一 CH）", self.clear_all_trend_channels)
            _dropdown_sep(parent)
            tk.Label(parent, text="CH 顯示選擇 / Select CH", bg="#111827", fg="#facc15", font=("Arial", 9, "bold"), anchor="w").pack(fill="x", pady=(0, 3))
            ch_grid = tk.Frame(parent, bg="#111827")
            ch_grid.pack(fill="x")
            for i in range(4):
                ch_grid.columnconfigure(i, weight=1)
            for idx, uid in enumerate(range(1, self.max_unit_id + 1)):
                cb = tk.Checkbutton(
                    ch_grid,
                    text=f"CH{uid:02d}",
                    variable=self.trend_ch_vars[uid],
                    command=self._draw_trend_plot,
                    bg="#111827",
                    fg="#cbd5e1",
                    selectcolor="#111827",
                    activebackground="#111827",
                    activeforeground="#22c55e",
                    font=("Arial", 8, "bold"),
                    anchor="w",
                )
                cb.grid(row=idx // 4, column=idx % 4, sticky="w", padx=3, pady=1)

        def _build_report_dropdown(parent, popup):
            _dropdown_cmd(parent, "💾 存檔 / Save All", self.save_trend_report, close_popup=popup)
            _dropdown_cmd(parent, "📄 匯出 PDF", lambda: self.save_trend_report(show_message=True, report_format="PDF"), close_popup=popup)
            _dropdown_cmd(parent, "📊 匯出 CSV", lambda: self.save_trend_report(show_message=True, report_format="CSV"), close_popup=popup)
            _dropdown_cmd(parent, "🖼 儲存 PNG", lambda: self.save_trend_report(show_message=True, report_format="PNG"), close_popup=popup)
            _dropdown_sep(parent)
            _dropdown_cmd(parent, "🖨 列印 / Print", self.print_trend_report, close_popup=popup)
            _dropdown_cmd(parent, "📂 開啟今日報表資料夾", self.open_today_report_folder, close_popup=popup)

        def _build_analysis_dropdown(parent, popup):
            _dropdown_cmd(parent, "📊 更新統計 MAX / MIN / AVG / ΔT", self._draw_trend_plot, close_popup=popup)
            _dropdown_cmd(parent, "♻ MAX/MIN 歸零", self.clear_trend_stats, close_popup=popup)
            _dropdown_sep(parent)
            _dropdown_cmd(parent, "✅ 全 CH 疊圖", self.select_all_trend_channels)
            _dropdown_cmd(parent, "↔ 恢復全部資料範圍", self.auto_fit_trend_view, close_popup=popup)
            _dropdown_sep(parent)
            tk.Label(parent, text="單 CH / 多 CH：請在趨勢功能內勾選 CH", bg="#111827", fg="#facc15", font=("Arial", 9, "bold"), anchor="w", wraplength=300, justify="left").pack(fill="x", pady=3)

        def _build_setting_dropdown(parent, popup):
            _dropdown_cmd(parent, "📅 取樣日期 / 時間設定", self.open_sample_setting_dialog, close_popup=popup)
            _dropdown_cmd(parent, "📋 SGS 報表設定", self.open_report_setting_dialog, close_popup=popup)
            _dropdown_cmd(parent, "📂 報表路徑選擇", self.choose_report_folder, close_popup=popup)
            _dropdown_sep(parent)
            _dropdown_cmd(parent, "💾 儲存趨勢設定", self.save_trend_setting_only, close_popup=popup)
            _dropdown_cmd(parent, "🌐 中文 / English", self.toggle_language, close_popup=popup)

        # ---------- V5.2H 可捲動 Ribbon 小型下拉框 ----------
        _make_scroll_dropdown(0, "📈 趨勢功能 ▼", "#7c3aed", _build_trend_dropdown, width=340, height=380)
        _make_scroll_dropdown(1, "📄 報表功能 ▼", "#16a34a", _build_report_dropdown, width=300, height=270)
        _make_scroll_dropdown(2, "📊 分析功能 ▼", "#0ea5e9", _build_analysis_dropdown, width=310, height=270)
        _make_scroll_dropdown(3, "⚙️ 設定功能 ▼", "#334155", _build_setting_dropdown, width=310, height=270)

        # =====================================================
        # V5.2D：趨勢圖框可捲動 + CH 勾選彈出視窗
        #
        # 修正重點：
        # 1) 滑鼠停在圖表、CH 勾選框、統計文字、Ribbon 任一位置都可滾動。
        # 2) 使用遞迴 bind 所有子元件，避免只有空白區能捲動。
        # 3) 每次內容高度改變時自動更新 scrollregion。
        # =====================================================
        def _bind_trend_scroll_recursive(widget):
            try:
                widget.bind("<MouseWheel>", _trend_mousewheel, add="+")
                widget.bind("<Button-4>", _trend_mousewheel, add="+")
                widget.bind("<Button-5>", _trend_mousewheel, add="+")
            except Exception:
                pass
            try:
                for child in widget.winfo_children():
                    _bind_trend_scroll_recursive(child)
            except Exception:
                pass

        try:
            _bind_trend_scroll_recursive(trend_body)
            _bind_trend_scroll_recursive(scroll_wrap)
            trend_scroll_canvas.focus_set()
            _trend_scroll_configure()
        except Exception as e:
            self.write_error_log(f"trend frame scroll bind error: {e}")

        self._draw_trend_plot()
        self._schedule_trend_update()

    def close_trend_window(self):
        """關閉趨勢視窗，主程式持續監控與記錄。"""
        try:
            if self._trend_after_id is not None and self.trend_window is not None:
                self.trend_window.after_cancel(self._trend_after_id)
        except Exception:
            pass
        self._trend_after_id = None

        try:
            if self.trend_window is not None and self.trend_window.winfo_exists():
                self.trend_window.destroy()
        except Exception:
            pass

        self.trend_window = None
        self.trend_canvas = None
        self.trend_fig = None
        self.trend_ax = None

    def _trend_update_ms(self):
        """V3.8Q：趨勢圖自動重畫週期。

        中文說明：
        - 已取消「頻率」下拉選單。
        - V3.8R 已取消滑鼠滾輪縮放，避免圖表左右移動不穩。
        - 自動重畫只負責更新新資料，不再代表時間顯示範圍。
        """
        return 60000

    def add_trend_point(self, uid, value, time_text=None, autosave=True):
        """新增一筆趨勢資料，背景輪詢執行緒可安全呼叫。
        V3.8L：每筆 PV 同步寫入每日 JSONL 趨勢歷史檔，斷線/重開後可延續線圖。
        """
        if value is None:
            return
        try:
            max_points = max(10, int(self.trend_max_points_var.get() or 300))
        except Exception:
            max_points = 300

        if time_text is None:
            time_text = datetime.now().strftime("%H:%M:%S")

        try:
            val = float(value)
        except Exception:
            return

        with self._trend_lock:
            arr = self.trend_data.setdefault(uid, [])
            arr.append((time_text, val))
            if len(arr) > max_points:
                del arr[:-max_points]

        # V3.8L：自動存入趨勢歷史檔，避免斷線或程式重開後資料中斷。
        if autosave:
            self.append_trend_history_record(uid, val, time_text)

        # 趨勢視窗已開啟時，每次 PV 成功讀取後立即重畫。
        # 使用 safe_gui，避免背景輪詢執行緒直接操作 Tkinter / Matplotlib。
        try:
            if self.trend_window is not None and self.trend_canvas is not None:
                self.safe_gui(self._draw_trend_plot)
        except Exception:
            pass

    def update_trend_plot_once(self):
        """手動立即刷新趨勢圖；若視窗未開啟，先開啟。"""
        if self.trend_window is None:
            self.open_trend_window()
        else:
            self._draw_trend_plot()

    def _schedule_trend_update(self):
        """只有趨勢視窗開啟時，才排程自動更新。"""
        if self.closing or self.trend_window is None:
            return
        try:
            if self.trend_window.winfo_exists() and self.trend_enable_var.get():
                self._draw_trend_plot()
        except Exception as e:
            self.write_error_log(f"trend window update error: {e}")

        try:
            if self.trend_window is not None and self.trend_window.winfo_exists():
                self._trend_after_id = self.trend_window.after(
                    self._trend_update_ms(),
                    self._schedule_trend_update,
                )
        except Exception:
            self._trend_after_id = None

    def get_selected_trend_channels(self):
        """取得趨勢圖目前勾選的 CH。若全部未勾選，保留目前 unit_ids 避免空圖。"""
        selected = []
        for uid in list(self.unit_ids):
            try:
                if self.trend_ch_vars.get(uid) is None or self.trend_ch_vars[uid].get():
                    selected.append(uid)
            except Exception:
                selected.append(uid)
        return selected or list(self.unit_ids)

    def select_all_trend_channels(self):
        """趨勢圖 CH 全選。"""
        try:
            for uid in range(1, self.max_unit_id + 1):
                self.trend_ch_vars[uid].set(True)
        except Exception:
            pass
        self._draw_trend_plot()

    def clear_all_trend_channels(self):
        """趨勢圖 CH 全部取消；保留 CH01 避免完全空白。"""
        try:
            for uid in range(1, self.max_unit_id + 1):
                self.trend_ch_vars[uid].set(False)
            first = self.unit_ids[0] if self.unit_ids else 1
            self.trend_ch_vars[first].set(True)
        except Exception:
            pass
        self._draw_trend_plot()

    def save_trend_setting_only(self, show_message=True):
        """V3.8U：只儲存趨勢圖設定，不影響量測資料。

        中文註解：
        1. 儲存目前趨勢圖 CH 勾選狀態。
        2. 儲存保留筆數與自動更新開關。
        3. 不會清除趨勢圖資料。
        4. 不會修改 Trend_History、CSV、PDF。
        5. 下次程式開啟或重新開啟趨勢圖時，會自動套用這些設定。
        """
        try:
            cfg = {}
            if os.path.exists(self.config_path):
                try:
                    with open(self.config_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f) or {}
                except Exception:
                    cfg = {}

            cfg.setdefault("trend", {})
            cfg["trend"].update({
                "update": self.trend_update_var.get(),
                "max_points": int(self.trend_max_points_var.get() or 300),
                "enable": bool(self.trend_enable_var.get()),
                "zoom_manual": bool(getattr(self, "trend_zoom_manual", False)),
                "selected_channels": self.get_selected_trend_channels(),
            })

            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)

            self.audit("SAVE_TREND_SETTING", f"path={self.config_path}")
            self.set_status("💾 趨勢圖設定已儲存", "green")
            if show_message:
                messagebox.showinfo("完成", "✅ 趨勢圖設定已儲存\n下次開啟會自動套用 CH 勾選與保留筆數")
        except Exception as e:
            self.write_error_log(f"save trend setting only error: {e}")
            messagebox.showerror("錯誤", f"❌ 趨勢圖設定儲存失敗：{e}")

    def auto_fit_trend_view(self):
        """恢復趨勢圖全部資料範圍。

        中文說明：
        1. 可按「↔ 自動範圍」或在圖上雙擊恢復全部資料範圍。
        2. 此功能只改變畫面顯示範圍，不會清除任何趨勢資料。
        3. V3.8R 已取消滑鼠滾輪縮放，避免趨勢圖左右移動不穩。
        """
        self.trend_zoom_manual = False
        self._trend_current_xlim = None
        self._trend_drag_start = None
        self._draw_trend_plot()

    def _get_trend_total_x_range(self):
        """取得目前勾選 CH 的 X 軸資料範圍。

        中文說明：
        - X 軸使用樣本序號，不使用時間文字比較。
        - 回傳目前所有勾選 CH 中最長資料筆數的範圍。
        - 若尚無資料，回傳 None。
        """
        try:
            selected = self.get_selected_trend_channels()
            with self._trend_lock:
                max_len = max([len(self.trend_data.get(uid, [])) for uid in selected] or [0])
            if max_len <= 1:
                return None
            return (1.0, float(max_len))
        except Exception:
            return None

    def _zoom_trend_view(self, factor):
        """按鍵式趨勢圖縮放。

        factor < 1：放大
        factor > 1：縮小

        中文說明：
        1. 只改變 X 軸顯示範圍，不改變任何量測資料。
        2. 不使用滑鼠滾輪，避免圖表左右跳動不穩。
        3. 縮放中心固定在目前畫面中央，操作穩定。
        4. 按「↔ 範圍」可恢復全部資料。
        """
        try:
            if self.trend_ax is None or self.trend_canvas is None:
                return

            full_range = self._get_trend_total_x_range()
            if full_range is None:
                self.set_status("趨勢圖尚無足夠資料可縮放", "yellow")
                return

            full_min, full_max = full_range

            # 目前範圍：若尚未手動縮放，先使用目前圖表範圍。
            try:
                cur_min, cur_max = self._trend_current_xlim or self.trend_ax.get_xlim()
            except Exception:
                cur_min, cur_max = full_min, full_max

            # 避免目前範圍異常時回到完整範圍。
            if cur_max <= cur_min:
                cur_min, cur_max = full_min, full_max

            center = (cur_min + cur_max) / 2.0
            width = (cur_max - cur_min) * float(factor)
            min_width = 5.0
            max_width = max(full_max - full_min, min_width)
            width = max(min_width, min(width, max_width))

            new_min = center - width / 2.0
            new_max = center + width / 2.0

            # 範圍不要超出實際資料。
            if new_min < full_min:
                new_min = full_min
                new_max = full_min + width
            if new_max > full_max:
                new_max = full_max
                new_min = full_max - width
            new_min = max(full_min, new_min)
            new_max = min(full_max, new_max)

            self.trend_zoom_manual = True
            self._trend_current_xlim = (new_min, new_max)
            self._draw_trend_plot()
        except Exception as e:
            self.write_error_log(f"trend button zoom error: {e}")

    def zoom_in_trend_view(self):
        """趨勢圖放大：顯示較短時間/樣本範圍。"""
        self._zoom_trend_view(0.6)

    def zoom_out_trend_view(self):
        """趨勢圖縮小：顯示較長時間/樣本範圍。"""
        self._zoom_trend_view(1.6)

    def on_trend_mouse_wheel_zoom(self, event):
        """V3.8R：滑鼠滾輪縮放已停用。

        中文說明：
        - 因現場使用滑鼠滾輪時，趨勢圖可能左右移動不穩。
        - 本函式保留是為了相容舊版呼叫，但不再執行任何縮放動作。
        - 若要恢復完整範圍，請按「↔ 自動範圍」。
        """
        return

    def on_trend_mouse_press(self, event):
        """趨勢圖滑鼠操作。

        V3.8AE 中文說明：
        1. 左鍵按住後拖曳到另一個 X 軸位置，放開後框選放大。
        2. 右鍵點一下，依目前畫面中心縮小。
        3. 左鍵雙擊，恢復全部資料範圍。
        4. 不使用滑鼠滾輪，避免圖表左右跳動不穩。
        """
        try:
            if self.trend_ax is None or event.inaxes != self.trend_ax:
                return

            # 左鍵雙擊：恢復全部資料範圍
            if getattr(event, "dblclick", False) and getattr(event, "button", None) == 1:
                self.auto_fit_trend_view()
                return

            # 右鍵：縮小
            if getattr(event, "button", None) == 3:
                self._zoom_trend_view(1.6)
                return

            # 左鍵：記錄框選起點，放開時依起點/終點放大
            if getattr(event, "button", None) == 1 and event.xdata is not None:
                self._trend_drag_start = float(event.xdata)
                return

        except Exception as e:
            self.write_error_log(f"trend mouse press error: {e}")

    def on_trend_mouse_drag(self, event):
        """V3.8AE：保留相容，不做即時拖曳，避免圖表晃動。"""
        return

    def on_trend_mouse_release(self, event):
        """左鍵框選放大。

        中文說明：
        - 使用 X 軸樣本序號放大，不改變任何歷史資料。
        - 若拖曳距離太小，視為一般點擊，不縮放。
        """
        try:
            if self.trend_ax is None or event.inaxes != self.trend_ax:
                self._trend_drag_start = None
                return

            if getattr(event, "button", None) != 1:
                self._trend_drag_start = None
                return

            if self._trend_drag_start is None or event.xdata is None:
                return

            x1 = float(self._trend_drag_start)
            x2 = float(event.xdata)
            self._trend_drag_start = None

            if abs(x2 - x1) < 2.0:
                return

            full_range = self._get_trend_total_x_range()
            if full_range is None:
                return
            full_min, full_max = full_range

            new_min = max(full_min, min(x1, x2))
            new_max = min(full_max, max(x1, x2))

            if new_max - new_min < 2.0:
                return

            self.trend_zoom_manual = True
            self._trend_current_xlim = (new_min, new_max)
            self._draw_trend_plot()

        except Exception as e:
            self.write_error_log(f"trend mouse release error: {e}")
        finally:
            self._trend_drag_start = None

    def update_trend_plot(self):
        """相容舊呼叫：只在視窗存在時更新。"""
        if self.trend_window is not None:
            self._draw_trend_plot()

    def _draw_trend_plot(self):
        """重畫趨勢視窗內的圖，不使用 plt.show()。"""
        if not MATPLOTLIB_OK or self.trend_ax is None or self.trend_canvas is None:
            return

        selected_uids = self.get_selected_trend_channels()
        with self._trend_lock:
            snapshot = {
                uid: list(self.trend_data.get(uid, []))
                for uid in selected_uids
            }

        # V3.8Q：若使用者已用滑鼠縮放/拖曳，重畫時保留目前 X 軸範圍。
        # 若未手動縮放，則讓 Matplotlib 自動顯示全部資料。
        keep_xlim = None
        try:
            if self.trend_zoom_manual:
                keep_xlim = self._trend_current_xlim or self.trend_ax.get_xlim()
        except Exception:
            keep_xlim = None

        self.trend_ax.clear()
        self.trend_ax.set_facecolor("#020617")
        self.trend_ax.tick_params(colors="#cbd5e1")
        self.trend_ax.set_title("EC62 / E62 PV Real-Time Trend", color="#e5e7eb")
        self.trend_ax.set_xlabel("Sample", color="#cbd5e1")
        self.trend_ax.set_ylabel("Temperature (°C)", color="#cbd5e1")
        self.trend_ax.grid(True)

        plotted = 0
        total_points = 0
        last_text = "--"
        for uid, rows in snapshot.items():
            if len(rows) < 1:
                continue

            y = [v for _t, v in rows]
            x = list(range(1, len(y) + 1))
            label = self.unit_names.get(uid, f"CH{uid:02d}")

            # V3.7D：加 marker。只有 1 筆資料時也會看到一個點；
            # 有 2 筆以上時會形成線圖，避免使用者誤判「沒有記錄線」。
            self.trend_ax.plot(x, y, marker="o", linewidth=1.6, markersize=4, label=label)

            # 在最後一點標上目前值，現場看圖更明顯。
            try:
                self.trend_ax.text(x[-1], y[-1], f" {y[-1]:.1f}", color="#cbd5e1", fontsize=8)
            except Exception:
                pass

            # V3.8P：標示每一條線的 MAX / MIN 位置。
            # 注意：若使用者按過「MAX/MIN歸零」，只從歸零後的新資料找 MAX / MIN。
            # 舊資料仍然保留在趨勢線上，不會被刪除。
            try:
                start_idx = self._get_minmax_reset_index(uid, len(rows))
                y_stat = y[start_idx:] if start_idx < len(y) else y[-1:]
                x_stat = x[start_idx:] if start_idx < len(x) else x[-1:]
                max_val = max(y_stat)
                min_val = min(y_stat)
                max_local_idx = y_stat.index(max_val)
                min_local_idx = y_stat.index(min_val)
                self.trend_ax.scatter([x_stat[max_local_idx]], [max_val], marker="^", s=45)
                self.trend_ax.scatter([x_stat[min_local_idx]], [min_val], marker="v", s=45)
                self.trend_ax.text(x_stat[max_local_idx], max_val, f" MAX {max_val:.1f}", color="#facc15", fontsize=8)
                self.trend_ax.text(x_stat[min_local_idx], min_val, f" MIN {min_val:.1f}", color="#38bdf8", fontsize=8)
            except Exception:
                pass

            plotted += 1
            total_points += len(rows)
            last_text = rows[-1][0]

        stats_text = self._format_trend_stats(snapshot)
        self.trend_stats_text_var.set(stats_text)

        if plotted:
            self.trend_ax.legend(loc="upper left", fontsize=8)
            self.trend_info_var.set(
                f"Button Zoom | CH: {plotted} | Points: {total_points} | Last: {last_text}"
            )
        else:
            self.trend_ax.text(
                0.5,
                0.5,
                "等待 PV 資料中\n需讀到 PV 成功值後才會出現趨勢點與線",
                transform=self.trend_ax.transAxes,
                ha="center",
                va="center",
                color="#94a3b8",
                fontsize=14,
            )
            self.trend_info_var.set("Button Zoom | Waiting")

        # V3.8Q：套用使用者滑鼠縮放後的 X 軸範圍。
        try:
            if plotted and keep_xlim is not None:
                self.trend_ax.set_xlim(*keep_xlim)
                self._trend_current_xlim = keep_xlim
        except Exception:
            pass

        self.trend_fig.tight_layout()
        self.trend_canvas.draw_idle()

    def _get_minmax_reset_index(self, uid, row_count):
        """取得指定 CH 的 MAX/MIN 統計起點。

        中文說明：
        - row_count 是目前該 CH 的趨勢資料筆數。
        - 若使用者從未按過「MAX/MIN歸零」，起點就是 0，代表從第一筆資料計算。
        - 若使用者按過「MAX/MIN歸零」，起點會變成當時最後一筆資料的位置。
        - 這個函式只影響 MAX / MIN / RANGE 的統計範圍，不會刪除任何資料。
        """
        try:
            idx = int(self.trend_minmax_reset_index.get(uid, 0))
        except Exception:
            idx = 0

        if row_count <= 0:
            return 0
        if idx < 0:
            return 0
        if idx >= row_count:
            return row_count - 1
        return idx

    def _calc_trend_stats(self, rows, uid=None):
        """回傳單一通道的 NOW / MAX / MIN / AVG / RANGE / COUNT。

        V3.8P 中文註解：
        1. rows 是完整趨勢資料，仍保留全部歷史點。
        2. COUNT、AVG、NOW 使用完整 rows 計算，方便保留整段測試統計。
        3. MAX、MIN、RANGE 會依照「MAX/MIN歸零」後的起點重新計算。
        4. 按下 MAX/MIN 歸零時，不會清除趨勢圖、不會清除 CSV、不會清除 PDF。
        """
        vals = []
        for _t, v in rows:
            try:
                vals.append(float(v))
            except Exception:
                pass
        if not vals:
            return None

        # 完整資料統計：NOW / AVG / COUNT 保留整段資料，不受 MAX/MIN 歸零影響。
        last_val = vals[-1]
        avg = sum(vals) / len(vals)
        count = len(vals)

        # MAX/MIN 統計：若 uid 有歸零起點，只從該起點之後重新計算。
        if uid is None:
            stat_vals = vals
        else:
            start_idx = self._get_minmax_reset_index(uid, len(vals))
            stat_vals = vals[start_idx:] if start_idx < len(vals) else vals[-1:]
            if not stat_vals:
                stat_vals = vals[-1:]

        mx = max(stat_vals)
        mn = min(stat_vals)
        return {
            "max": mx,
            "min": mn,
            "avg": avg,
            "range": mx - mn,
            "count": count,
            "last": last_val,
        }

    def _format_trend_stats(self, snapshot=None):
        """趨勢視窗下方統計文字。"""
        if snapshot is None:
            selected_uids = self.get_selected_trend_channels()
            with self._trend_lock:
                snapshot = {uid: list(self.trend_data.get(uid, [])) for uid in selected_uids}

        lines = []
        for uid in list(snapshot.keys()):
            rows = snapshot.get(uid, [])
            st = self._calc_trend_stats(rows, uid)
            if not st:
                continue
            name = self.unit_names.get(uid, f"CH{uid:02d}")
            lines.append(
                f"{name:<8} NOW={st['last']:>6.2f}°C  "
                f"MAX={st['max']:>6.2f}°C  MIN={st['min']:>6.2f}°C  "
                f"AVG={st['avg']:>6.2f}°C  RANGE={st['range']:>5.2f}°C  COUNT={st['count']}"
            )
        if not lines:
            return "等待 PV 資料中"
        return "\n".join(lines[:8])

    def normalize_report_folder(self, path_text=None):
        """V3.8F：修正報表路徑。

        修正重點：
        1) 移除路徑中單獨的空白資料夾，例如 OneDrive/ /EC62。
        2) 統一 / 與 \，避免報表顯示 C:/.../EC62\\2026_06_21。
        3) 支援 Windows C:/、Linux /home/pi、相對路徑。
        """
        raw = str(path_text or self.report_folder_var.get() or self.trend_report_folder or "").strip().strip('"')
        if not raw:
            raw = self.trend_report_folder or ("C:/SGS/EC62" if platform.system().lower() == "windows" else os.path.expanduser("~/SGS/EC62"))

        raw = os.path.expanduser(raw).replace("\\", "/")
        is_abs_unix = raw.startswith("/")
        parts = [p.strip() for p in raw.split("/") if p.strip()]

        if not parts:
            return os.path.normpath("C:/SGS/EC62" if platform.system().lower() == "windows" else os.path.expanduser("~/SGS/EC62"))

        # Windows drive path，例如 C:/Users/kuo58/OneDrive/EC62
        if len(parts[0]) == 2 and parts[0][1] == ":":
            drive = parts[0]
            rest = parts[1:]
            fixed = drive + "/" + "/".join(rest) if rest else drive + "/"
        else:
            fixed = "/".join(parts)
            if is_abs_unix:
                fixed = "/" + fixed

        return os.path.normpath(fixed)

    def _trend_history_dir(self):
        """V3.8L：每日趨勢原始資料自動存檔資料夾。"""
        try:
            base = self.normalize_report_folder(self.report_folder_var.get() or self.trend_report_folder)
        except Exception:
            base = self.trend_report_folder or user_path("SGS/EC62")
        folder = os.path.normpath(os.path.join(base, "Trend_History"))
        os.makedirs(folder, exist_ok=True)
        return folder

    def _trend_history_file(self):
        """V3.8L：今日趨勢資料 JSONL 檔案。"""
        fname = datetime.now().strftime("%Y_%m_%d_Trend_History.jsonl")
        return os.path.join(self._trend_history_dir(), fname)

    def append_trend_history_record(self, uid, value, time_text=None):
        """V3.8L：每讀到一筆 PV 就立即追加寫入 JSONL，斷線後仍可延續。"""
        try:
            if time_text is None:
                time_text = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            rec = {
                "uid": int(uid),
                "ch": f"CH{int(uid):02d}",
                "time": str(time_text),
                "value": float(value),
            }
            path = self._trend_history_file()
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception as e:
            self.write_error_log(f"append trend history error: {e}")

    def load_trend_history_today(self):
        """V3.8L：開機載入今日已存趨勢資料，讓線圖延續不中斷。"""
        try:
            path = self._trend_history_file()
            if not os.path.exists(path):
                return
            try:
                max_points = max(10, int(self.trend_max_points_var.get() or 300))
            except Exception:
                max_points = 300

            loaded = 0
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                        uid = int(rec.get("uid"))
                        val = float(rec.get("value"))
                        t = str(rec.get("time") or "")
                        if uid < 1 or uid > self.max_unit_id:
                            continue
                        arr = self.trend_data.setdefault(uid, [])
                        arr.append((t, val))
                        if len(arr) > max_points:
                            del arr[:-max_points]
                        loaded += 1
                    except Exception:
                        continue
            if loaded:
                self.set_status(f"📈 已載入今日趨勢歷史 {loaded} 筆，斷線可延續", "green")
        except Exception as e:
            self.write_error_log(f"load trend history error: {e}")

    def _trend_report_dir(self):
        """報表資料夾。

        V3.8S 中文說明：
        - 存檔與列印資料夾改依「取樣開始日期」建立。
        - 例如取樣日期為 2026-06-21，資料會放入：C:\\SGS\\EC62\\2026_06_21。
        - 不再用電腦今天日期，避免補印或補存過去取樣資料時放錯資料夾。
        """
        base = self.normalize_report_folder()
        self.report_folder_var.set(base)
        self.trend_report_folder = base

        try:
            sample_date = self._report_text(self.sample_start_date_var, datetime.now().strftime("%Y-%m-%d"))
            folder_date = datetime.strptime(sample_date, "%Y-%m-%d").strftime("%Y_%m_%d")
        except Exception:
            folder_date = datetime.now().strftime("%Y_%m_%d")

        folder = os.path.normpath(os.path.join(base, folder_date))
        os.makedirs(folder, exist_ok=True)
        return folder

    def choose_report_folder(self):
        """選擇報表存放位置，並立即保存到設定檔。"""
        try:
            init_dir = os.path.expanduser(self.report_folder_var.get() or self.trend_report_folder)
            os.makedirs(init_dir, exist_ok=True)
        except Exception:
            init_dir = os.path.expanduser("~")

        folder = filedialog.askdirectory(title="選擇趨勢報表 / PDF 存放位置", initialdir=init_dir)
        if not folder:
            return

        folder = self.normalize_report_folder(folder)
        self.report_folder_var.set(folder)
        self.trend_report_folder = folder
        # V3.8L：切換資料夾後嘗試載入該資料夾今日趨勢歷史。
        self.load_trend_history_today()
        self.set_status(f"📂 報表路徑已設定：{folder}", "green")
        try:
            # 若已解鎖，直接完整儲存；未解鎖時只更新 config 內 report 欄位。
            if self.is_unlocked:
                self.save_config()
            else:
                cfg = {}
                if os.path.exists(self.config_path):
                    with open(self.config_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f) or {}
                cfg.setdefault("report", {})
                cfg["report"].update({
                    "title": self._report_text(self.report_title_var, "SGS Temperature Validation Report"),
                    "company_name": self._report_text(self.company_name_var, "CM LAB"),
                    "customer_name": self._report_text(self.customer_name_var, "ADVANTECH"),
                    "calibration_no": self._report_text(self.calibration_no_var, "CM-2026-001"),
                    "start_date": self._report_metadata()["start_date"].replace("/", "-"),
                    "start_time": self._report_metadata()["start_time"],
                    "end_date": self._report_metadata()["end_date"].replace("/", "-"),
                    "end_time": self._report_metadata()["end_time"],
                    "folder": folder,
                    "format": self.report_format_var.get(),
                })
                with open(self.config_path, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
        except Exception as e:
            self.write_error_log(f"save report folder config error: {e}")

    def _normalize_date_text(self, value, fallback=None):
        """V3.8AB：日期文字正規化為 YYYY/MM/DD。

        支援：
        - 2026-06-21
        - 2026/6/21
        - 2026/06/21
        - Excel 文字格式 ="2026/06/21"
        """
        raw = str(value or "").strip()
        if raw.startswith('="') and raw.endswith('"'):
            raw = raw[2:-1]
        if raw.startswith("'"):
            raw = raw[1:]
        raw = raw.strip().replace("-", "/")
        if not raw:
            raw = fallback or datetime.now().strftime("%Y/%m/%d")
        for fmt in ("%Y/%m/%d", "%Y/%m/%d %H:%M", "%Y/%m/%d %H:%M:%S"):
            try:
                return datetime.strptime(raw, fmt).strftime("%Y/%m/%d")
            except Exception:
                pass
        try:
            parts = raw.split("/")[:3]
            y, m, d = [int(x) for x in parts]
            return f"{y:04d}/{m:02d}/{d:02d}"
        except Exception:
            return fallback or datetime.now().strftime("%Y/%m/%d")

    def _normalize_time_text(self, value, fallback="00:00:00"):
        """V3.8AB：時間文字正規化為 HH:MM:SS。

        中文說明：
        1. 支援 20:00、20:00:00、8:30、0830。
        2. 修正錯誤輸入 200:00 / 200:00:00 → 20:00:00。
        3. 修正錯誤輸入 200 / 2000 → 20:00:00。
        4. 不回傳原始錯誤字串，避免報表出現 200:00 或篩選失效。
        """
        raw = str(value or "").strip()
        if raw.startswith('="') and raw.endswith('"'):
            raw = raw[2:-1]
        if raw.startswith("'"):
            raw = raw[1:]
        raw = raw.strip()
        if not raw:
            raw = str(fallback or "00:00:00")

        try:
            parts = raw.split(":")

            # 只有數字：20 / 200 / 0830 / 2000
            if len(parts) == 1:
                digits = "".join(ch for ch in raw if ch.isdigit())
                if len(digits) in (3, 4):
                    h = int(digits[:-2])
                    m = int(digits[-2:])
                    if 0 <= h <= 23 and 0 <= m <= 59:
                        return f"{h:02d}:{m:02d}:00"
                if digits:
                    h = int(digits)
                    if h > 23 and len(digits) == 3 and digits.endswith("0"):
                        h = int(digits[:2])
                    if 0 <= h <= 23:
                        return f"{h:02d}:00:00"

            # HH:MM 或 HH:MM:SS
            if len(parts) in (2, 3):
                h_text = parts[0].strip()
                m_text = parts[1].strip() if len(parts) >= 2 else "0"
                s_text = parts[2].strip() if len(parts) == 3 else "0"

                # 修正 200:00 或 200:00:00 → 20:00:00
                if h_text.isdigit() and int(h_text) > 23 and len(h_text) == 3 and h_text.endswith("0"):
                    h_text = h_text[:2]

                h = int(h_text)
                m = int(m_text)
                s = int(s_text)
                if 0 <= h <= 23 and 0 <= m <= 59 and 0 <= s <= 59:
                    return f"{h:02d}:{m:02d}:{s:02d}"
        except Exception:
            pass

        # fallback 也正規化，仍失敗才回 00:00:00
        try:
            fb = str(fallback or "00:00:00").strip()
            if len(fb.split(":")) == 2:
                fb += ":00"
            return datetime.strptime(fb, "%H:%M:%S").strftime("%H:%M:%S")
        except Exception:
            return "00:00:00"

    def _format_sampling_datetime_text(self, date_text, time_text, with_seconds=False):
        """V3.8AB：報表/CSV 顯示用取樣日期時間。

        with_seconds=False → YYYY/MM/DD HH:MM
        with_seconds=True  → YYYY/MM/DD HH:MM:SS
        """
        d = self._normalize_date_text(date_text)
        t = self._normalize_time_text(time_text)
        try:
            dt = datetime.strptime(f"{d} {t}", "%Y/%m/%d %H:%M:%S")
            return dt.strftime("%Y/%m/%d %H:%M:%S" if with_seconds else "%Y/%m/%d %H:%M")
        except Exception:
            return f"{d} {t}"

    def _csv_text(self, value):
        """V3.8AB：CSV 文字欄位防 Excel 自動轉日期序號。

        Excel 開啟 CSV 時，日期時間可能會變成 46202.33333。
        使用 ="文字" 可強制 Excel 顯示原始文字。
        """
        text = str(value or "").replace('"', '""')
        return f'="{text}"'

    def _get_sampling_datetime_range(self):
        """V3.8AB：取得取樣開始/結束日期時間，並強制正規化。

        重要：
        - End Time 若輸入 200:00，會修正為 20:00:00。
        - 若格式錯誤，回傳 None，並寫入錯誤紀錄。
        - 存檔/列印只輸出 start_dt <= time <= end_dt 的資料。
        """
        try:
            meta = self._report_metadata()
            start_date = self._normalize_date_text(meta["start_date"])
            end_date = self._normalize_date_text(meta["end_date"])
            start_time = self._normalize_time_text(meta["start_time"], "08:00:00")
            end_time = self._normalize_time_text(meta["end_time"], "17:00:00")

            # 同步回 GUI，避免下一次報表仍顯示舊的 200:00。
            try:
                self.sample_start_date_var.set(start_date.replace("/", "-"))
                self.sample_end_date_var.set(end_date.replace("/", "-"))
                self.sample_start_time_var.set(start_time)
                self.sample_end_time_var.set(end_time)
            except Exception:
                pass

            start_dt = datetime.strptime(f"{start_date} {start_time}", "%Y/%m/%d %H:%M:%S")
            end_dt = datetime.strptime(f"{end_date} {end_time}", "%Y/%m/%d %H:%M:%S")
            if end_dt < start_dt:
                start_dt, end_dt = end_dt, start_dt
            return start_dt, end_dt
        except Exception as e:
            self.write_error_log(f"sampling datetime parse error: {e}")
            return None, None

    def _parse_trend_time_for_filter(self, time_text):
        """V3.8AB：將趨勢資料時間文字轉成 datetime，供取樣時間篩選使用。

        支援：
        1) 2026-06-21 08:00:00
        2) 2026/6/21 08:00
        3) 08:00:00 或 08:00，會自動搭配取樣開始日期。
        4) Excel CSV 文字格式：="2026/06/21 08:00"
        """
        t = str(time_text or "").strip()
        if not t:
            return None
        if t.startswith('="') and t.endswith('"'):
            t = t[2:-1]
        if t.startswith("'"):
            t = t[1:]
        t = t.strip().replace("-", "/")

        for fmt in ("%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
            try:
                return datetime.strptime(t, fmt)
            except Exception:
                pass

        try:
            meta = self._report_metadata()
            base_date = self._normalize_date_text(meta.get("start_date") or datetime.now().strftime("%Y/%m/%d"))
            time_part = self._normalize_time_text(t)
            return datetime.strptime(f"{base_date} {time_part}", "%Y/%m/%d %H:%M:%S")
        except Exception:
            return None

    def _filter_rows_by_sampling_time(self, rows):
        """V3.8T：依取樣開始/結束日期時間篩選單一 CH 的趨勢資料。

        重點：
        - 只影響「存檔」與「列印」輸出內容。
        - 不刪除畫面趨勢資料。
        - 不刪除 Trend_History 歷史資料。
        """
        start_dt, end_dt = self._get_sampling_datetime_range()
        if start_dt is None or end_dt is None:
            return list(rows)

        filtered = []
        for t, v in rows:
            dt = self._parse_trend_time_for_filter(t)
            if dt is None:
                # 無法解析時間的資料不輸出，避免混入取樣區間外資料。
                continue
            if start_dt <= dt <= end_dt:
                filtered.append((t, v))
        return filtered

    def _trend_snapshot(self, apply_sampling_filter=True):
        """取得趨勢資料快照，避免寫檔時被背景執行緒改動。

        V3.8T：
        - 存檔 / 列印預設會依取樣日期時間篩選資料。
        - 即時畫面與歷史檔不受影響。
        """
        selected_uids = self.get_selected_trend_channels()
        with self._trend_lock:
            snapshot = {uid: list(self.trend_data.get(uid, [])) for uid in selected_uids}

        if apply_sampling_filter:
            snapshot = {uid: self._filter_rows_by_sampling_time(rows) for uid, rows in snapshot.items()}
        return snapshot

    def _ask_report_options(self, title="報表輸出選擇", for_print=False):
        """V3.8AC：存檔 / 列印前確認格式、路徑、取樣日期與時間。

        中文說明：
        1. 存檔與列印都會先跳出確認視窗。
        2. 可在同一視窗確認 / 修改：報表格式、報表路徑、取樣開始日期、開始時間、結束日期、結束時間。
        3. 按「確定」後會將日期與時間寫回主程式變數，再依此區間篩選資料。
        4. 時間會經 _normalize_time_text() 修正，避免 200:00 這類錯誤字串進入 PDF / CSV。
        5. 日期會經 _normalize_date_text() 修正，統一輸出 YYYY/MM/DD，資料夾仍使用 YYYY_MM_DD。
        """
        result = {"ok": False}
        win = tk.Toplevel(self.root)
        win.title(title)
        win.geometry("640x420")
        win.configure(bg="#111827")
        win.resizable(False, False)
        win.transient(self.root)
        win.grab_set()

        # 目前報表資料先正規化後帶入視窗，避免舊設定中的 200:00 再顯示出來。
        meta = self._report_metadata()
        fmt_values = ["PDF", "PNG", "CSV"] if for_print else ["全部", "CSV", "PNG", "PDF"]
        fmt_var = tk.StringVar(value=("PDF" if for_print else (self.report_format_var.get() or "全部")))
        folder_var = tk.StringVar(value=self.normalize_report_folder(self.report_folder_var.get() or self.trend_report_folder))
        start_date_var = tk.StringVar(value=meta["start_date"].replace("/", "-"))
        start_time_var = tk.StringVar(value=meta["start_time"])
        end_date_var = tk.StringVar(value=meta["end_date"].replace("/", "-"))
        end_time_var = tk.StringVar(value=meta["end_time"])

        tk.Label(
            win,
            text=title,
            bg="#111827",
            fg="#38bdf8",
            font=("Arial", 16, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 6))

        tk.Label(
            win,
            text="請確認格式、路徑、取樣日期與時間；輸出內容會依此區間篩選。",
            bg="#111827",
            fg="#facc15",
            font=("Arial", 10, "bold"),
        ).pack(anchor="w", padx=16, pady=(0, 8))

        body = tk.Frame(win, bg="#111827")
        body.pack(fill="both", expand=True, padx=16, pady=4)
        body.columnconfigure(1, weight=1)

        def add_label(row, text):
            tk.Label(
                body,
                text=text,
                bg="#111827",
                fg="#facc15",
                font=("Arial", 11, "bold"),
                width=10,
                anchor="w",
            ).grid(row=row, column=0, sticky="w", padx=4, pady=6)

        add_label(0, "格式")
        ttk.Combobox(
            body,
            textvariable=fmt_var,
            values=fmt_values,
            state="readonly",
            width=12,
        ).grid(row=0, column=1, sticky="w", padx=4, pady=6)

        add_label(1, "路徑")
        tk.Entry(
            body,
            textvariable=folder_var,
            bg="#1f2937",
            fg="white",
            insertbackground="white",
            width=46,
        ).grid(row=1, column=1, sticky="we", padx=4, pady=6)

        def browse():
            try:
                init = os.path.expanduser(folder_var.get() or self.trend_report_folder)
                os.makedirs(init, exist_ok=True)
            except Exception:
                init = os.path.expanduser("~")
            folder = filedialog.askdirectory(title="選擇報表存放位置", initialdir=init)
            if folder:
                folder_var.set(self.normalize_report_folder(folder))

        tk.Button(
            body,
            text="選擇",
            command=browse,
            bg="#64748b",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
            width=8,
        ).grid(row=1, column=2, sticky="we", padx=4, pady=6)

        add_label(2, "開始日期")
        tk.Entry(
            body,
            textvariable=start_date_var,
            bg="#1f2937",
            fg="white",
            insertbackground="white",
            width=18,
        ).grid(row=2, column=1, sticky="w", padx=4, pady=6)
        tk.Button(
            body,
            text="📅",
            command=lambda: self._choose_date_calendar(start_date_var, "選擇開始日期"),
            bg="#0f766e",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
            width=8,
        ).grid(row=2, column=2, sticky="we", padx=4, pady=6)

        add_label(3, "開始時間")
        tk.Entry(
            body,
            textvariable=start_time_var,
            bg="#1f2937",
            fg="white",
            insertbackground="white",
            width=18,
        ).grid(row=3, column=1, sticky="w", padx=4, pady=6)
        tk.Label(
            body,
            text="例：18:00 或 18:00:00",
            bg="#111827",
            fg="#94a3b8",
            font=("Arial", 9, "bold"),
        ).grid(row=3, column=2, sticky="w", padx=4, pady=6)

        add_label(4, "結束日期")
        tk.Entry(
            body,
            textvariable=end_date_var,
            bg="#1f2937",
            fg="white",
            insertbackground="white",
            width=18,
        ).grid(row=4, column=1, sticky="w", padx=4, pady=6)
        tk.Button(
            body,
            text="📅",
            command=lambda: self._choose_date_calendar(end_date_var, "選擇結束日期"),
            bg="#0f766e",
            fg="white",
            relief="flat",
            font=("Arial", 10, "bold"),
            width=8,
        ).grid(row=4, column=2, sticky="we", padx=4, pady=6)

        add_label(5, "結束時間")
        tk.Entry(
            body,
            textvariable=end_time_var,
            bg="#1f2937",
            fg="white",
            insertbackground="white",
            width=18,
        ).grid(row=5, column=1, sticky="w", padx=4, pady=6)
        tk.Label(
            body,
            text="例：20:00；若輸入 200:00 會自動修正為 20:00:00",
            bg="#111827",
            fg="#94a3b8",
            font=("Arial", 9, "bold"),
        ).grid(row=5, column=2, sticky="w", padx=4, pady=6)

        preview_var = tk.StringVar(value="")
        preview = tk.Label(
            win,
            textvariable=preview_var,
            bg="#111827",
            fg="#22c55e",
            font=("Consolas", 10, "bold"),
            justify="left",
            anchor="w",
        )
        preview.pack(fill="x", padx=16, pady=(2, 6))

        def refresh_preview():
            sd = self._normalize_date_text(start_date_var.get()).replace("/", "-")
            ed = self._normalize_date_text(end_date_var.get()).replace("/", "-")
            st = self._normalize_time_text(start_time_var.get(), "08:00:00")
            et = self._normalize_time_text(end_time_var.get(), "17:00:00")
            try:
                folder_preview = os.path.join(self.normalize_report_folder(folder_var.get()), sd.replace("-", "_"))
            except Exception:
                folder_preview = folder_var.get()
            preview_var.set(
                f"Sampling Start : {sd} {st}\n"
                f"Sampling End   : {ed} {et}\n"
                f"Output Folder   : {os.path.normpath(folder_preview)}"
            )

        def on_field_change(*_args):
            try:
                refresh_preview()
            except Exception:
                pass

        for v in (start_date_var, start_time_var, end_date_var, end_time_var, folder_var):
            try:
                v.trace_add("write", on_field_change)
            except Exception:
                pass
        refresh_preview()

        btn = tk.Frame(win, bg="#111827")
        btn.pack(fill="x", padx=16, pady=(4, 12))

        def ok():
            folder = (folder_var.get() or "").strip()
            if not folder:
                messagebox.showwarning("提醒", "請先選擇報表存放位置")
                return

            folder = self.normalize_report_folder(folder)
            start_date = self._normalize_date_text(start_date_var.get()).replace("/", "-")
            end_date = self._normalize_date_text(end_date_var.get()).replace("/", "-")
            start_time = self._normalize_time_text(start_time_var.get(), "08:00:00")
            end_time = self._normalize_time_text(end_time_var.get(), "17:00:00")

            # 驗證開始 / 結束時間可解析；若結束早於開始，提示使用者確認。
            try:
                sdt = datetime.strptime(f"{start_date} {start_time}", "%Y-%m-%d %H:%M:%S")
                edt = datetime.strptime(f"{end_date} {end_time}", "%Y-%m-%d %H:%M:%S")
                if edt < sdt:
                    if not messagebox.askyesno("確認", "結束時間早於開始時間，是否仍要繼續？"):
                        return
            except Exception as e:
                messagebox.showerror("錯誤", f"取樣日期或時間格式錯誤：{e}")
                return

            # 寫回主畫面變數，後續 _trend_report_dir()、_trend_snapshot()、PDF/CSV 都使用同一組資料。
            self.sample_start_date_var.set(start_date)
            self.sample_start_time_var.set(start_time)
            self.sample_end_date_var.set(end_date)
            self.sample_end_time_var.set(end_time)
            self.report_folder_var.set(folder)
            self.trend_report_folder = folder

            if not for_print:
                self.report_format_var.set(fmt_var.get())

            result.update({
                "ok": True,
                "format": fmt_var.get(),
                "folder": folder,
                "start_date": start_date,
                "start_time": start_time,
                "end_date": end_date,
                "end_time": end_time,
            })
            win.destroy()

        tk.Button(
            btn,
            text="確定" if for_print else "確定存檔",
            command=ok,
            bg="#16a34a",
            fg="white",
            relief="flat",
            font=("Arial", 11, "bold"),
            width=12,
        ).pack(side="right", padx=4)

        tk.Button(
            btn,
            text="取消",
            command=win.destroy,
            bg="#475569",
            fg="white",
            relief="flat",
            font=("Arial", 11, "bold"),
            width=12,
        ).pack(side="right", padx=4)

        win.bind("<Return>", lambda _e: ok())
        win.bind("<Escape>", lambda _e: win.destroy())
        self.root.wait_window(win)
        return result if result.get("ok") else None

    def _save_trend_csv_files(self, snapshot, folder, now_tag):
        """每個 CH 各存一個 CSV，底部附統計值。"""
        paths = []
        for uid, rows in snapshot.items():
            if not rows:
                continue
            name = self.unit_names.get(uid, f"CH{uid:02d}")
            safe_name = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in name)
            csv_path = os.path.join(folder, f"{safe_name}_Trend_{now_tag}.csv")
            st = self._calc_trend_stats(rows, uid)
            with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
                writer = csv.writer(f)
                # V3.8T：CSV 原始資料也標示取樣區間，內容已依此區間篩選。
                meta = self._report_metadata()
                sampling_start_text = self._format_sampling_datetime_text(meta['start_date'], meta['start_time'])
                sampling_end_text = self._format_sampling_datetime_text(meta['end_date'], meta['end_time'])
                writer.writerow(["Sampling Start", self._csv_text(sampling_start_text)])
                writer.writerow(["Sampling End", self._csv_text(sampling_end_text)])
                writer.writerow([])
                writer.writerow(["Time", "PV(°C)"])
                for t, v in rows:
                    dt = self._parse_trend_time_for_filter(t)
                    time_out = dt.strftime("%Y/%m/%d %H:%M") if dt is not None else str(t)
                    writer.writerow([self._csv_text(time_out), f"{float(v):.3f}"])
                writer.writerow([])
                if st:
                    writer.writerow(["MAX", f"{st['max']:.3f}"])
                    writer.writerow(["MIN", f"{st['min']:.3f}"])
                    writer.writerow(["AVG", f"{st['avg']:.3f}"])
                    writer.writerow(["RANGE", f"{st['range']:.3f}"])
                    writer.writerow(["COUNT", st["count"]])
            paths.append(csv_path)
        return paths

    def _report_text(self, var, fallback):
        """讀取報表欄位；空白時使用預設值。"""
        try:
            value = (var.get() or "").strip()
        except Exception:
            value = ""
        return value or fallback

    def _report_metadata(self):
        """V3.8AB：PDF / CSV / 設定檔共用報表資料，日期與時間一律正規化。

        修正重點：
        - PDF 不再顯示 End Time : 200:00。
        - CSV 不再顯示 Sampling End 2026/06/21 200:00:00。
        - Start / End 會保持不同列，不會黏在同一行。
        """
        start_date = self._normalize_date_text(
            self._report_text(self.sample_start_date_var, datetime.now().strftime("%Y-%m-%d"))
        )
        end_date = self._normalize_date_text(
            self._report_text(self.sample_end_date_var, datetime.now().strftime("%Y-%m-%d"))
        )
        start_time = self._normalize_time_text(
            self._report_text(self.sample_start_time_var, "08:00:00"),
            "08:00:00",
        )
        end_time = self._normalize_time_text(
            self._report_text(self.sample_end_time_var, "17:00:00"),
            "17:00:00",
        )
        return {
            "title": self._report_text(self.report_title_var, "SGS Temperature Validation Report"),
            "company": self._report_text(self.company_name_var, "CM LAB"),
            "customer": self._report_text(self.customer_name_var, "ADVANTECH"),
            "calibration_no": self._report_text(self.calibration_no_var, "CM-2026-001"),
            "start_date": start_date,
            "start_time": start_time,
            "end_date": end_date,
            "end_time": end_time,
        }

    def _save_trend_summary_csv(self, snapshot, folder, now_tag):
        """V3.8M：產生與 PDF 第一頁相同內容的 CSV 摘要報表，可供列印/Excel 開啟。"""
        csv_path = os.path.join(folder, f"Trend_Report_{now_tag}_Summary.csv")
        try:
            meta = self._report_metadata()
            with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
                writer = csv.writer(f)
                writer.writerow([meta["title"]])
                writer.writerow([])
                writer.writerow(["Company Name", meta["company"]])
                writer.writerow(["Customer Name", meta["customer"]])
                writer.writerow(["Calibration No", meta["calibration_no"]])
                writer.writerow([])
                sampling_start_text = self._format_sampling_datetime_text(meta['start_date'], meta['start_time'])
                sampling_end_text = self._format_sampling_datetime_text(meta['end_date'], meta['end_time'])
                writer.writerow(["Sampling Start", self._csv_text(sampling_start_text)])
                writer.writerow(["Sampling End", self._csv_text(sampling_end_text)])
                writer.writerow([])
                writer.writerow(["Report Date", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
                writer.writerow(["Report Folder", os.path.normpath(folder)])
                writer.writerow(["CSV File", os.path.basename(csv_path)])
                writer.writerow([])
                writer.writerow(["Temperature Trend Report"])
                writer.writerow(["Channel Statistics"])
                writer.writerow([])
                writer.writerow(["Channel", "Sample Count", "NOW(°C)", "MAX(°C)", "MIN(°C)", "AVG(°C)", "RANGE(°C)"])

                has_stats = False
                for uid in list(self.unit_ids):
                    rows = snapshot.get(uid, [])
                    st = self._calc_trend_stats(rows, uid)
                    if not st:
                        continue
                    has_stats = True
                    name = self.unit_names.get(uid, f"CH{uid:02d}")
                    writer.writerow([
                        name,
                        st["count"],
                        f"{st['last']:.2f}",
                        f"{st['max']:.2f}",
                        f"{st['min']:.2f}",
                        f"{st['avg']:.2f}",
                        f"{st['range']:.2f}",
                    ])
                if not has_stats:
                    writer.writerow(["No PV data"])
            return csv_path
        except Exception as e:
            self.write_error_log(f"save trend summary csv error: {e}")
            messagebox.showerror("錯誤", f"❌ CSV 摘要報表產生失敗：{e}")
            return None

    def _save_trend_png(self, snapshot, folder, now_tag):
        """存目前趨勢圖 PNG。"""
        png_path = os.path.join(folder, f"Trend_Report_{now_tag}.png")
        try:
            if self.trend_fig is not None:
                self.trend_fig.savefig(png_path, dpi=150, bbox_inches="tight", facecolor=self.trend_fig.get_facecolor())
            else:
                fig = Figure(figsize=(11, 5.5), dpi=120)
                ax = fig.add_subplot(111)
                ax.set_title(self._report_metadata()["title"])
                ax.set_xlabel("Sample")
                ax.set_ylabel("Temperature (°C)")
                ax.grid(True)
                for uid, rows in snapshot.items():
                    if not rows:
                        continue
                    y = [float(v) for _t, v in rows]
                    x = list(range(1, len(y) + 1))
                    ax.plot(x, y, marker="o", linewidth=1.5, markersize=3, label=self.unit_names.get(uid, f"CH{uid:02d}"))
                ax.legend(loc="upper left", fontsize=8)
                fig.tight_layout()
                fig.savefig(png_path, dpi=150, bbox_inches="tight")
            return png_path
        except Exception as e:
            self.write_error_log(f"save trend png error: {e}")
            return None

    def _save_trend_pdf(self, snapshot, folder, now_tag, png_path=None):
        """產生 PDF 報表：統計頁 + 趨勢圖頁。"""
        pdf_path = os.path.join(folder, f"Trend_Report_{now_tag}.pdf")
        try:
            from matplotlib.backends.backend_pdf import PdfPages
            with PdfPages(pdf_path) as pdf:
                # Page 1：統計摘要
                fig1 = Figure(figsize=(8.27, 11.69), dpi=100)  # A4 portrait
                ax1 = fig1.add_subplot(111)
                ax1.axis("off")
                meta = self._report_metadata()
                lines = [
                    meta["title"],
                    "",
                    f"Company Name  : {meta['company']}",
                    f"Customer Name : {meta['customer']}",
                    f"Calibration No: {meta['calibration_no']}",
                    "",
                    f"Sampling Date : {meta['start_date']} ~ {meta['end_date']}",
                    f"Start Time    : {meta['start_time']}",
                    f"End Time      : {meta['end_time']}",
                    "",
                    f"Report Date   : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
                    f"Report Folder : {os.path.normpath(folder)}",
                    f"PDF File      : {os.path.basename(pdf_path)}",
                    "",
                    "Temperature Trend Report",
                    "Channel Statistics",
                    "------------------------------------------------------------",
                ]
                for uid in list(self.unit_ids):
                    rows = snapshot.get(uid, [])
                    st = self._calc_trend_stats(rows, uid)
                    if not st:
                        continue
                    name = self.unit_names.get(uid, f"CH{uid:02d}")
                    lines.append(f"{name}")
                    lines.append(f"  Sample Count : {st['count']}")
                    lines.append(f"  NOW          : {st['last']:>7.2f} °C")
                    lines.append(f"  MAX          : {st['max']:>7.2f} °C")
                    lines.append(f"  MIN          : {st['min']:>7.2f} °C")
                    lines.append(f"  AVG          : {st['avg']:>7.2f} °C")
                    lines.append(f"  RANGE        : {st['range']:>7.2f} °C")
                    lines.append("")
                if len(lines) <= 13:
                    lines.append("No PV data")
                ax1.text(0.06, 0.96, "\n".join(lines), va="top", ha="left", fontsize=10, family="monospace")
                pdf.savefig(fig1, bbox_inches="tight")

                # Page 2：趨勢圖
                fig2 = Figure(figsize=(11.69, 8.27), dpi=100)  # A4 landscape
                ax2 = fig2.add_subplot(111)
                ax2.set_title(self._report_metadata()["title"])
                ax2.set_xlabel("Sample")
                ax2.set_ylabel("Temperature (°C)")
                ax2.grid(True)
                plotted = False
                for uid, rows in snapshot.items():
                    if not rows:
                        continue
                    y = [float(v) for _t, v in rows]
                    x = list(range(1, len(y) + 1))
                    ax2.plot(x, y, marker="o", linewidth=1.5, markersize=3, label=self.unit_names.get(uid, f"CH{uid:02d}"))
                    plotted = True
                if plotted:
                    ax2.legend(loc="upper left", fontsize=8)
                fig2.tight_layout()
                pdf.savefig(fig2, bbox_inches="tight")
            return pdf_path
        except Exception as e:
            self.write_error_log(f"save trend pdf error: {e}")
            messagebox.showerror("錯誤", f"❌ PDF 產生失敗：{e}")
            return None

    def save_trend_report(self, show_message=True, report_format=None, folder=None):
        """V3.8T：存檔鍵內建取樣日期時間篩選。

        中文說明：
        - 使用者只要按「💾 存檔(取樣)」。
        - 程式會自動依「取樣日期」設定的開始/結束日期時間篩選資料。
        - 只輸出取樣區間內的 CSV / PNG / PDF。
        - 不刪除、不修改原始 Trend_History 與畫面趨勢資料。
        """
        snapshot = self._trend_snapshot()
        has_data = any(snapshot.get(uid) for uid in snapshot)
        if not has_data:
            if show_message:
                messagebox.showwarning("提醒", "目前沒有符合取樣日期時間的趨勢資料可存檔")
            return None

        if report_format is None and folder is None and show_message:
            options = self._ask_report_options("存檔格式與位置", for_print=False)
            if not options:
                return None
            report_format = options["format"]
            folder = options["folder"]

        report_format = (report_format or self.report_format_var.get() or "全部").strip()
        folder = self.normalize_report_folder(folder or self.report_folder_var.get() or self.trend_report_folder)
        self.report_folder_var.set(folder)
        self.trend_report_folder = folder
        folder = self._trend_report_dir()
        now_tag = datetime.now().strftime("%Y%m%d_%H%M%S")

        saved = {"folder": folder, "csv": [], "summary_csv": None, "png": None, "pdf": None}
        fmt_upper = report_format.upper()

        if fmt_upper in ("全部".upper(), "CSV"):
            # V3.8M：CSV 同時輸出「PDF摘要同格式」與各 CH 原始趨勢資料。
            saved["summary_csv"] = self._save_trend_summary_csv(snapshot, folder, now_tag)
            saved["csv"] = self._save_trend_csv_files(snapshot, folder, now_tag)

        if fmt_upper in ("全部".upper(), "PNG", "PDF"):
            # PDF 也會先建立 PNG，方便報表資料夾中有圖檔備份。
            saved["png"] = self._save_trend_png(snapshot, folder, now_tag)

        if fmt_upper in ("全部".upper(), "PDF"):
            saved["pdf"] = self._save_trend_pdf(snapshot, folder, now_tag, saved.get("png"))

        meta = self._report_metadata()
        self.set_status(f"💾 趨勢報表已依取樣時間存檔：{folder}", "green")
        if show_message:
            msg = (
                f"✅ 趨勢報表已依取樣時間存檔\n{folder}\n\n"
                f"取樣區間：{meta['start_date']} {meta['start_time']} ~ {meta['end_date']} {meta['end_time']}\n"
                f"格式：{report_format}"
            )
            if saved.get("pdf"):
                msg += f"\nPDF：{os.path.basename(saved['pdf'])}"
            if saved.get("png"):
                msg += f"\nPNG：{os.path.basename(saved['png'])}"
            if saved.get("summary_csv"):
                msg += f"\nCSV摘要：{os.path.basename(saved['summary_csv'])}"
            if saved.get("csv"):
                msg += f"\nCSV原始資料：{len(saved['csv'])} 個檔案"
            msg += "\n\n是否開啟資料夾？"
            if messagebox.askyesno("完成", msg):
                self.open_today_report_folder()
        return saved

    def print_trend_report(self):
        """V3.8T：列印時可選 PDF / PNG / CSV摘要，內容依取樣日期時間篩選。"""
        options = self._ask_report_options("列印內容與位置", for_print=True)
        if not options:
            return
        fmt = options.get("format", "PDF")
        saved = self.save_trend_report(show_message=False, report_format=fmt, folder=options.get("folder"))
        if not saved:
            return
        fmt_upper = fmt.upper()
        if fmt_upper == "PDF":
            path = saved.get("pdf")
        elif fmt_upper == "PNG":
            path = saved.get("png")
        elif fmt_upper == "CSV":
            path = saved.get("summary_csv")
        else:
            path = saved.get("pdf") or saved.get("png") or saved.get("summary_csv")
        if not path:
            messagebox.showerror("錯誤", "❌ 找不到可列印的報表檔")
            return
        try:
            sysname = platform.system().lower()
            if sysname == "windows":
                try:
                    os.startfile(path, "print")
                except Exception:
                    os.startfile(path)
            elif sysname == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
            self.set_status(f"🖨 已開啟 {fmt} 報表，請確認列印", "blue")
        except Exception as e:
            self.write_error_log(f"print trend report error: {e}")
            messagebox.showerror("錯誤", f"❌ 無法開啟列印：{e}")

    def clear_trend_stats(self):
        """MAX/MIN 歸零，但不影響既有趨勢資料。

        V3.8P 中文註解：
        - 本功能只重設 MAX / MIN 的統計起點。
        - 不清除 self.trend_data，所以趨勢線仍完整保留。
        - 不刪除 Trend_History 自動存檔。
        - 不刪除已輸出的 CSV / PNG / PDF。
        - AVG / COUNT 仍保留完整歷史資料統計。
        - MAX / MIN / RANGE 從目前最後一筆 PV 重新開始累計。
        """
        if not messagebox.askyesno(
            "確認",
            "確定要將 MAX/MIN 歸零嗎？\n\n"
            "此動作不會刪除趨勢圖資料、CSV、PDF 或歷史檔。\n"
            "只會從目前值重新開始計算 MAX / MIN。",
        ):
            return

        # 記錄每個 CH 的 MAX/MIN 新統計起點。
        # 例如 CH01 目前有 1000 筆，歸零後起點會設為第 1000 筆中的最後一筆。
        # 舊資料仍保留，只是不再參與新的 MAX/MIN 計算。
        with self._trend_lock:
            for uid in range(1, self.max_unit_id + 1):
                rows = self.trend_data.get(uid, [])
                if rows:
                    self.trend_minmax_reset_index[uid] = max(0, len(rows) - 1)
                else:
                    self.trend_minmax_reset_index[uid] = 0

        # 立即重畫趨勢圖與統計文字，但不清除任何資料檔。
        self._draw_trend_plot()
        self.set_status("♻ MAX/MIN 已歸零，趨勢資料與歷史檔保留", "green")
        try:
            self.audit("RESET_MAX_MIN_ONLY", "keep trend_data/history/csv/pdf")
        except Exception:
            pass

    def clear_trend_data(self):
        """清除所有 CH 的即時趨勢資料，並同步清除今日自動保存的趨勢歷史。"""
        with self._trend_lock:
            for uid in self.trend_data:
                self.trend_data[uid].clear()
            # 真正清除趨勢資料時，MAX/MIN 歸零起點也一起回到 0。
            # 注意：這是「清除趨勢資料」功能才會執行，MAX/MIN 歸零不會進到這裡。
            for uid in self.trend_minmax_reset_index:
                self.trend_minmax_reset_index[uid] = 0
        try:
            path = self._trend_history_file()
            if os.path.exists(path):
                os.remove(path)
        except Exception as e:
            self.write_error_log(f"clear trend history file error: {e}")
        self._draw_trend_plot()
        self.set_status("🗑 趨勢資料與今日歷史已清除", "yellow")

    # =========================================================
    # 通訊參數套用
    # =========================================================
    def apply_serial_settings(self):
        """套用通訊參數（需解鎖），立即重連生效。"""
        if not self.is_unlocked:
            messagebox.showwarning("提醒", "請先解鎖後再套用通訊參數")
            return

        baud = int(self.baud_var.get() or DEFAULT_SERIAL["baudrate"])
        parity = (self.parity_var.get() or "E").strip().upper()
        if parity not in ("N", "E", "O"):
            parity = "E"
            self.parity_var.set("E")

        stop = int(self.stopbits_var.get() or 1)
        if stop not in (1, 2):
            stop = 1
            self.stopbits_var.set(1)

        bits = int(self.bytesize_var.get() or 8)
        if bits not in (7, 8):
            bits = 8
            self.bytesize_var.set(8)

        tout = parse_float(self.timeout_var.get(), DEFAULT_SERIAL["timeout"])
        if tout <= 0:
            tout = DEFAULT_SERIAL["timeout"]
            self.timeout_var.set(str(tout))

        self.serial_cfg = {
            "baudrate": baud,
            "parity": parity,
            "stopbits": stop,
            "bytesize": bits,
            "timeout": float(tout),
        }

        self.audit(
            "APPLY_SERIAL",
            (
                f"baud={baud},parity={parity},stop={stop},"
                f"bits={bits},timeout={tout}"
            ),
        )
        messagebox.showinfo("完成", "✅ 已套用通訊參數，系統將自動重新連線")
        self.auto_reconnect_after_fix("通訊參數已套用")

    # =========================================================
    # 站號/名稱/位址
    # =========================================================
    def apply_names_to_checkbox(self):
        for uid in range(1, self.max_unit_id + 1):
            nm = (self.unit_name_vars[uid].get() or "").strip()
            if not nm:
                nm = f"CH{uid:02d}"
                self.unit_name_vars[uid].set(nm)

            self.unit_names[uid] = nm

            try:
                self.check_buttons[uid].config(text=f"{nm} (CH{uid:02d})")
            except Exception:
                pass

        self.rebuild_station_rows()

    def apply_names_and_reconnect(self):
        """按『套用名稱』後立即重新掃描 COM 並自動重新連線。"""
        if not self.is_unlocked:
            messagebox.showwarning("提醒", "請先解鎖後再套用名稱")
            return
        self.apply_names_to_checkbox()
        self.audit("APPLY_NAMES", "names updated")
        self.auto_reconnect_after_fix("名稱設定已套用")

    def rebuild_station_rows(self):
        """重建 PR20 風格 CH 卡片。"""
        for w in self.stations_frame.winfo_children():
            w.destroy()

        self.pv_vars = {uid: tk.StringVar(value="--") for uid in self.unit_ids}
        self.sv_vars = {uid: tk.StringVar(value="--") for uid in self.unit_ids}
        self.pv_labels = {}
        self.sv_labels = {}
        self.card_frames = {}

        # 依目前 CH 數量自適應欄數；單一 CH 會完整使用監控區。
        card_columns = min(4, max(1, len(self.unit_ids)))
        for c in range(card_columns):
            self.stations_frame.columnconfigure(c, weight=1)

        for idx, uid in enumerate(self.unit_ids):
            row = idx // card_columns
            col = idx % card_columns
            name = self.unit_names.get(uid, f"CH{uid:02d}")

            card = tk.Frame(
                self.stations_frame,
                bg="#0f1b2d",
                highlightbackground="#1e4976",
                highlightthickness=2,
                padx=16,
                pady=14,
            )
            card.grid(row=row, column=col, sticky="nsew", padx=8, pady=8)
            self.card_frames[uid] = card

            # 卡片上方：CH / ID / 名稱
            top = tk.Frame(card, bg="#0f1b2d")
            top.pack(fill="x")

            tk.Label(
                top,
                text=f"CH{uid:02d}",
                bg="#0f1b2d",
                fg="#4cc9f0",
                font=("Arial", 22, "bold"),
            ).pack(side="left")

            tk.Label(
                top,
                text=f"Slave ID={uid}",
                bg="#0f1b2d",
                fg="#fbbf24",
                font=("Arial", 13, "bold"),
            ).pack(side="right")

            tk.Label(
                card,
                text=name,
                bg="#0f1b2d",
                fg="#dbeafe",
                font=("Arial", 13, "bold"),
                anchor="w",
            ).pack(fill="x", pady=(2, 8))

            # PV 顯示
            tk.Label(
                card,
                text="PV",
                bg="#0f1b2d",
                fg="#8ea6c5",
                font=("Arial", 12, "bold"),
            ).pack(anchor="w")

            pv_label = tk.Label(
                card,
                textvariable=self.pv_vars[uid],
                bg="#06101f",
                fg="#35d6a0",
                font=("Arial", 38, "bold"),
                width=8,
                anchor="e",
                padx=8,
            )
            pv_label.pack(fill="x", pady=(0, 8))
            self.pv_labels[uid] = pv_label

            # SV 顯示
            tk.Label(
                card,
                text="SV",
                bg="#0f1b2d",
                fg="#8ea6c5",
                font=("Arial", 12, "bold"),
            ).pack(anchor="w")

            sv_label = tk.Label(
                card,
                textvariable=self.sv_vars[uid],
                bg="#06101f",
                fg="#a78bfa",
                font=("Arial", 30, "bold"),
                width=8,
                anchor="e",
                padx=8,
            )
            sv_label.pack(fill="x")
            self.sv_labels[uid] = sv_label

        self.root.after_idle(lambda: self.card_canvas.yview_moveto(0))

    def _sync_enable_vars_from_unit_ids(self):
        """同步舊版 checkbox 變數，避免儲存時被舊勾選狀態覆蓋。"""
        try:
            active = set(int(x) for x in self.unit_ids)
            for uid, var in self.unit_enable_vars.items():
                var.set(uid in active)
        except Exception as e:
            self.write_error_log(f"sync_enable_vars error: {e}")

    def apply_channel_count(self, rebuild_only=False):
        """V4.8：套用 CH Number。

        CH Number = 8  -> 顯示 / 輪詢 CH01~CH08
        CH Number = 24 -> 顯示 / 輪詢 CH01~CH24
        CH Number = 30 -> 顯示 / 輪詢 CH01~CH30
        """
        try:
            if (not self.is_unlocked) and (not rebuild_only):
                messagebox.showwarning("提醒", "請先解鎖後再套用 CH 數量")
                return

            count = int(self.channel_count_var.get() or DEFAULT_CHANNEL_COUNT)
            count = max(1, min(self.max_unit_id, count))
            self.channel_count = count
            self.channel_count_var.set(count)
            self.unit_ids = list(range(1, count + 1))
            self._sync_enable_vars_from_unit_ids()
            self.rebuild_station_rows()
            try:
                self.apply_names_to_checkbox()
            except Exception:
                pass

            if rebuild_only:
                return

            self.audit("APPLY_CH_NUMBER", f"channel_count={count}")
            self.set_status(f"✅ CH Number = {count}，顯示 CH01~CH{count:02d}，自動重新連線中...", "green")
            messagebox.showinfo("完成", f"✅ CH Number = {count}\n顯示 CH01～CH{count:02d}")
            self.auto_reconnect_after_fix(f"CH Number 已套用：{count}")
        except Exception as e:
            self.write_error_log(f"apply_channel_count error: {e}")
            self.set_status(f"❌ CH 數量設定失敗：{e}", "red")

    def add_channel(self):
        """新增 CH 到監控列表。"""
        try:
            ch_text = self.add_ch_var.get().replace("CH", "")
            uid = int(ch_text)

            if uid not in self.unit_ids:
                self.unit_ids.append(uid)
                self.unit_ids = sorted(set(self.unit_ids))
                self.channel_count = max(self.unit_ids)
                self.channel_count_var.set(self.channel_count)
                self._sync_enable_vars_from_unit_ids()
                self.rebuild_station_rows()
                self.set_status(f"✅ 已新增 CH{uid:02d}，自動重新連線中...", "green")
                self.auto_reconnect_after_fix(f"已新增 CH{uid:02d}")
            else:
                self.set_status(f"CH{uid:02d} 已在監控列表中", "yellow")
        except Exception as e:
            self.write_error_log(f"add_channel error: {e}")

    def remove_channel(self):
        """從監控列表移除 CH。"""
        try:
            ch_text = self.add_ch_var.get().replace("CH", "")
            uid = int(ch_text)

            if uid in self.unit_ids:
                self.unit_ids.remove(uid)

                # 至少保留一個 CH，避免沒有監控項目
                if not self.unit_ids:
                    self.unit_ids = [1]

                self.unit_ids = sorted(set(self.unit_ids))
                self.channel_count = max(self.unit_ids) if self.unit_ids else 1
                self.channel_count_var.set(self.channel_count)
                self._sync_enable_vars_from_unit_ids()
                self.rebuild_station_rows()
                self.set_status(f"⚠️ 已移除 CH{uid:02d}，自動重新連線中...", "orange")
                self.auto_reconnect_after_fix(f"已移除 CH{uid:02d}")
            else:
                self.set_status(f"CH{uid:02d} 未在監控列表中", "yellow")

        except Exception as e:
            self.write_error_log(f"remove_channel error: {e}")
            self.set_status(f"❌ 移除 CH 失敗：{e}", "red")

    def apply_unit_selection(self, rebuild_only=False):
        """套用目前 CH 清單、名稱、PV/SV 位址。
        V3.7B：以 add/remove 後的 self.unit_ids 為準，不再用舊 checkbox 狀態覆蓋。
        """
        if (not self.is_unlocked) and (not rebuild_only):
            messagebox.showwarning("提醒", "請先解鎖後再套用")
            return

        try:
            count = int(self.channel_count_var.get() or self.channel_count or DEFAULT_CHANNEL_COUNT)
        except Exception:
            count = self.channel_count or DEFAULT_CHANNEL_COUNT
        count = max(1, min(self.max_unit_id, count))
        self.channel_count = count
        self.channel_count_var.set(count)
        selected = list(range(1, count + 1))

        for uid in range(1, self.max_unit_id + 1):
            nm = (
                (self.unit_name_vars[uid].get() or "").strip()
                or f"CH{uid:02d}"
            )
            self.unit_name_vars[uid].set(nm)
            self.unit_names[uid] = nm

            pv = parse_int_maybe_hex(
                self.unit_pv_vars[uid].get(),
                self.unit_addrs[uid]["PV"],
            )
            sv = parse_int_maybe_hex(
                self.unit_sv_vars[uid].get(),
                self.unit_addrs[uid]["SV"],
            )
            self.unit_addrs[uid] = {"PV": pv, "SV": sv}
            self.unit_pv_vars[uid].set(str(pv))
            self.unit_sv_vars[uid].set(str(sv))

        self.unit_ids = selected
        self._sync_enable_vars_from_unit_ids()
        self.rebuild_station_rows()
        self.apply_names_to_checkbox()

        if rebuild_only:
            return

        self.audit(
            "APPLY_SELECTION",
            f"Selected={','.join([f'{u:02d}' for u in self.unit_ids])}",
        )
        messagebox.showinfo(
            "提示",
            "✅ 已套用 CH："
            + ", ".join(
                [self.unit_names[u] + f"(CH{u:02d})" for u in self.unit_ids]
            ),
        )
        self.auto_reconnect_after_fix("CH / 位址設定已套用")


    # =========================================================
    # V4.3 Email / LINE GUI 設定（密碼保護）
    # =========================================================
    def init_notify_vars(self):
        """建立 / 同步 Email、LINE 設定變數。密碼與 Token 欄位預設空白，空白儲存會保留舊值。"""
        try:
            cfg = self.merge_notify_config(getattr(self, "notify_cfg", {}))
            def bv(k): return tk.BooleanVar(value=bool(cfg.get(k)))
            def sv(k): return tk.StringVar(value=str(cfg.get(k, "") or ""))
            self.notify_vars = {
                "email_enable": bv("email_enable"),
                "smtp_server": sv("smtp_server"),
                "smtp_port": sv("smtp_port"),
                "smtp_user": sv("smtp_user"),
                "smtp_from": sv("smtp_from"),
                "smtp_to": sv("smtp_to"),
                "email_subject": sv("email_subject"),
                "email_tls": bv("email_tls"),
                "line_enable": bv("line_enable"),
                "line_mode": sv("line_mode"),
                "line_user_id": sv("line_user_id"),
                "cooldown_minutes": sv("cooldown_minutes"),
                "recovery_enable": bv("recovery_enable"),
            }
            self.notify_password_var = tk.StringVar(value="")
            self.notify_token_var = tk.StringVar(value="")
        except Exception:
            pass

    def sync_notify_vars_from_cfg(self):
        """載入 config 後，把 notify_cfg 同步到 GUI 欄位。"""
        try:
            if not getattr(self, "notify_vars", None):
                self.init_notify_vars()
            cfg = self.merge_notify_config(getattr(self, "notify_cfg", {}))
            for k, var in self.notify_vars.items():
                if isinstance(var, tk.BooleanVar):
                    var.set(bool(cfg.get(k)))
                else:
                    var.set(str(cfg.get(k, "") or ""))
            if self.notify_password_var:
                self.notify_password_var.set("")
            if self.notify_token_var:
                self.notify_token_var.set("")
        except Exception as e:
            self.write_error_log(f"sync_notify_vars_from_cfg error: {e}")

    def collect_notify_cfg_from_gui(self):
        """從 GUI 收集 Email / LINE 設定；SMTP 密碼與 LINE Token 空白則保留原值。"""
        try:
            if not getattr(self, "notify_vars", None):
                return dict(self.notify_cfg)
            data = {}
            for k, var in self.notify_vars.items():
                data[k] = var.get()
            pwd = self.notify_password_var.get().strip() if self.notify_password_var else ""
            token = self.notify_token_var.get().strip() if self.notify_token_var else ""
            if pwd:
                data["smtp_password"] = pwd
            if token:
                data["line_token"] = token
            merged = dict(self.notify_cfg)
            merged.update(data)
            self.notify_cfg = self.merge_notify_config(merged)
            if self.notify_password_var:
                self.notify_password_var.set("")
            if self.notify_token_var:
                self.notify_token_var.set("")
            return dict(self.notify_cfg)
        except Exception as e:
            self.write_error_log(f"collect_notify_cfg_from_gui error: {e}")
            return dict(self.notify_cfg)

    def build_notify_setting_box(self, parent):
        """建立 Email / LINE 設定框；parent 會隨右側設定區一起被密碼鎖定隱藏。"""
        try:
            self.init_notify_vars()
            box = tk.LabelFrame(
                parent,
                text="📧 Email / 💬 LINE 警報通知設定（解鎖後顯示）",
                bg="#111827", fg="#e5e7eb", padx=6, pady=6,
            )
            box.grid(row=6, column=0, columnspan=2, sticky="we", padx=4, pady=(8, 4))
            box.columnconfigure(1, weight=1)
            box.columnconfigure(3, weight=1)
            self.notify_frame = box

            def add_label(r, c, text):
                tk.Label(box, text=text, bg="#111827", fg="#facc15", font=("Arial", 10, "bold"), anchor="w").grid(row=r, column=c, sticky="w", padx=2, pady=2)

            def add_entry(r, c, key, width=24, show=None, var=None):
                ent = tk.Entry(box, textvariable=(var or self.notify_vars[key]), width=width, show=show or "", bg="#1f2937", fg="white", insertbackground="white")
                ent.grid(row=r, column=c, sticky="we", padx=2, pady=2)
                self._lock_widgets.append(ent)
                return ent

            cb1 = tk.Checkbutton(box, text="Email 啟用", variable=self.notify_vars["email_enable"], bg="#111827", fg="#22c55e", selectcolor="#111827", activebackground="#111827", activeforeground="#22c55e", font=("Arial", 10, "bold"))
            cb1.grid(row=0, column=0, sticky="w", padx=2, pady=2); self._lock_widgets.append(cb1)
            cb2 = tk.Checkbutton(box, text="TLS", variable=self.notify_vars["email_tls"], bg="#111827", fg="#22c55e", selectcolor="#111827", activebackground="#111827", activeforeground="#22c55e", font=("Arial", 10, "bold"))
            cb2.grid(row=0, column=1, sticky="w", padx=2, pady=2); self._lock_widgets.append(cb2)
            cb3 = tk.Checkbutton(box, text="LINE 啟用", variable=self.notify_vars["line_enable"], bg="#111827", fg="#22c55e", selectcolor="#111827", activebackground="#111827", activeforeground="#22c55e", font=("Arial", 10, "bold"))
            cb3.grid(row=0, column=2, sticky="w", padx=2, pady=2); self._lock_widgets.append(cb3)
            cb4 = tk.Checkbutton(box, text="恢復通知", variable=self.notify_vars["recovery_enable"], bg="#111827", fg="#22c55e", selectcolor="#111827", activebackground="#111827", activeforeground="#22c55e", font=("Arial", 10, "bold"))
            cb4.grid(row=0, column=3, sticky="w", padx=2, pady=2); self._lock_widgets.append(cb4)

            add_label(1,0,"SMTP"); add_entry(1,1,"smtp_server")
            add_label(1,2,"Port"); add_entry(1,3,"smtp_port", width=8)
            add_label(2,0,"帳號"); add_entry(2,1,"smtp_user")
            add_label(2,2,"密碼"); add_entry(2,3,"smtp_password", show="*", var=self.notify_password_var)
            add_label(3,0,"寄件人"); add_entry(3,1,"smtp_from")
            add_label(3,2,"收件人"); add_entry(3,3,"smtp_to")
            add_label(4,0,"主旨"); add_entry(4,1,"email_subject")
            add_label(4,2,"重送分"); add_entry(4,3,"cooldown_minutes", width=8)
            add_label(5,0,"LINE模式")
            line_cb = ttk.Combobox(box, textvariable=self.notify_vars["line_mode"], values=["notify", "messaging_broadcast", "messaging_push"], width=24, state="readonly")
            line_cb.grid(row=5, column=1, sticky="we", padx=2, pady=2); self._lock_widgets.append(line_cb)
            add_label(5,2,"Token"); add_entry(5,3,"line_token", show="*", var=self.notify_token_var)
            add_label(6,0,"User ID"); add_entry(6,1,"line_user_id")

            # V5.1：主畫面 Operator 改成下拉選單。
            # Config 內部固定儲存：admin / operator / guest；畫面依語言顯示中文或英文。
            add_label(7,0,"紀錄人")
            self.operator_cb = ttk.Combobox(
                box,
                textvariable=self.alarm_operator_var,
                values=_ec62_operator_values(self),
                width=24,
                state="readonly",
            )
            self.operator_cb.grid(row=7, column=1, sticky="we", padx=2, pady=2)
            self.operator_cb.bind("<<ComboboxSelected>>", lambda _e: self._ec62_update_operator_combobox_display())
            self._lock_widgets.append(self.operator_cb)
            try:
                self._ec62_update_operator_combobox_display()
            except Exception:
                pass
            add_label(7,2,"解除原因"); rs_ent = tk.Entry(box, textvariable=self.alarm_reason_var, width=24, bg="#1f2937", fg="white", insertbackground="white")
            rs_ent.grid(row=7, column=3, sticky="we", padx=2, pady=2); self._lock_widgets.append(rs_ent)

            btn_save = tk.Button(box, text="💾 儲存通知設定", command=self.save_notify_from_gui, bg="#f59e0b", fg="black", relief="flat", font=("Arial", 10, "bold"))
            btn_save.grid(row=8, column=0, columnspan=4, sticky="we", padx=2, pady=(6,2)); self._lock_widgets.append(btn_save)

            # V4.7A：測試通知按鈕移至下一行，並加入中英文顯示，避免與儲存鍵擠在同一行。
            btn_mail = tk.Button(box, text="📧 Test Email / 測試 Email", command=lambda: self.test_notify_from_gui("email"), bg="#334155", fg="white", relief="flat", font=("Arial", 10, "bold"))
            btn_mail.grid(row=9, column=0, columnspan=2, sticky="we", padx=2, pady=(6,2)); self._lock_widgets.append(btn_mail)
            btn_line = tk.Button(box, text="💬 Test LINE / 測試 LINE", command=lambda: self.test_notify_from_gui("line"), bg="#334155", fg="white", relief="flat", font=("Arial", 10, "bold"))
            btn_line.grid(row=9, column=2, columnspan=2, sticky="we", padx=2, pady=(6,2)); self._lock_widgets.append(btn_line)

            tk.Label(box, text="密碼 / Token 空白儲存會保留原值；Operator / Reason 會用於 Web 警報解除記錄。", bg="#111827", fg="#94a3b8", font=("Arial", 9, "bold")).grid(row=10, column=0, columnspan=4, sticky="w", padx=2, pady=(4,0))
        except Exception as e:
            self.write_error_log(f"build_notify_setting_box error: {e}")

    def save_notify_from_gui(self):
        if not self.is_unlocked:
            messagebox.showwarning("提醒", "🔒 請先輸入密碼解鎖後再設定 Email / LINE")
            return
        self.collect_notify_cfg_from_gui()
        self.save_config()
        self.set_status("✅ Email / LINE 通知設定已儲存", "green")

    def test_notify_from_gui(self, target="all"):
        if not self.is_unlocked:
            messagebox.showwarning("提醒", "🔒 請先輸入密碼解鎖後再測試 Email / LINE")
            return
        self.collect_notify_cfg_from_gui()
        result = self.web_test_notify(target)
        messagebox.showinfo("通知測試", result.get("message", "OK"))

    # =========================================================
    # 狀態
    # =========================================================
    def set_status(self, text, color="green"):
        try:
            self.status_var.set(text)

            color_map = {
                "green": "#22c55e",
                "red": "#ef4444",
                "blue": "#38bdf8",
                "orange": "#f97316",
                "yellow": "#facc15",
                "gray": "#94a3b8",
            }
            fg = color_map.get(color, color)
            self.status_label.config(fg=fg, font=("Arial", 18, "bold"))

            # PR20 風格 RUN LED
            if hasattr(self, "run_led"):
                if "已連線" in text or "解鎖" in text:
                    self.run_led.config(fg="#22c55e")
                elif "失敗" in text or "error" in text.lower() or "拔除" in text:
                    self.run_led.config(fg="#ef4444")
                elif "上鎖" in text:
                    self.run_led.config(fg="#38bdf8")
                else:
                    self.run_led.config(fg="#facc15")
        except Exception:
            pass

    # =========================================================
    # 鎖定/解鎖
    # =========================================================
    def lock_settings(self, init=False):
        """上鎖後，關閉並隱藏設定框，只保留 Header 的解鎖按鈕。"""
        self.is_unlocked = False

        for w in getattr(self, "_lock_widgets", []):
            try:
                w.config(state="disabled")
            except Exception:
                pass

        # PR20 模式：上鎖後直接收合設定區
        try:
            if hasattr(self, "main_pane") and hasattr(self, "right_wrap"):
                panes = [str(p) for p in self.main_pane.panes()]
                if str(self.right_wrap) in panes:
                    self.main_pane.forget(self.right_wrap)
            elif hasattr(self, "right_wrap"):
                self.right_wrap.grid_remove()
        except Exception:
            pass

        # PR20 工業風：上鎖後主要功能變暗
        try:
            self.apply_btn.config(state="disabled", bg="#14532d", fg="#94a3b8")
            self.apply_name_btn.config(
                state="disabled",
                bg="#1e3a8a",
                fg="#94a3b8",
            )
            self.save_btn.config(state="disabled", bg="#78350f", fg="#94a3b8")
            self.apply_serial_btn.config(
                state="disabled",
                bg="#1f2937",
                fg="#64748b",
            )
            self.change_pw_btn.config(
                state="disabled",
                bg="#713f12",
                fg="#94a3b8",
            )
            self.btn_toggle_config.config(
                text="🔐 " + self.tr("輸入密碼以顯示設定"),
                bg="#64748b",
                fg="black",
                activebackground="#94a3b8",
                activeforeground="black",
            )
        except Exception:
            pass

        self.set_status("🔒 " + self.tr("設定已上鎖，請輸入密碼解鎖"), "blue")
        if not init:
            self.audit("LOCK")

    def unlock_settings(self):
        """密碼正確後，顯示 PR20 風格設定框，並開啟所有設定功能。"""
        self.is_unlocked = True

        # 顯示右側設定框
        try:
            if hasattr(self, "main_pane") and hasattr(self, "right_wrap"):
                panes = [str(p) for p in self.main_pane.panes()]
                if str(self.right_wrap) not in panes:
                    self.main_pane.add(self.right_wrap, minsize=560)
                    self.root.after(100, self.place_main_sash_safe)
                self.right_wrap.lift()
            else:
                self.right_wrap.grid()
                self.right_wrap.lift()
        except Exception:
            pass

        for w in getattr(self, "_lock_widgets", []):
            try:
                if isinstance(w, ttk.Combobox):
                    w.config(state="readonly")
                else:
                    w.config(state="normal")
            except Exception:
                pass

        # PR20 工業風：解鎖後把主要按鈕打開並變亮
        try:
            self.apply_btn.config(state="normal", bg="#00AA00", fg="white")
            self.apply_name_btn.config(
                state="normal",
                bg="#2563EB",
                fg="white",
            )
            self.save_btn.config(state="normal", bg="#F59E0B", fg="black")
            self.apply_serial_btn.config(
                state="normal",
                bg="#334155",
                fg="white",
            )
            self.change_pw_btn.config(state="normal", bg="#facc15", fg="black")
            self.btn_toggle_config.config(
                text="▲ " + self.tr("設定(按上鎖可關閉）"),
                bg="#00AA00",
                fg="white",
                activebackground="#00CC00",
                activeforeground="white",
            )
        except Exception:
            pass

        self.set_status("✅ " + self.tr("設定已解鎖，可修改 / 套用 / 儲存"), "green")
        self.show_workspace_tab(getattr(self, "workspace_tab", "settings"))
        self.audit("UNLOCK")

    def _lockout_remaining(self) -> int:
        now = time.time()
        if now >= self._lockout_until:
            return 0
        return int(self._lockout_until - now)

    def flash_password_window_red(self, win):
        """密碼錯誤時，密碼視窗閃紅，PR20 工業風效果。"""
        try:
            colors = ["#440000", "#111111", "#660000", "#111111"]

            def _flash(i=0):
                if not win.winfo_exists():
                    return
                if i < len(colors):
                    win.configure(bg=colors[i])
                    self.root.after(90, lambda: _flash(i + 1))
                else:
                    win.configure(bg="#111111")

            _flash(0)
        except Exception:
            pass

    def close_password_window(self):
        """安全關閉密碼視窗。"""
        try:
            if (
                self.password_window is not None
                and self.password_window.winfo_exists()
            ):
                try:
                    self.password_window.grab_release()
                except Exception:
                    pass
                self.password_window.destroy()
        except Exception:
            pass
        finally:
            self.password_window = None

    def unlock_dialog(self):
        """PR20 工業風密碼視窗：顯示/隱藏、Enter、Esc、錯誤閃紅、3次鎖定。"""
        remain = self._lockout_remaining()
        if remain > 0:
            messagebox.showwarning(
                self.tr("鎖定中"),
                f"⛔ {self.tr('密碼錯誤')} / {remain} {self.tr('秒')}",
            )
            self.audit("UNLOCK_BLOCKED", f"remain={remain}s")
            return

        # 已存在密碼視窗時，直接拉到最前面
        try:
            if (
                self.password_window is not None
                and self.password_window.winfo_exists()
            ):
                self.password_window.lift()
                self.password_window.focus_force()
                return
        except Exception:
            pass

        win = tk.Toplevel(self.root)
        self.password_window = win

        win.title(self.tr("密碼驗證"))
        win.geometry("800x300")
        win.configure(bg="#111111")
        win.resizable(False, False)
        win.transient(self.root)
        win.grab_set()

        # 視窗置中
        try:
            self.root.update_idletasks()
            x = self.root.winfo_x() + (self.root.winfo_width() // 2) - 450
            y = self.root.winfo_y() + (self.root.winfo_height() // 2) - 275
            win.geometry(f"800x300+{x}+{y}")
        except Exception:
            pass

        # 上方標題列
        topbar = tk.Frame(win, bg="#1A1A1A", height=42)
        topbar.pack(fill="x")
        topbar.pack_propagate(False)

        tk.Label(
            topbar,
            text="🔐 " + self.tr("E62 / C62 參數設定解鎖"),
            bg="#1A1A1A",
            fg="#00E5FF",
            font=("Arial", 14, "bold"),
        ).pack(side="left", padx=12)

        tk.Button(
            topbar,
            text="✕",
            command=self.close_password_window,
            bg="#661111",
            fg="white",
            font=("Arial", 11, "bold"),
            width=4,
            relief="flat",
            activebackground="#AA2222",
            activeforeground="white",
        ).pack(side="right", padx=8, pady=5)

        body = tk.Frame(win, bg="#111111")
        body.pack(fill="both", expand=True, padx=18, pady=14)

        tk.Label(
            body,
            text=self.tr("請輸入密碼"),
            bg="#111111",
            fg="#00E5FF",
            font=("Arial", 15, "bold"),
        ).pack(pady=(4, 6))

        tk.Label(
            body,
            text=self.tr("解鎖後可修改 RTU 通訊參數、CH、PV/SV 位址、Email / LINE 設定"),
            bg="#111111",
            fg="#BBBBBB",
            font=("Arial", 10, "bold"),
        ).pack(pady=(0, 10))

        pwd_var = tk.StringVar()
        show_pwd_var = tk.BooleanVar(value=False)

        pwd_entry = tk.Entry(
            body,
            textvariable=pwd_var,
            show="*",
            font=("Courier", 20, "bold"),
            width=20,
            justify="center",
            bg="#1A1A1A",
            fg="#00FFCC",
            insertbackground="#00FFCC",
            relief="solid",
            bd=1,
        )
        pwd_entry.pack(ipady=8, pady=(0, 8))
        pwd_entry.focus_set()

        hint_label = tk.Label(
            body,
            text="",
            bg="#111111",
            fg="#FF6666",
            font=("Arial", 11, "bold"),
        )
        hint_label.pack(pady=(0, 4))

        def toggle_show_password():
            pwd_entry.config(show="" if show_pwd_var.get() else "*")

        tk.Checkbutton(
            body,
            text=self.tr("顯示密碼"),
            variable=show_pwd_var,
            command=toggle_show_password,
            bg="#111111",
            fg="yellow",
            selectcolor="#111111",
            activebackground="#111111",
            activeforeground="yellow",
            font=("Courier", 11, "bold"),
        ).pack(pady=(0, 6))

        btn_frame = tk.Frame(body, bg="#111111")
        btn_frame.pack(pady=4)

        def check_pwd():
            remain2 = self._lockout_remaining()
            if remain2 > 0:
                hint_label.config(text=f"{self.tr('已鎖定，請')} {remain2} {self.tr('秒後再試')}")
                self.audit("UNLOCK_BLOCKED", f"remain={remain2}s")
                return

            if pwd_var.get() == self.password:
                self._fail_count = 0
                self._lockout_until = 0.0
                self.close_password_window()
                self.unlock_settings()
                return

            self._fail_count += 1
            left = MAX_FAILS - self._fail_count
            self.audit("UNLOCK_FAIL", f"fail_count={self._fail_count}")
            self.flash_password_window_red(win)
            pwd_var.set("")
            pwd_entry.focus_set()

            if self._fail_count >= MAX_FAILS:
                self._lockout_until = time.time() + LOCKOUT_SECONDS
                self._fail_count = 0
                hint_label.config(text=f"{self.tr('錯誤 3 次，已鎖定')} {LOCKOUT_SECONDS} {self.tr('秒')}")
                self.audit("LOCKOUT", f"{LOCKOUT_SECONDS}s")
                self.set_status(f"❌ {self.tr('錯誤 3 次，已鎖定')} {LOCKOUT_SECONDS} {self.tr('秒')}", "red")
                return

            hint_label.config(text=f"{self.tr('密碼錯誤，剩餘')} {left} {self.tr('次機會')}")
            self.set_status("❌ " + self.tr("密碼錯誤"), "red")

        tk.Button(
            btn_frame,
            text=self.tr("確認"),
            command=check_pwd,
            bg="#00AA00",
            fg="white",
            font=("Courier", 12, "bold"),
            width=12,
            height=2,
            relief="flat",
            activebackground="#00CC00",
            activeforeground="white",
        ).pack(side="left", padx=12, ipady=4)

        tk.Button(
            btn_frame,
            text=self.tr("取消"),
            command=self.close_password_window,
            bg="#AA3333",
            fg="white",
            font=("Courier", 12, "bold"),
            width=12,
            height=2,
            relief="flat",
            activebackground="#CC4444",
            activeforeground="white",
        ).pack(side="left", padx=12, ipady=4)

        win.bind("<Return>", lambda _e: check_pwd())
        win.bind("<Escape>", lambda _e: self.close_password_window())
        win.protocol("WM_DELETE_WINDOW", self.close_password_window)

    def change_password_dialog(self):
        if not self.is_unlocked:
            messagebox.showwarning(self.tr("提醒"), self.tr("請先解鎖後再修改密碼"))
            return

        win = tk.Toplevel(self.root)
        win.title(self.tr("修改密碼"))
        win.resizable(False, False)
        win.transient(self.root)
        win.grab_set()

        cur_var = tk.StringVar()
        new1_var = tk.StringVar()
        new2_var = tk.StringVar()

        tk.Label(win, text=self.tr("目前密碼："), font=("Arial", 12)).grid(
            row=0,
            column=0,
            padx=10,
            pady=(10, 4),
            sticky="w",
        )
        e_cur = tk.Entry(
            win,
            textvariable=cur_var,
            show="*",
            width=24,
            font=("Arial", 12),
        )
        e_cur.grid(row=0, column=1, padx=10, pady=(10, 4))

        tk.Label(win, text=self.tr("新密碼："), font=("Arial", 12)).grid(
            row=1,
            column=0,
            padx=10,
            pady=4,
            sticky="w",
        )
        e_new1 = tk.Entry(
            win,
            textvariable=new1_var,
            show="*",
            width=24,
            font=("Arial", 12),
        )
        e_new1.grid(row=1, column=1, padx=10, pady=4)

        tk.Label(win, text=self.tr("再輸入一次："), font=("Arial", 12)).grid(
            row=2,
            column=0,
            padx=10,
            pady=4,
            sticky="w",
        )
        e_new2 = tk.Entry(
            win,
            textvariable=new2_var,
            show="*",
            width=24,
            font=("Arial", 12),
        )
        e_new2.grid(row=2, column=1, padx=10, pady=4)

        def do_change():
            cur = cur_var.get()
            n1 = new1_var.get()
            n2 = new2_var.get()

            if cur != self.password:
                messagebox.showerror(self.tr("錯誤"), "❌ " + self.tr("目前密碼不正確"))
                e_cur.focus_set()
                return

            if not n1 or len(n1) < 4:
                messagebox.showerror(self.tr("錯誤"), "❌ " + self.tr("新密碼至少 4 碼"))
                e_new1.focus_set()
                return

            if n1 != n2:
                messagebox.showerror(self.tr("錯誤"), "❌ " + self.tr("兩次輸入的新密碼不一致"))
                e_new2.focus_set()
                return

            self.password = n1
            self.save_config_silent_password_only()
            self.audit("CHANGE_PASSWORD")
            messagebox.showinfo(self.tr("完成"), "✅ " + self.tr("密碼已修改並儲存"))
            win.destroy()
            self.set_status("✅ " + self.tr("密碼已更新"), "green")

        tk.Button(
            win,
            text=self.tr("更新密碼"),
            command=do_change,
            font=("Arial", 12),
            bg="#FFF2CC",
        ).grid(
            row=3,
            column=0,
            columnspan=2,
            padx=10,
            pady=(8, 10),
            sticky="we",
        )

        e_cur.focus_set()
        win.bind("<Return>", lambda _e: do_change())

    def save_config_silent_password_only(self):
        """修改密碼時只安全寫入密碼欄位。"""
        try:
            cfg = {}
            if os.path.exists(self.config_path):
                with open(self.config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f) or {}
            cfg["password"] = self.password
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
        except Exception as e:
            messagebox.showwarning("提醒", f"⚠️ 密碼已修改，但寫入設定檔失敗：{e}")

    # =========================================================
    # 設定載入/儲存
    # =========================================================
    def load_config(self):
        try:
            if not os.path.exists(self.config_path):
                return

            with open(self.config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or {}

            if "interval" in cfg:
                try:
                    self.interval_var.set(int(cfg["interval"]))
                except Exception:
                    pass

            self.password = cfg.get("password") or DEFAULT_PASSWORD

            serial_cfg = cfg.get("serial", {})
            if isinstance(serial_cfg, dict):
                baud = int(
                    serial_cfg.get("baudrate", DEFAULT_SERIAL["baudrate"])
                )
                parity = str(
                    serial_cfg.get("parity", DEFAULT_SERIAL["parity"])
                ).upper()
                stop = int(
                    serial_cfg.get("stopbits", DEFAULT_SERIAL["stopbits"])
                )
                bits = int(
                    serial_cfg.get("bytesize", DEFAULT_SERIAL["bytesize"])
                )
                tout = float(
                    serial_cfg.get("timeout", DEFAULT_SERIAL["timeout"])
                )

                if parity not in ("N", "E", "O"):
                    parity = DEFAULT_SERIAL["parity"]
                if stop not in (1, 2):
                    stop = DEFAULT_SERIAL["stopbits"]
                if bits not in (7, 8):
                    bits = DEFAULT_SERIAL["bytesize"]
                if tout <= 0:
                    tout = DEFAULT_SERIAL["timeout"]

                self.serial_cfg = {
                    "baudrate": baud,
                    "parity": parity,
                    "stopbits": stop,
                    "bytesize": bits,
                    "timeout": tout,
                }
                self.baud_var.set(baud)
                self.parity_var.set(parity)
                self.stopbits_var.set(stop)
                self.bytesize_var.set(bits)
                self.timeout_var.set(str(tout))

            trend_cfg = cfg.get("trend", {})
            if isinstance(trend_cfg, dict):
                try:
                    # V3.8U：載入趨勢圖設定
                    # 中文說明：
                    # 1. 保留筆數、自動更新開關會在開機時自動載入。
                    # 2. CH 勾選狀態會在開啟趨勢圖時自動套用。
                    # 3. 這些設定只影響趨勢圖顯示，不會修改任何量測資料。
                    self.trend_update_var.set(str(trend_cfg.get("update", self.trend_update_var.get())))
                    self.trend_max_points_var.set(int(trend_cfg.get("max_points", self.trend_max_points_var.get())))
                    self.trend_enable_var.set(bool(trend_cfg.get("enable", self.trend_enable_var.get())))
                    self.trend_zoom_manual = bool(trend_cfg.get("zoom_manual", False))
                    selected_channels = trend_cfg.get("selected_channels", None)
                    if isinstance(selected_channels, list):
                        selected_set = set()
                        for x in selected_channels:
                            try:
                                n = int(x)
                                if 1 <= n <= self.max_unit_id:
                                    selected_set.add(n)
                            except Exception:
                                pass
                        if selected_set:
                            for uid in range(1, self.max_unit_id + 1):
                                self.trend_ch_vars[uid].set(uid in selected_set)
                except Exception:
                    pass

            report_cfg = cfg.get("report", {})
            if isinstance(report_cfg, dict):
                try:
                    folder = str(report_cfg.get("folder", self.trend_report_folder)).strip()
                    # V3.8V：若舊設定仍指向 OneDrive / 文件，改回 EC62 共用資料夾，避免同步鎖檔。
                    # 若現場真的需要其他路徑，可在「報表路徑」重新選擇後儲存。
                    if folder and ("onedrive" not in folder.lower()) and ("文件" not in folder):
                        self.trend_report_folder = self.normalize_report_folder(folder)
                    else:
                        self.trend_report_folder = self.common_folder
                    self.report_folder_var.set(self.trend_report_folder)
                    fmt = str(report_cfg.get("format", self.report_format_var.get())).strip() or "全部"
                    if fmt in ("全部", "CSV", "PNG", "PDF"):
                        self.report_format_var.set(fmt)
                    self.report_title_var.set(str(report_cfg.get("title", self.report_title_var.get())).strip() or "SGS Temperature Validation Report")
                    self.company_name_var.set(str(report_cfg.get("company_name", self.company_name_var.get())).strip() or "CM LAB")
                    self.customer_name_var.set(str(report_cfg.get("customer_name", self.customer_name_var.get())).strip() or "ADVANTECH")
                    self.calibration_no_var.set(str(report_cfg.get("calibration_no", self.calibration_no_var.get())).strip() or "CM-2026-001")
                    self.sample_start_date_var.set(str(report_cfg.get("start_date", self.sample_start_date_var.get())).strip() or datetime.now().strftime("%Y-%m-%d"))
                    self.sample_start_time_var.set(str(report_cfg.get("start_time", self.sample_start_time_var.get())).strip() or "08:00:00")
                    self.sample_end_date_var.set(str(report_cfg.get("end_date", self.sample_end_date_var.get())).strip() or datetime.now().strftime("%Y-%m-%d"))
                    self.sample_end_time_var.set(str(report_cfg.get("end_time", self.sample_end_time_var.get())).strip() or "17:00:00")
                except Exception:
                    pass

            ids = cfg.get("unit_ids", None)
            if (not has_channel_count) and isinstance(ids, list) and ids:
                # 舊版 config 沒有 channel_count 時，沿用舊的 unit_ids。
                ids2 = []
                for x in ids:
                    try:
                        n = int(x)
                        if 1 <= n <= self.max_unit_id:
                            ids2.append(n)
                    except Exception:
                        pass
                if ids2:
                    self.unit_ids = sorted(set(ids2))
                    self.channel_count = max(self.unit_ids)
                    self.channel_count_var.set(self.channel_count)
            elif has_channel_count:
                # V4.8：CH Number = N 時固定顯示 CH01~CHNN。
                self.unit_ids = list(range(1, self.channel_count + 1))

            names = cfg.get("unit_names", {})
            if isinstance(names, dict):
                for k, v in names.items():
                    try:
                        uid = int(k)
                        if 1 <= uid <= self.max_unit_id:
                            nm = (str(v) or "").strip() or f"CH{uid:02d}"
                            self.unit_names[uid] = nm
                            self.unit_name_vars[uid].set(nm)
                    except Exception:
                        pass

            addrs = cfg.get("unit_addrs", {})
            if isinstance(addrs, dict):
                for k, vv in addrs.items():
                    try:
                        uid = int(k)
                        if (
                            1 <= uid <= self.max_unit_id
                            and isinstance(vv, dict)
                        ):
                            pv = parse_int_maybe_hex(
                                str(vv.get("PV", "")),
                                self.unit_addrs[uid]["PV"],
                            )
                            sv = parse_int_maybe_hex(
                                str(vv.get("SV", "")),
                                self.unit_addrs[uid]["SV"],
                            )
                            self.unit_addrs[uid] = {
                                "PV": int(pv),
                                "SV": int(sv),
                            }
                            self.unit_pv_vars[uid].set(str(int(pv)))
                            self.unit_sv_vars[uid].set(str(int(sv)))
                    except Exception:
                        pass

            # V4.1 / V4.6 WEB：載入 Web 設定（LAN IP / Port / MAX/MIN 警戒設定）
            web_cfg = cfg.get("web", {})
            if isinstance(web_cfg, dict):
                try:
                    self.web_lan_ip = str(web_cfg.get("lan_ip", "") or "").strip()
                    self.web_lan_ip_var.set(self.web_lan_ip)
                    port_val = int(web_cfg.get("port", self.web_port) or self.web_port)
                    if 1 <= port_val <= 65535:
                        self.web_port = port_val
                    else:
                        self.web_port = 8080
                    self.web_port_var.set(str(self.web_port))
                except Exception:
                    self.web_lan_ip = ""
                    self.web_lan_ip_var.set("")
                    self.web_port = 8080
                    self.web_port_var.set("8080")

                lims = web_cfg.get("alarm_limits", {})
                if isinstance(lims, dict):
                    for k, vv in lims.items():
                        try:
                            uid = int(k)
                            if 1 <= uid <= self.max_unit_id and isinstance(vv, dict):
                                # V5.0H：相容舊版 Config 的 Lo / Hi，也接受新版 lo / hi。
                                lo = self._ec62_limit_float_or_none(vv.get("lo", vv.get("Lo", None)))
                                hi = self._ec62_limit_float_or_none(vv.get("hi", vv.get("Hi", None)))
                                if lo is not None and hi is not None and lo > hi:
                                    lo, hi = hi, lo
                                self.web_alarm_limits[uid] = {"lo": lo, "hi": hi}
                        except Exception:
                            pass
                self.normalize_web_alarm_limits()

                # V4.2 WEB：載入 Email / LINE 通知設定
                notify_cfg = web_cfg.get("notify", {})
                if isinstance(notify_cfg, dict):
                    self.notify_cfg = self.merge_notify_config(notify_cfg)

                # V4.9：載入 Alarm / Recovery 預設紀錄人與解除原因。
                audit_cfg = web_cfg.get("alarm_audit", {})
                if isinstance(audit_cfg, dict):
                    op = str(audit_cfg.get("operator", "") or "").strip() or "System"
                    rsn = str(audit_cfg.get("reason", "") or "").strip() or "Temperature Returned to Normal"
                else:
                    op = str(web_cfg.get("alarm_operator", "") or "").strip() or "System"
                    rsn = str(web_cfg.get("alarm_reason", "") or "").strip() or "Temperature Returned to Normal"
                self.alarm_operator = op
                self.alarm_reason = rsn
                try:
                    self.alarm_operator_var.set(op)
                    self.alarm_reason_var.set(rsn)
                except Exception:
                    pass

                lang_cfg = str(web_cfg.get("language", cfg.get("language", self.language))).lower()
                self.language = "en" if lang_cfg.startswith("en") else "zh"
            else:
                lang_cfg = str(cfg.get("language", self.language)).lower()
                self.language = "en" if lang_cfg.startswith("en") else "zh"

            try:
                self.sync_notify_vars_from_cfg()
            except Exception:
                pass

            for uid in range(1, self.max_unit_id + 1):
                self.unit_enable_vars[uid].set(uid in self.unit_ids)

            self.audit("LOAD_CONFIG", f"path={self.config_path}")

        except Exception as e:
            self.write_error_log(f"load_config error: {e}")

    def save_config(self):
        if not self.is_unlocked:
            messagebox.showwarning("提醒","🔒請先解鎖後再儲存設定")
            return

        self.apply_unit_selection(rebuild_only=True)

        baud = int(self.baud_var.get() or DEFAULT_SERIAL["baudrate"])
        parity = (self.parity_var.get() or DEFAULT_SERIAL["parity"]).upper()
        stop = int(self.stopbits_var.get() or DEFAULT_SERIAL["stopbits"])
        bits = int(self.bytesize_var.get() or DEFAULT_SERIAL["bytesize"])
        tout = parse_float(self.timeout_var.get(), DEFAULT_SERIAL["timeout"])

        if parity not in ("N", "E", "O"):
            parity = DEFAULT_SERIAL["parity"]
        if stop not in (1, 2):
            stop = DEFAULT_SERIAL["stopbits"]
        if bits not in (7, 8):
            bits = DEFAULT_SERIAL["bytesize"]
        if tout <= 0:
            tout = DEFAULT_SERIAL["timeout"]

        self.serial_cfg = {
            "baudrate": baud,
            "parity": parity,
            "stopbits": stop,
            "bytesize": bits,
            "timeout": float(tout),
        }

        # V4.7：儲存 Web LAN IP / Port。LAN IP 可輸入多組，留空表示自動偵測。
        old_web_port = int(getattr(self, "web_port", 8080) or 8080)
        old_web_lan_ip = str(getattr(self, "web_lan_ip", "") or "").strip()
        lan_ip = str(self.web_lan_ip_var.get() or "").strip()
        port = parse_int_maybe_hex(str(self.web_port_var.get() or "8080"), 8080)
        if port < 1 or port > 65535:
            messagebox.showerror("錯誤", "❌ Web Port 請輸入 1~65535，例如 8080")
            return
        self.web_lan_ip = lan_ip
        self.web_port = int(port)
        self.web_port_var.set(str(self.web_port))
        self.web_lan_ip_var.set(self.web_lan_ip)

        clean_report_folder = self.normalize_report_folder(self.report_folder_var.get() or self.trend_report_folder)
        self.report_folder_var.set(clean_report_folder)
        self.trend_report_folder = clean_report_folder

        # V4.3：儲存主設定時同步保存 Email / LINE 設定
        try:
            self.collect_notify_cfg_from_gui()
        except Exception:
            pass

        # V5.0H：儲存前先統一 Web Hi / Low，避免 Lo/Hi 大小寫或舊資料造成遺失。
        self.normalize_web_alarm_limits()

        cfg = {
            "language": self.language,
            "interval": int(self.interval_var.get()),
            "channel_count": int(self.channel_count),
            "unit_ids": self.unit_ids,
            "unit_names": {str(k): v for k, v in self.unit_names.items()},
            "unit_addrs": {
                str(k): {"PV": int(v["PV"]), "SV": int(v["SV"])}
                for k, v in self.unit_addrs.items()
            },
            "password": self.password,
            "serial": dict(self.serial_cfg),
            "trend": {
                # V3.8U：趨勢圖設定存檔
                # 中文說明：
                # 1. selected_channels：保存目前勾選要顯示的 CH。
                # 2. max_points：保存趨勢圖保留筆數。
                # 3. enable：保存自動更新開關。
                # 4. zoom_manual：保存是否使用手動視圖狀態。
                # 5. 只保存顯示設定，不影響 Trend_History、CSV、PDF 或原始資料。
                "update": self.trend_update_var.get(),
                "max_points": int(self.trend_max_points_var.get() or 300),
                "enable": bool(self.trend_enable_var.get()),
                "zoom_manual": bool(getattr(self, "trend_zoom_manual", False)),
                "selected_channels": self.get_selected_trend_channels(),
            },
            "report": {
                "title": self._report_text(self.report_title_var, "SGS Temperature Validation Report"),
                "company_name": self._report_text(self.company_name_var, "CM LAB"),
                "customer_name": self._report_text(self.customer_name_var, "ADVANTECH"),
                "calibration_no": self._report_text(self.calibration_no_var, "CM-2026-001"),
                "start_date": self._report_metadata()["start_date"].replace("/", "-"),
                "start_time": self._report_metadata()["start_time"],
                "end_date": self._report_metadata()["end_date"].replace("/", "-"),
                "end_time": self._report_metadata()["end_time"],
                "folder": clean_report_folder,
                "format": self.report_format_var.get() or "全部",
            },
            "web": {
                "language": self.language,
                "lan_ip": self.web_lan_ip,
                "port": int(self.web_port),
                "alarm_limits": self.web_alarm_limits_for_config(),
                "notify": dict(self.notify_cfg),
                "alarm_audit": {
                    "operator": self._alarm_audit_defaults()[0],
                    "reason": self._alarm_audit_defaults()[1],
                },
            },
        }

        try:
            # V3.8V：寫入設定前先確認共用 CONFIG 資料夾存在。
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(cfg, f, ensure_ascii=False, indent=2)
            self.audit("SAVE_CONFIG", f"path={self.config_path}")
            if old_web_port != int(self.web_port):
                self.restart_web_server()
            else:
                self.update_lan_url_display()
            messagebox.showinfo("完成", "✅ 設定已儲存，系統將自動重新連線")
            self.auto_reconnect_after_fix("設定已儲存")
        except Exception as e:
            self.write_error_log(f"save_config error: {e}")
            messagebox.showerror("錯誤", f"❌ 儲存失敗：{e}")

    # =========================================================
    # 連線與輪詢
    # =========================================================

    def _port_permission_ok(self, port: str) -> bool:
        """先用 pyserial 快速測試 COM 是否可開啟，避免 pymodbus 直接噴 console 錯誤。"""
        baud = int(self.serial_cfg.get("baudrate", DEFAULT_SERIAL["baudrate"]))
        parity = str(self.serial_cfg.get("parity", DEFAULT_SERIAL["parity"])).upper()
        stop = int(self.serial_cfg.get("stopbits", DEFAULT_SERIAL["stopbits"]))
        bits = int(self.serial_cfg.get("bytesize", DEFAULT_SERIAL["bytesize"]))

        try:
            ser = serial.Serial(
                port=port,
                baudrate=baud,
                bytesize=bits,
                parity=parity,
                stopbits=stop,
                timeout=0.15,
                write_timeout=0.15,
            )
            ser.close()
            return True
        except (PermissionError, OSError) as e:
            self._blocked_ports[port] = time.time() + self._port_block_seconds
            self._port_error_cache[port] = str(e)
            self.write_error_log(f"COM busy/permission denied precheck port={port}: {e}")
            return False
        except Exception as e:
            # 其他錯誤也先視為此 COM 不可用，避免一直重試
            self._blocked_ports[port] = time.time() + 15
            self._port_error_cache[port] = str(e)
            self.write_error_log(f"COM precheck failed port={port}: {e}")
            return False

    def _build_client(self, port: str) -> ModbusSerialClient:
        """依 serial_cfg 建立 ModbusSerialClient。"""
        baud = int(self.serial_cfg.get("baudrate", DEFAULT_SERIAL["baudrate"]))
        parity = str(
            self.serial_cfg.get("parity", DEFAULT_SERIAL["parity"])
        ).upper()
        stop = int(self.serial_cfg.get("stopbits", DEFAULT_SERIAL["stopbits"]))
        bits = int(self.serial_cfg.get("bytesize", DEFAULT_SERIAL["bytesize"]))
        tout = float(self.serial_cfg.get("timeout", DEFAULT_SERIAL["timeout"]))

        try:
            return ModbusSerialClient(
                port=port,
                baudrate=baud,
                bytesize=bits,
                parity=parity,
                stopbits=stop,
                timeout=tout,
                retries=0,
            )
        except TypeError:
            return ModbusSerialClient(
                port=port,
                baudrate=baud,
                bytesize=bits,
                parity=parity,
                stopbits=stop,
                timeout=tout,
            )

    # =========================================================
    # V3.9 WEB：內建 Web Server / JSON API
    # =========================================================
    def _auto_lan_ip(self):
        """自動取得目前電腦/樹莓派 LAN IP，失敗則回 127.0.0.1。"""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    def _parse_lan_ips(self, text=None):
        """解析 LAN IP 欄位，可用逗號、分號、空白或換行輸入多組 IP。"""
        try:
            if text is None:
                text = str(getattr(self, "web_lan_ip", "") or "").strip()
                if not text:
                    try:
                        text = str(self.web_lan_ip_var.get() or "").strip()
                    except Exception:
                        text = ""
            raw = str(text or "").replace("，", ",").replace("；", ";")
            for sep in (";", "\n", "\r", "\t", " "):
                raw = raw.replace(sep, ",")
            out = []
            for part in raw.split(","):
                ip = part.strip()
                if not ip:
                    continue
                if ip not in out:
                    out.append(ip)
            return out
        except Exception:
            return []

    def _get_lan_ips(self):
        """取得 Web 顯示用 LAN IP 清單。V4.7：手動多 IP 優先；空白則自動偵測。"""
        ips = self._parse_lan_ips()
        if not ips:
            ips = [self._auto_lan_ip()]
        return ips

    def _get_lan_ip(self):
        """舊函式相容：回傳第一個 LAN IP。"""
        ips = self._get_lan_ips()
        return ips[0] if ips else "127.0.0.1"

    def _get_lan_urls(self):
        """回傳所有可顯示的 LAN URL。"""
        try:
            port = int(self.web_port)
        except Exception:
            port = 8080
        return [f"http://{ip}:{port}/" for ip in self._get_lan_ips()]

    def update_lan_url_display(self):
        """更新 GUI 上方 LAN URL 顯示。可同時顯示多個 LAN 網址。"""
        try:
            urls = self._get_lan_urls()
            self.lan_url_var.set("LAN：" + "   |   ".join(urls))
        except Exception:
            pass

    def restart_web_server(self):
        """套用 Web Port 後重新啟動 Web Server。"""
        try:
            self.stop_web_server()
            self.web_server = None
            self.start_web_server()
        except Exception as e:
            self.write_error_log(f"restart web server error: {e}")

    def apply_web_settings(self):
        """立即套用 LAN IP / Web Port。Server 固定監聽 0.0.0.0；Port 變更時重啟。"""
        if not self.is_unlocked:
            messagebox.showwarning("提醒", "🔒請先解鎖後再套用 Web 設定")
            return
        old_port = int(getattr(self, "web_port", 8080) or 8080)
        lan_ip = str(self.web_lan_ip_var.get() or "").strip()
        port = parse_int_maybe_hex(str(self.web_port_var.get() or "8080"), 8080)
        if port < 1 or port > 65535:
            messagebox.showerror("錯誤", "❌ Web Port 請輸入 1~65535，例如 8080")
            return
        self.web_lan_ip = lan_ip
        self.web_port = int(port)
        self.web_port_var.set(str(self.web_port))
        self.web_lan_ip_var.set(self.web_lan_ip)
        if old_port != self.web_port:
            self.restart_web_server()
        else:
            self.update_lan_url_display()
        urls = self._get_lan_urls()
        msg_urls = "\n".join([f"區網{i+1}：{u}" for i, u in enumerate(urls)])
        self.set_status(f"🌐 Web 已套用 0.0.0.0:{self.web_port}", "green")
        messagebox.showinfo(
            "Web Monitor",
            f"本機：http://127.0.0.1:{self.web_port}/\n"
            f"{msg_urls}\n\n"
            "Web Server 已監聽 0.0.0.0。手機需與電腦 / Raspberry Pi 同一 Wi-Fi 或同一網段。"
        )


    # =========================================================
    # V4.2 Email / LINE 警報通知
    # =========================================================
    def default_notify_config(self):
        return {
            "email_enable": False, "smtp_server": "smtp.gmail.com", "smtp_port": 587,
            "smtp_user": "", "smtp_password": "", "smtp_from": "", "smtp_to": "",
            "email_subject": "EC62 Temperature Alarm", "email_tls": True,
            "line_enable": False, "line_mode": "notify", "line_token": "", "line_user_id": "",
            "cooldown_minutes": 30, "recovery_enable": True,
        }

    def merge_notify_config(self, cfg):
        out = self.default_notify_config()
        try:
            if isinstance(cfg, dict):
                out.update(cfg)
            out["email_enable"] = bool(out.get("email_enable"))
            out["line_enable"] = bool(out.get("line_enable"))
            out["email_tls"] = bool(out.get("email_tls", True))
            out["recovery_enable"] = bool(out.get("recovery_enable", True))
            try: out["smtp_port"] = int(out.get("smtp_port") or 587)
            except Exception: out["smtp_port"] = 587
            try: out["cooldown_minutes"] = max(1, int(float(out.get("cooldown_minutes") or 30)))
            except Exception: out["cooldown_minutes"] = 30
            for k in ("smtp_server", "smtp_user", "smtp_password", "smtp_from", "smtp_to", "email_subject", "line_mode", "line_token", "line_user_id"):
                out[k] = str(out.get(k, "") or "").strip()
            if out["line_mode"] not in ("notify", "messaging_broadcast", "messaging_push"):
                out["line_mode"] = "notify"
        except Exception:
            pass
        return out

    def masked_notify_config(self):
        cfg = dict(self.notify_cfg)
        cfg["smtp_password_saved"] = bool(cfg.get("smtp_password"))
        cfg["line_token_saved"] = bool(cfg.get("line_token"))
        cfg["smtp_password"] = ""
        cfg["line_token"] = ""
        return cfg

    def web_save_notify_config(self, data):
        try:
            if not self.is_unlocked:
                return {"ok": False, "message": "請先在主程式輸入密碼解鎖，才能修改 Email / LINE 設定"}
            merged = dict(self.notify_cfg)
            for k, v in (data or {}).items():
                if k in ("smtp_password", "line_token") and str(v or "").strip() == "":
                    continue
                if k in ("alarm_operator", "alarm_reason"):
                    continue
                merged[k] = v
            self.notify_cfg = self.merge_notify_config(merged)
            op = str((data or {}).get("alarm_operator", "") or "").strip()
            rsn = str((data or {}).get("alarm_reason", "") or "").strip()
            if op:
                self.alarm_operator_var.set(op); self.alarm_operator = op
            if rsn:
                self.alarm_reason_var.set(rsn); self.alarm_reason = rsn
            cfg = {}
            if os.path.exists(self.config_path):
                try:
                    with open(self.config_path, "r", encoding="utf-8") as f: cfg = json.load(f) or {}
                except Exception: cfg = {}
            cfg.setdefault("web", {})["notify"] = dict(self.notify_cfg)
            cfg.setdefault("web", {})["alarm_audit"] = {"operator": self._alarm_audit_defaults()[0], "reason": self._alarm_audit_defaults()[1]}
            cfg.setdefault("web", {})["alarm_limits"] = self.web_alarm_limits_for_config()
            os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
            with open(self.config_path, "w", encoding="utf-8") as f: json.dump(cfg, f, ensure_ascii=False, indent=2)
            self.audit("WEB_SAVE_NOTIFY", "Email/LINE notification config saved")
            return {"ok": True, "message": "通知設定已儲存", "notify": self.masked_notify_config()}
        except Exception as e:
            self.write_error_log(f"web_save_notify_config error: {e}")
            return {"ok": False, "message": str(e)}

    def build_alarm_message(self, uid, pv, reason, recovery=False):
        name = self.unit_names.get(uid, f"CH{uid:02d}")
        lim = self.get_web_alarm_limit(uid)
        title = "✅ EC62 Alarm Recovery" if recovery else "🚨 EC62 Alarm"
        pv_text = "--" if pv is None else f"{float(pv):.1f} °C"
        op, default_reason = self._alarm_audit_defaults()
        reason_text = str(reason or default_reason)
        return (f"{title}\nCH{uid:02d} {name}\nPV：{pv_text}\nOperator：{op}\nReason：{reason_text}\n"
                f"LOW：{lim.get('lo')} / HIGH：{lim.get('hi')}\nTime：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    def send_email_message(self, subject, body):
        cfg = self.notify_cfg
        if not cfg.get("email_enable"): return False, "Email 未啟用"
        smtp_to = [x.strip() for x in str(cfg.get("smtp_to", "")).replace(";", ",").split(",") if x.strip()]
        if not smtp_to: return False, "Email 收件人未設定"
        if not cfg.get("smtp_server"): return False, "SMTP Server 未設定"
        msg = EmailMessage()
        msg["Subject"] = subject or cfg.get("email_subject") or "EC62 Alarm"
        msg["From"] = cfg.get("smtp_from") or cfg.get("smtp_user")
        msg["To"] = ", ".join(smtp_to)
        msg.set_content(body)
        try:
            port = int(cfg.get("smtp_port") or 587)
            if port == 465:
                with smtplib.SMTP_SSL(cfg.get("smtp_server"), port, timeout=15, context=ssl.create_default_context()) as server:
                    if cfg.get("smtp_user"): server.login(cfg.get("smtp_user"), cfg.get("smtp_password"))
                    server.send_message(msg)
            else:
                with smtplib.SMTP(cfg.get("smtp_server"), port, timeout=15) as server:
                    server.ehlo()
                    if cfg.get("email_tls", True):
                        server.starttls(context=ssl.create_default_context()); server.ehlo()
                    if cfg.get("smtp_user"): server.login(cfg.get("smtp_user"), cfg.get("smtp_password"))
                    server.send_message(msg)
            return True, "Email 已送出"
        except Exception as e:
            self.write_error_log(f"send_email_message error: {e}")
            return False, f"Email 失敗：{e}"

    def send_line_message(self, body):
        cfg = self.notify_cfg
        if not cfg.get("line_enable"): return False, "LINE 未啟用"
        token = cfg.get("line_token")
        if not token: return False, "LINE Token 未設定"
        mode = cfg.get("line_mode") or "notify"
        try:
            if mode == "notify":
                data = urlparse_lib.urlencode({"message": "\n" + body}).encode("utf-8")
                req = urlrequest.Request("https://notify-api.line.me/api/notify", data=data, headers={"Authorization": "Bearer " + token, "Content-Type": "application/x-www-form-urlencoded"}, method="POST")
            else:
                payload = {"messages": [{"type": "text", "text": body}]}
                url = "https://api.line.me/v2/bot/message/broadcast"
                if mode == "messaging_push":
                    user_id = cfg.get("line_user_id")
                    if not user_id: return False, "LINE User ID 未設定"
                    payload["to"] = user_id; url = "https://api.line.me/v2/bot/message/push"
                data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                req = urlrequest.Request(url, data=data, headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
            with urlrequest.urlopen(req, timeout=15) as resp: resp.read()
            return True, "LINE 已送出"
        except urlerror.HTTPError as e:
            try: detail = e.read().decode("utf-8", "ignore")
            except Exception: detail = str(e)
            self.write_error_log(f"send_line_message HTTP error: {detail}")
            return False, f"LINE 失敗：HTTP {e.code} {detail}"
        except Exception as e:
            self.write_error_log(f"send_line_message error: {e}")
            return False, f"LINE 失敗：{e}"

    def web_test_notify(self, target="all"):
        if not self.is_unlocked:
            return {"ok": False, "message": "請先在主程式輸入密碼解鎖，才能測試 Email / LINE"}
        body = "EC62 Test Notification\nTime：" + datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        results = []
        if target in ("all", "email"):
            ok, msg = self.send_email_message(self.notify_cfg.get("email_subject") or "EC62 Test", body); results.append(msg)
        if target in ("all", "line"):
            ok, msg = self.send_line_message(body); results.append(msg)
        return {"ok": True, "message": " / ".join(results) if results else "未執行測試"}

    def _web_alarm_reason(self, uid, pv):
        try:
            if pv is None: return None
            lim = self.get_web_alarm_limit(uid)
            pvf = float(pv)
            if lim.get("lo") is not None and pvf < float(lim.get("lo")):
                return f"LOW Alarm：{pvf:.1f} < {float(lim.get('lo')):.1f}"
            if lim.get("hi") is not None and pvf > float(lim.get("hi")):
                return f"HIGH Alarm：{pvf:.1f} > {float(lim.get('hi')):.1f}"
        except Exception:
            return None
        return None

    def process_alarm_notification(self, uid, pv, comm_ok=True):
        try:
            reason = None if comm_ok else "Communication Error"
            if reason is None: reason = self._web_alarm_reason(uid, pv)
            alarm_now = bool(reason)
            alarm_before = bool(self.notify_alarm_state.get(uid, False))

            # V4.9B：若人員已手動解除，畫面與通知不再重複顯示同一筆警報；
            # 直到該 CH 回到正常值，才清除解除旗標，允許下一次新 ERR 重新記錄。
            if not alarm_now:
                self.web_alarm_ack[uid] = False
            elif self.web_alarm_ack.get(uid, False):
                self.notify_alarm_state[uid] = True
                return

            now = time.time()
            cooldown = max(60, int(self.notify_cfg.get("cooldown_minutes", 30)) * 60)
            should_send = False; recovery = False
            if alarm_now:
                last = float(self.notify_last_sent.get(uid, 0.0) or 0.0)
                # V4.9A：由正常進入 ERR 時，立即寫入 ERR Event Log；重送通知不重複寫事件。
                # event 固定寫 ERR，reason 另外保存 HIGH / LOW / Communication Error。
                if not alarm_before:
                    self.write_alarm_event_log(uid, "ERR", pv, "System", reason, source="ERR_EVENT")
                if (not alarm_before) or (now - last >= cooldown): should_send = True
            elif alarm_before and self.notify_cfg.get("recovery_enable", True):
                should_send = True; recovery = True
                _op, default_reason = self._alarm_audit_defaults()
                reason = default_reason
                # V4.9：由 ERR 恢復正常時，自動寫入警報解除記錄。
                self.write_alarm_event_log(uid, "Recovery", pv, _op, reason, source="AUTO_RECOVERY")
            self.notify_alarm_state[uid] = alarm_now
            if not should_send: return
            self.notify_last_sent[uid] = now
            body = self.build_alarm_message(uid, pv, reason, recovery=recovery)
            subject = self.notify_cfg.get("email_subject") or "EC62 Alarm"
            if recovery: subject = "RECOVERY - " + subject
            threading.Thread(target=self._send_notify_worker, args=(subject, body), daemon=True).start()
        except Exception as e:
            self.write_error_log(f"process_alarm_notification error uid={uid}: {e}")

    def _send_notify_worker(self, subject, body):
        try:
            if self.notify_cfg.get("email_enable"):
                ok, msg = self.send_email_message(subject, body); self.audit("EMAIL_NOTIFY", msg)
            if self.notify_cfg.get("line_enable"):
                ok, msg = self.send_line_message(body); self.audit("LINE_NOTIFY", msg)
        except Exception as e:
            self.write_error_log(f"send notify worker error: {e}")

    def enable_demo_mode(self):
        """載入 API / Dashboard 示範資料，不使用實體 COM 裝置。"""
        self.demo_mode = True
        self.channel_count = 6
        self.channel_count_var.set(self.channel_count)
        self.unit_ids = list(range(1, self.channel_count + 1))
        self.com_var.set("DEMO-SIMULATOR")
        self.status_var.set("DEMO MODE - Simulated Data")
        self.interval_var.set(3)
        self.web_title = "E62 / C62 Web V5.2 Demo Dashboard"
        self._demo_started_at = time.time()
        setpoints = [5.0, 25.0, 37.0, 60.0, 18.0, -5.0]
        bases = [5.3, 24.8, 37.4, 63.2, 17.7, -4.8]
        now = datetime.now()
        with self.web_lock, self._trend_lock:
            for uid, base in enumerate(bases, start=1):
                self.unit_names[uid] = f"Demo Zone {uid:02d}"
                self.unit_name_vars[uid].set(self.unit_names[uid])
                self.web_alarm_limits[uid] = {"lo": base - 4.0, "hi": base + 4.0}
                history = []
                for index in range(120):
                    stamp = now - timedelta(seconds=(119 - index) * 3)
                    value = base + math.sin((index + uid * 7) / 9) * 0.65
                    history.append((stamp.strftime("%Y-%m-%d %H:%M:%S"), round(value, 1)))
                self.trend_data[uid] = history
                pv = round(history[-1][1], 1)
                if uid == 4:
                    pv = round(base + 4.8, 1)
                self.web_latest[uid] = {
                    "id": f"{uid:02d}", "name": self.unit_names[uid], "pv": pv,
                    "sv": setpoints[uid - 1], "st": 2 if uid == 4 else 0,
                    "time": now.strftime("%Y-%m-%d %H:%M:%S"),
                }
        self.root.after(3000, self.update_demo_data)

    def update_demo_data(self):
        """持續更新示範數值，使 API 與趨勢圖呈現即時資料。"""
        if self.closing or not getattr(self, "demo_mode", False):
            return
        elapsed = time.time() - self._demo_started_at
        now = datetime.now()
        with self.web_lock, self._trend_lock:
            for uid in self.unit_ids:
                item = self.web_latest[uid]
                base = float(item["sv"])
                pv = base + math.sin(elapsed / 12 + uid * 1.4) * (0.7 + uid * 0.05)
                if uid == 4:
                    pv = base + 4.8 + math.sin(elapsed / 8) * 0.3
                pv = round(pv, 1)
                item.update({"pv": pv, "st": 2 if uid == 4 else 0, "time": now.strftime("%Y-%m-%d %H:%M:%S")})
                self.trend_data[uid].append((item["time"], pv))
                self.trend_data[uid] = self.trend_data[uid][-120:]
                if uid in self.pv_vars:
                    self.pv_vars[uid].set(f"{pv:.1f}")
                if uid in self.sv_vars:
                    self.sv_vars[uid].set(f"{float(item['sv']):.1f}")
        self.root.after(3000, self.update_demo_data)

    def get_web_snapshot(self):
        """回傳 Web 頁面與 API 使用的即時資料快照。"""
        try:
            with self.web_lock:
                channels = []
                for uid in list(self.unit_ids):
                    item = dict(self.web_latest.get(uid, {}))
                    item["name"] = self.unit_names.get(uid, f"CH{uid:02d}")

                    # V4.0 Mobile/Desktop：提供最近趨勢資料給手機網頁小圖使用
                    hist = []
                    try:
                        with self._trend_lock:
                            raw_hist = list(self.trend_data.get(uid, []))[-120:]
                        for t, v in raw_hist:
                            try:
                                hist.append({"time": str(t), "value": float(v)})
                            except Exception:
                                pass
                    except Exception:
                        hist = []

                    item["history"] = hist

                    # V4.1 WEB：MAX/MIN 依 GUI 的 MAX/MIN 歸零起點重新計算，
                    # 與趨勢視窗邏輯一致；若還沒有歷史資料，至少用目前 PV 顯示。
                    try:
                        with self._trend_lock:
                            all_rows = list(self.trend_data.get(uid, []))
                        st = self._calc_trend_stats(all_rows, uid) if all_rows else None
                    except Exception:
                        st = None
                    if st:
                        item["min"] = round(float(st["min"]), 1)
                        item["max"] = round(float(st["max"]), 1)
                        item["avg"] = round(float(st["avg"]), 1)
                        item["count"] = int(st["count"])
                    else:
                        try:
                            pv_now = item.get("pv", None)
                            item["min"] = round(float(pv_now), 1) if pv_now is not None else None
                            item["max"] = round(float(pv_now), 1) if pv_now is not None else None
                            item["avg"] = round(float(pv_now), 1) if pv_now is not None else None
                            item["count"] = 1 if pv_now is not None else 0
                        except Exception:
                            item["min"] = item["max"] = item["avg"] = None
                            item["count"] = 0

                    lim = dict(self.get_web_alarm_limit(uid))
                    item["web_lo"] = lim.get("lo")
                    item["web_hi"] = lim.get("hi")
                    item["web_alarm"] = False
                    try:
                        pv_now = item.get("pv", None)
                        if pv_now is not None:
                            pv_float = float(pv_now)
                            if lim.get("lo") is not None and pv_float < float(lim.get("lo")):
                                item["web_alarm"] = True
                            if lim.get("hi") is not None and pv_float > float(lim.get("hi")):
                                item["web_alarm"] = True
                    except Exception:
                        item["web_alarm"] = False
                    item["web_alarm_ack"] = bool(self.web_alarm_ack.get(uid, False))
                    if item.get("web_alarm") and item.get("web_alarm_ack"):
                        # 已解除的目前警報不再顯示在 Web 畫面。
                        item["web_alarm"] = False
                    if item.get("web_alarm"):
                        item["st"] = 2
                    channels.append(item)
            return {
                "title": self.web_title,
                "language": self.language,
                "version": "V5.0H-CH30-HiLowSave",
                "demo_mode": bool(getattr(self, "demo_mode", False)),
                "status": self.status_var.get(),
                "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "interval": int(self.interval_var.get() or 60),
                "channel_count": int(self.channel_count),
                "max_channel": int(self.max_unit_id),
                "com": self.com_var.get(),
                # V4.3B：Web 頁面 LAN / Local 網址也納入密碼保護。
                # 未解鎖時 API 不回傳網址，前端也會把 LAN 欄位隱藏。
                "lan_url": self._get_lan_urls()[0] if self.is_unlocked else None,
                "lan_urls": self._get_lan_urls() if self.is_unlocked else [],
                "local_url": f"http://127.0.0.1:{self.web_port}/" if self.is_unlocked else None,
                "channels": channels,
                "notify": self.masked_notify_config() if self.is_unlocked else None,
                "alarm_audit": {"operator": self._alarm_audit_defaults()[0], "reason": self._alarm_audit_defaults()[1]} if self.is_unlocked else None,
                "settings_unlocked": bool(self.is_unlocked),
            }
        except Exception as e:
            self.write_error_log(f"get_web_snapshot error: {e}")
            return {"title": "EC62 RTU Web Monitor", "status": "ERROR", "channels": []}

    def web_alarm_history(self, limit=200):
        try:
            return {"ok": True, "rows": self.read_alarm_event_history(limit)}
        except Exception as e:
            self.write_error_log(f"web_alarm_history error: {e}")
            return {"ok": False, "message": str(e), "rows": []}

    def web_manual_recovery(self, data):
        """V4.9：Web 警報解除記錄鍵。Operator / Reason 由設定預填，也可由 Web 修改後送出。"""
        try:
            if not self.is_unlocked:
                return {"ok": False, "message": "請先在主程式輸入密碼解鎖，才能寫入警報解除記錄"}
            uid = int(str((data or {}).get("uid", "1")).strip())
            if uid < 1 or uid > self.max_unit_id:
                raise ValueError("CH 超出範圍")
            op_default, reason_default = self._alarm_audit_defaults()
            op = str((data or {}).get("operator", "") or "").strip() or op_default
            reason = str((data or {}).get("reason", "") or "").strip() or reason_default
            pv = None
            try:
                with self.web_lock:
                    pv = self.web_latest.get(uid, {}).get("pv", None)
            except Exception:
                pv = None
            row = self.write_alarm_event_log(uid, "Recovery", pv, op, reason, source="WEB_BUTTON")
            # V4.9B：解除後從 Web 目前警報畫面移除；完整紀錄保存在 YYYYMMDD_ERROR.txt。
            self.web_alarm_ack[uid] = True
            self.notify_alarm_state[uid] = True
            return {"ok": True, "message": "警報解除記錄已寫入，畫面已移除；已保存到 YYYYMMDD_ERROR.txt", "row": row}
        except Exception as e:
            self.write_error_log(f"web_manual_recovery error: {e}")
            return {"ok": False, "message": str(e)}

    def web_clear_minmax(self, uid=None):
        """V4.1 WEB：從 Web 端清除指定 CH 或全部 CH 的 MAX/MIN 統計。"""
        try:
            targets = []
            if uid in (None, 0, "", "all"):
                targets = list(range(1, self.max_unit_id + 1))
            else:
                n = int(uid)
                if 1 <= n <= self.max_unit_id:
                    targets = [n]
            with self._trend_lock:
                for n in targets:
                    rows = self.trend_data.get(n, [])
                    self.trend_minmax_reset_index[n] = max(0, len(rows) - 1) if rows else 0
            try:
                self.safe_gui(self._draw_trend_plot)
            except Exception:
                pass
            self.audit("WEB_CLEAR_MAX_MIN", "uid=" + ("ALL" if uid in (None, 0, "", "all") else str(uid)))
            return {"ok": True, "message": "MAX/MIN 已清除", "uid": uid or "all"}
        except Exception as e:
            self.write_error_log(f"web_clear_minmax error: {e}")
            return {"ok": False, "message": str(e)}

    def web_set_alarm_limits(self, uid, lo=None, hi=None):
        """V4.1A WEB：設定指定 CH 的 Web 警戒上下限，並立即反映到 API / 畫面。"""
        try:
            n = int(str(uid).strip())
            if n < 1 or n > self.max_unit_id:
                raise ValueError("CH 超出範圍")

            def _to_limit(v):
                if v is None:
                    return None
                t = str(v).strip()
                if t == "" or t.lower() in ("none", "null", "--", "nan"):
                    return None
                return float(t)

            lo_val = _to_limit(lo)
            hi_val = _to_limit(hi)
            if lo_val is not None and hi_val is not None and lo_val > hi_val:
                lo_val, hi_val = hi_val, lo_val

            # 立即更新記憶體；get_web_snapshot() 會直接讀取這裡。
            with self.web_lock:
                self.web_alarm_limits[n] = {"lo": lo_val, "hi": hi_val}

            # 立即寫入 config，不需要 GUI 解鎖。
            try:
                cfg = {}
                if os.path.exists(self.config_path):
                    with open(self.config_path, "r", encoding="utf-8") as f:
                        cfg = json.load(f) or {}
                cfg.setdefault("web", {})["alarm_limits"] = self.web_alarm_limits_for_config()
                os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
                with open(self.config_path, "w", encoding="utf-8") as f:
                    json.dump(cfg, f, ensure_ascii=False, indent=2)
            except Exception as e:
                self.write_error_log(f"web save limits config error: {e}")

            self.audit("WEB_SET_LIMITS", f"uid={n} lo={lo_val} hi={hi_val}")
            try:
                self.safe_gui(self.set_status, f"🌐 Web CH{n:02d} LOW/HIGH 已更新", "green")
            except Exception:
                pass

            snap = self.get_web_snapshot()
            ch = None
            for item in snap.get("channels", []):
                if str(item.get("id")).lstrip("0") == str(n):
                    ch = item
                    break
            return {"ok": True, "message": "Web 設定已更新", "uid": n, "lo": lo_val, "hi": hi_val, "channel": ch}
        except Exception as e:
            self.write_error_log(f"web_set_alarm_limits error: {e}")
            return {"ok": False, "message": str(e)}

    def _web_html(self):
        """V4.1：手機 / 電腦共用 Web 首頁，瀏覽器每 3 秒自動更新。"""
        return """<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0f14">
<link rel="manifest" href="/manifest.json">
<title>EC62 Web V5.0H Alarm History</title>
<style>
:root{--bg:#0b0f14;--panel:#111827;--panel2:#1f2937;--line:#334155;--txt:#e5e7eb;--muted:#94a3b8;--blue:#38bdf8;--green:#22c55e;--red:#ef4444;--yellow:#facc15;--orange:#fb923c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font-family:Arial,'Microsoft JhengHei','Noto Sans TC',sans-serif;-webkit-text-size-adjust:100%}
header{position:sticky;top:0;z-index:5;background:linear-gradient(180deg,#111827,#0f172a);padding:12px 14px;border-bottom:1px solid var(--line);box-shadow:0 6px 18px #0008}
h1{margin:0;color:var(--blue);font-size:22px;line-height:1.2}.sub{color:var(--yellow);font-weight:800;font-size:14px;margin-top:6px}.top{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}.pill{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:6px 10px;color:#cbd5e1;font-size:13px}a{color:var(--blue);text-decoration:none}
.tabbar{display:flex;gap:6px;overflow-x:auto;margin-top:12px;padding-bottom:2px}.tabbtn{flex:0 0 auto;background:#1f2937;border:1px solid #334155;border-radius:7px;color:#cbd5e1;padding:8px 12px;font-weight:800;font-size:13px;cursor:pointer}.tabbtn[aria-selected="true"]{background:#0e7490;border-color:#38bdf8;color:#fff}.tabbtn:focus-visible{outline:2px solid #facc15;outline-offset:2px}
.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px 14px 0}.sum{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px;text-align:center}.sum b{display:block;font-size:20px;color:var(--blue)}.sum span{font-size:12px;color:var(--muted);font-weight:700}
.notify{margin:12px 14px 0;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px}.notify h2{margin:0 0 8px;color:var(--blue);font-size:18px}.notify-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.notify label{font-size:12px;color:var(--yellow);font-weight:900}.notify input,.notify select{width:100%;margin-top:3px;background:#0b1220;color:white;border:1px solid #263244;border-radius:9px;padding:8px}.notify .check{display:flex;align-items:center;gap:6px;color:#e5e7eb}.notify .check input{width:auto}.notify-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.note{color:var(--muted);font-size:12px;margin-top:7px;line-height:1.5}
.wrap{padding:12px 14px 92px;display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px;box-shadow:0 4px 16px #0007}.card.ok{border-color:#14532d}.card.bad{border-color:#7f1d1d;background:linear-gradient(180deg,#111827,#1f1111)}.card.warn{border-color:#9a3412;background:linear-gradient(180deg,#111827,#23160b)}
.name{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:17px;color:#93c5fd;font-weight:900}.badge{border-radius:999px;padding:4px 8px;font-size:12px;font-weight:900;background:#064e3b;color:#86efac}.bad .badge{background:#7f1d1d;color:#fecaca}.warn .badge{background:#9a3412;color:#fed7aa}.pv{font-size:44px;color:var(--green);font-weight:900;margin:10px 0 4px;letter-spacing:-1px}.bad .pv{color:var(--red)}.warn .pv{color:var(--orange)}.unit{font-size:22px;color:#cbd5e1}.sv{font-size:18px;color:var(--yellow);font-weight:900}.meta{color:var(--muted);font-size:13px;margin-top:8px;line-height:1.6}.mini{height:58px;width:100%;margin-top:10px;background:#0b1220;border-radius:10px;border:1px solid #263244}.minmax{display:flex;gap:8px;margin-top:8px}.minmax div{flex:1;background:#0b1220;border:1px solid #263244;border-radius:10px;padding:7px;text-align:center;color:#cbd5e1;font-size:12px}.minmax b{display:block;color:#fff;font-size:16px;margin-top:2px}.tools{display:flex;gap:8px;margin-top:10px}.smallbtn{flex:1;background:#334155;color:#fff;border:0;border-radius:10px;padding:8px 6px;font-weight:900}.smallbtn.orange{background:#ea580c}.limit{font-size:12px;color:#cbd5e1;margin-top:8px;background:#0b1220;border:1px solid #263244;border-radius:10px;padding:7px}
.history{margin:12px 14px 0;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px}.history h2{margin:0 0 8px;color:var(--blue);font-size:18px}.histtable{width:100%;border-collapse:collapse;font-size:12px}.histtable th,.histtable td{border-bottom:1px solid #263244;padding:6px;text-align:left}.histtable th{color:var(--yellow)}
footer{position:fixed;left:0;right:0;bottom:0;background:#111827;border-top:1px solid var(--line);padding:8px 12px;display:flex;flex-direction:column;gap:7px}.footrow{display:flex;gap:8px;justify-content:space-around}.btn{background:#0e7490;color:white;border:0;border-radius:12px;padding:10px 12px;font-weight:900;min-width:92px}.btn.orange{background:#ea580c}.btn.red{background:#dc2626}.btn.green{background:#16a34a}.btn:active,.smallbtn:active{transform:scale(.98)}.alarmbar{display:none;margin-top:10px;background:#7f1d1d;color:#fff;border:1px solid #ef4444;border-radius:12px;padding:9px 10px;font-weight:900;animation:pulse 1s infinite}.alarmbar.show{display:block}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
@media(max-width:700px){h1{font-size:19px}.summary{grid-template-columns:repeat(2,1fr)}.notify-grid{grid-template-columns:1fr}.wrap{grid-template-columns:1fr;padding-left:10px;padding-right:10px}.pv{font-size:52px}.card{padding:16px}.top .pill{font-size:12px}.hide-mobile{display:none}.btn{min-width:auto;flex:1}.footrow{display:flex}}
@media(min-width:1200px){.wrap{grid-template-columns:repeat(4,1fr)}h1{font-size:26px}}
</style>
</head>
<body>
<header>
  <h1 id="title">EC62 Web V4.9 CH30 Alarm Audit</h1>
  <div class="sub" id="status">Loading...</div>
  <div class="top">
    <div class="pill" id="lan" style="display:none">LAN：--</div>
    <div class="pill" id="soundState">🔇 聲音未開啟</div>
    <div class="pill hide-mobile">API：<a href="/api/data">/api/data</a></div>
    <button class="smallbtn" style="max-width:170px" onclick="toggleWebLanguage()" id="langBtn">🌐 中文 / English</button>
  </div>
  <div class="alarmbar" id="alarmbar">🚨 警報發生</div>
    <nav class="tabbar" aria-label="功能目錄">
        <button class="tabbtn" id="tabDashboard" onclick="switchWebTab('dashboard')" aria-selected="true">即時監控</button>
        <button class="tabbtn" id="tabAlarms" onclick="switchWebTab('alarms')" aria-selected="false">警報紀錄</button>
        <button class="tabbtn" id="tabNotify" onclick="switchWebTab('notify')" aria-selected="false">通知設定</button>
        <button class="tabbtn" id="tabSettings" onclick="switchWebTab('settings')" aria-selected="false">帳號權限</button>
    </nav>
</header>
<section class="notify" id="notifyLocked" data-web-tab="notify"><h2>🔒 Email / LINE 設定已隱藏</h2><div class="note">請先在主程式輸入密碼解鎖，才會顯示 Email / LINE 設定欄位。</div></section>
<section class="summary" data-web-tab="dashboard">
  <div class="sum"><b id="okn">0</b><span>OK</span></div>
  <div class="sum"><b id="errn">0</b><span>ERR</span></div>
  <div class="sum"><b id="chn">0</b><span>Channels</span></div>
  <div class="sum"><b id="avg">--</b><span>AVG °C</span></div>
</section>
<section class="notify" id="notifySection" data-web-tab="notify" style="display:none">
  <h2>📧 Email / 💬 LINE 警報通知（已解鎖）</h2>
  <div class="notify-grid">
    <label class="check"><input type="checkbox" id="email_enable">Email 啟用</label>
    <label>SMTP Server<input id="smtp_server" placeholder="smtp.gmail.com"></label>
    <label>Port<input id="smtp_port" placeholder="587"></label>
    <label>寄件帳號<input id="smtp_user" placeholder="example@gmail.com"></label>
    <label>SMTP 密碼<input id="smtp_password" type="password" placeholder="空白=保留原密碼"></label>
    <label>寄件人<input id="smtp_from" placeholder="可同帳號"></label>
    <label>收件人<input id="smtp_to" placeholder="a@x.com,b@x.com"></label>
    <label>主旨<input id="email_subject" placeholder="EC62 Temperature Alarm"></label>
    <label class="check"><input type="checkbox" id="line_enable">LINE 啟用</label>
    <label>LINE 模式<select id="line_mode"><option value="notify">LINE Notify</option><option value="messaging_broadcast">Messaging Broadcast</option><option value="messaging_push">Messaging Push</option></select></label>
    <label>LINE Token<input id="line_token" type="password" placeholder="空白=保留原 Token"></label>
    <label>User ID<input id="line_user_id" placeholder="Push 模式才需要"></label>
    <label>重送間隔(分)<input id="cooldown_minutes" placeholder="30"></label>
    <label class="check"><input type="checkbox" id="recovery_enable">恢復正常通知</label>
    <label>Operator / 紀錄人<input id="alarm_operator" placeholder="System"></label>
    <label>Reason / 解除原因<input id="alarm_reason" placeholder="Temperature Returned to Normal"></label>
  </div>
  <div class="notify-actions">
    <button class="smallbtn" style="flex:1 1 100%" onclick="saveNotify()">儲存通知設定 / Save Notify Config</button>
    <button class="smallbtn" style="flex:1 1 45%" onclick="testNotify('email')">📧 Test Email / 測試 Email</button>
    <button class="smallbtn" style="flex:1 1 45%" onclick="testNotify('line')">💬 Test LINE / 測試 LINE</button>
  </div>
  <div class="note">Gmail 請使用 App Password。密碼 / Token 空白儲存時會保留原值。此設定區只有主程式密碼解鎖後才會顯示。</div>
</section>
<section class="history" id="alarmHistory" data-web-tab="alarms" style="display:none">
  <h2>📋 Active Alarm / 目前未解除警報</h2>
  <div class="notify-actions"><button class="smallbtn" onclick="loadAlarmHistory()">重新整理 / Refresh</button></div>
  <div id="histRows" class="note">No Active Alarm</div>
</section>
<div class="wrap" id="cards" data-web-tab="dashboard"></div>
<footer>
  <div class="footrow">
    <button class="btn green" onclick="enableSound()" id="soundBtn">開啟聲音</button>
    <button class="btn red" onclick="toggleMute()" id="muteBtn">靜音</button>
    <button class="btn orange" onclick="clearMinMax('all')">清除MAX/MIN</button>
  </div>
  <div class="footrow">
    <button class="btn" onclick="testSound()">🔊 Test Sound / 測試聲音</button>
    <button class="btn" onclick="testNotify('all')">📧 Test Notification / 測試通知</button>
  </div>
</footer>
<script>
let webLang='zh';
const TXT_EN={
  '聲音未開啟':'Sound Off','聲音已靜音':'Muted','聲音已開啟':'Sound On','開啟聲音':'Enable Sound','取消靜音':'Unmute','靜音':'Mute','測試聲音':'Test Sound','測試通知':'Test Notification','清除MAX/MIN':'Clear MAX/MIN',
  '警報發生':'Alarm','目前無警報':'No Alarm','Email / LINE 設定已隱藏':'Email / LINE Settings Hidden','請先在主程式輸入密碼解鎖，才會顯示 Email / LINE 設定欄位。':'Unlock settings in the main program to show Email / LINE fields.',
  'Email 啟用':'Email Enable','寄件帳號':'SMTP User','SMTP 密碼':'SMTP Password','寄件人':'Sender','收件人':'Recipients','主旨':'Subject','LINE 啟用':'LINE Enable','LINE 模式':'LINE Mode','重送間隔(分)':'Cooldown (min)','恢復正常通知':'Recovery Notice',
  '儲存通知設定':'Save Notify Config','測試 Email':'Test Email','測試 LINE':'Test LINE','清除':'Clear','設定MAX/MIN':'Set MAX/MIN','更新時間':'Update Time','開啟聲音':'Enable Sound','聲音已開啟':'Sound On',
    '帳號權限設定':'Account Permission Setting','儲存帳號權限':'Save Permissions','帳號':'Account','名稱':'Name','密碼':'Password','解除':'Recovery','設定':'Config','刪除':'Delete',
    '即時監控':'Dashboard','警報紀錄':'Alarm History','通知設定':'Notifications','帳號權限':'Account Access'
};
function T(s){return webLang==='en'?(TXT_EN[s]||s):s;}
function switchWebTab(tab){
    const tabs=['dashboard','alarms','notify','settings'];
    if(!tabs.includes(tab)) tab='dashboard';
    document.querySelectorAll('[data-web-tab]').forEach(el=>{el.hidden=el.dataset.webTab!==tab;});
    const permissionSection=document.getElementById('permSection');
    if(permissionSection) permissionSection.hidden=tab!=='settings';
    const buttons={dashboard:'tabDashboard',alarms:'tabAlarms',notify:'tabNotify',settings:'tabSettings'};
    Object.entries(buttons).forEach(([name,id])=>{const button=document.getElementById(id);if(button)button.setAttribute('aria-selected',String(name===tab));});
    localStorage.setItem('ec62_web_tab',tab);
    if(tab==='alarms'&&typeof loadAlarmHistory==='function')loadAlarmHistory();
}
async function toggleWebLanguage(){
  const next=webLang==='en'?'zh':'en';
  try{await api('/api/set_language?lang='+next);}catch(e){}
  webLang=next; localStorage.setItem('ec62_lang', webLang); load();
}
function applyWebStaticLang(){
  const langBtn=document.getElementById('langBtn'); if(langBtn) langBtn.textContent=webLang==='en'?'🌐 English / 中文':'🌐 中文 / English';
  const soundBtn=document.getElementById('soundBtn'); if(soundBtn) soundBtn.textContent=soundEnabled ? T('聲音已開啟') : T('開啟聲音');
  const muteBtn=document.getElementById('muteBtn'); if(muteBtn) muteBtn.textContent=muted ? T('取消靜音') : T('靜音');
    [['tabDashboard','即時監控'],['tabAlarms','警報紀錄'],['tabNotify','通知設定'],['tabSettings','帳號權限']].forEach(([id,label])=>{const button=document.getElementById(id);if(button)button.textContent=T(label);});
}
let audioCtx=null, soundEnabled=localStorage.getItem('ec62_sound_enabled')==='1', muted=localStorage.getItem('ec62_sound_muted')==='1', lastAlarmBeep=0, alarmActive=false;
function updateSoundUI(){
  const state=document.getElementById('soundState'), sbtn=document.getElementById('soundBtn'), mbtn=document.getElementById('muteBtn');
  if(state) state.textContent = soundEnabled ? (muted?'🔕 '+T('聲音已靜音'):'🔊 '+T('聲音已開啟')) : '🔇 '+T('聲音未開啟');
  if(sbtn) sbtn.textContent = soundEnabled ? T('聲音已開啟') : T('開啟聲音');
  if(mbtn) mbtn.textContent = muted ? T('取消靜音') : T('靜音');
}
function ensureAudio(){
  const C=window.AudioContext||window.webkitAudioContext; if(!C)return null;
  if(!audioCtx) audioCtx=new C();
  if(audioCtx.state==='suspended') audioCtx.resume();
  return audioCtx;
}
function beep(times=3){
  if(!soundEnabled||muted)return; const ctx=ensureAudio(); if(!ctx)return;
  for(let i=0;i<times;i++){
    const osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.type='square'; osc.frequency.value=880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime+i*0.32);
    gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime+i*0.32+0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+i*0.32+0.18);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(ctx.currentTime+i*0.32); osc.stop(ctx.currentTime+i*0.32+0.2);
  }
}
function enableSound(){soundEnabled=true; muted=false; localStorage.setItem('ec62_sound_enabled','1'); localStorage.setItem('ec62_sound_muted','0'); ensureAudio(); beep(2); updateSoundUI();}
function toggleMute(){muted=!muted; localStorage.setItem('ec62_sound_muted', muted?'1':'0'); updateSoundUI();}
function testSound(){if(!soundEnabled) enableSound(); else beep(3);}
function handleAlarmSound(ch){
  const hasAlarm=ch.some(c=>c.st===1||c.st===2||c.web_alarm===true);
  const bar=document.getElementById('alarmbar');
  if(bar){
    const names=ch.filter(c=>c.st===1||c.st===2||c.web_alarm===true).map(c=>'CH'+c.id).join('、');
    bar.textContent=hasAlarm?'🚨 '+T('警報發生')+'：'+names:'✅ '+T('目前無警報');
    bar.className='alarmbar'+(hasAlarm?' show':'');
  }
  const now=Date.now();
  if(hasAlarm && (!alarmActive || now-lastAlarmBeep>10000)){beep(4); lastAlarmBeep=now;}
  alarmActive=hasAlarm;
}
function val(x){return x===null||x===undefined||x===''?'--':Number(x).toFixed(1)}
function drawMini(canvas, hist, bad){
  if(!canvas)return; const ctx=canvas.getContext('2d'), w=canvas.width=canvas.clientWidth*devicePixelRatio, h=canvas.height=canvas.clientHeight*devicePixelRatio;
  ctx.clearRect(0,0,w,h); ctx.lineWidth=1*devicePixelRatio; ctx.strokeStyle='#334155';
  for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,h*i/4);ctx.lineTo(w,h*i/4);ctx.stroke()}
  if(!hist||hist.length<2)return;
  const vals=hist.map(p=>Number(p.value)).filter(v=>Number.isFinite(v)); if(vals.length<2)return;
  let mn=Math.min(...vals), mx=Math.max(...vals); if(mx===mn){mx+=1;mn-=1}
  ctx.strokeStyle=bad?'#ef4444':'#22c55e'; ctx.lineWidth=2.4*devicePixelRatio; ctx.beginPath();
  hist.forEach((p,i)=>{let v=Number(p.value); let x=i/(hist.length-1)*w; let y=h-(v-mn)/(mx-mn)*h; if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y)}); ctx.stroke();
}
async function api(url){
  const r=await fetch(url+(url.includes('?')?'&':'?')+'ts='+Date.now(),{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
  const d=await r.json();
  if(!d.ok && url.includes('/api/set_limits')) alert(d.message||'設定失敗');
  return d;
}
async function clearMinMax(uid){
  if(!confirm(uid==='all'?'清除全部 CH 的 MAX/MIN？':'清除 CH'+uid+' 的 MAX/MIN？'))return;
  const d=await api('/api/clear_minmax?uid='+encodeURIComponent(uid));
  await load();
  alert(d.message||'OK');
}
async function setLimit(uid,lo0,hi0){
  let lo=prompt('CH'+uid+' LOW 下限；空白=不設定', lo0===null||lo0===undefined?'':lo0); if(lo===null)return;
  let hi=prompt('CH'+uid+' HIGH 上限；空白=不設定', hi0===null||hi0===undefined?'':hi0); if(hi===null)return;
  const d=await api('/api/set_limits?uid='+encodeURIComponent(uid)+'&lo='+encodeURIComponent(lo)+'&hi='+encodeURIComponent(hi));
  await load();
  alert(d.message||'OK');
}
function setNotifyForm(n){
  if(!n)return;
  ['email_enable','line_enable','recovery_enable'].forEach(k=>{const e=document.getElementById(k); if(e)e.checked=!!n[k];});
  ['smtp_server','smtp_port','smtp_user','smtp_from','smtp_to','email_subject','line_mode','line_user_id','cooldown_minutes'].forEach(k=>{const e=document.getElementById(k); if(e)e.value=n[k]??'';});
}
function setAuditForm(a){
  if(!a)return;
  const op=document.getElementById('alarm_operator'), rs=document.getElementById('alarm_reason');
  if(op)op.value=a.operator||'System';
  if(rs)rs.value=a.reason||'Temperature Returned to Normal';
}
function getNotifyForm(){
  const val=id=>{const e=document.getElementById(id); return e?e.value:''};
  const chk=id=>{const e=document.getElementById(id); return e?e.checked:false};
  return {email_enable:chk('email_enable'),smtp_server:val('smtp_server'),smtp_port:val('smtp_port'),smtp_user:val('smtp_user'),smtp_password:val('smtp_password'),smtp_from:val('smtp_from'),smtp_to:val('smtp_to'),email_subject:val('email_subject'),line_enable:chk('line_enable'),line_mode:val('line_mode'),line_token:val('line_token'),line_user_id:val('line_user_id'),cooldown_minutes:val('cooldown_minutes'),recovery_enable:chk('recovery_enable'),alarm_operator:val('alarm_operator'),alarm_reason:val('alarm_reason')};
}
async function postJson(url,obj){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj||{})});
  return await r.json();
}
async function saveNotify(){
  const d=await postJson('/api/save_notify', getNotifyForm());
  alert(d.message||'OK');
  if(d.notify){document.getElementById('smtp_password').value='';document.getElementById('line_token').value='';setNotifyForm(d.notify);}
}
async function testNotify(target){
  await saveNotify();
  const d=await postJson('/api/test_notify',{target});
  alert(d.message||'OK');
}
async function manualRecovery(uid){
  const op0=(document.getElementById('alarm_operator')||{}).value||'System';
  const rs0=(document.getElementById('alarm_reason')||{}).value||'Temperature Returned to Normal';
  const operator=prompt('Operator / 紀錄人', op0); if(operator===null)return;
  const reason=prompt('Reason / 解除原因', rs0); if(reason===null)return;
  const d=await postJson('/api/manual_recovery',{uid,operator,reason});
  alert(d.message||'OK');
  await loadAlarmHistory(); await load();
}
async function loadAlarmHistory(){
  try{
    const d=await api('/api/alarm_history?limit=100');
    const sec=document.getElementById('alarmHistory'), box=document.getElementById('histRows');
    if(sec)sec.style.display='block';
    const rows=d.rows||[];
    if(!rows.length){if(box)box.innerHTML='No Active Alarm / 目前無未解除警報'; return;}
    if(box)box.innerHTML='<table class="histtable"><thead><tr><th>Time</th><th>CH</th><th>Event</th><th>PV</th><th>Operator</th><th>Reason</th></tr></thead><tbody>'+rows.slice(0,100).map(r=>`<tr><td>${r.time||''}</td><td>${r.channel||''}</td><td>${r.event||''}</td><td>${r.value??'--'}</td><td>${r.operator||''}</td><td>${r.reason||''}</td></tr>`).join('')+'</tbody></table>';
  }catch(e){}
}
async function load(){
  try{
    const d=await api('/api/data');
    webLang = d.language || localStorage.getItem('ec62_lang') || 'zh';
    localStorage.setItem('ec62_lang', webLang);
    applyWebStaticLang(); if(typeof updatePermissionLang==='function')updatePermissionLang();
    const notifySection=document.getElementById('notifySection'), notifyLocked=document.getElementById('notifyLocked');
    if(d.settings_unlocked){ if(notifySection)notifySection.style.display='block'; if(notifyLocked)notifyLocked.style.display='none'; }
    else { if(notifySection)notifySection.style.display='none'; if(notifyLocked)notifyLocked.style.display='block'; window._notifyLoaded=false; }
    if(d.notify && !window._notifyLoaded){setNotifyForm(d.notify); setAuditForm(d.alarm_audit); window._notifyLoaded=true;}
    if(d.settings_unlocked){loadAlarmHistory();}
    document.title=d.title||'EC62 Web V5.0H Alarm History'; document.getElementById('title').textContent=d.title||'EC62 Web V5.0H Alarm History';
    document.getElementById('status').textContent=`${d.status||'--'} | ${d.time||'--'} | COM ${d.com||'--'} | ${d.interval||'--'}s`;
    const lanEl=document.getElementById('lan');
    if(lanEl){
      if(d.settings_unlocked && ((d.lan_urls&&d.lan_urls.length)||d.lan_url)){lanEl.style.display='inline-block'; lanEl.textContent='LAN：'+((d.lan_urls&&d.lan_urls.length)?d.lan_urls.join('   |   '):d.lan_url);}
      else{lanEl.style.display='none'; lanEl.textContent='';}
    }
    const allCh=d.channels||[], ch=allCh.slice(0,50), ok=allCh.filter(c=>c.st===0).length, err=allCh.length-ok;
    const pvs=allCh.map(c=>Number(c.pv)).filter(v=>Number.isFinite(v));
    document.getElementById('okn').textContent=ok; document.getElementById('errn').textContent=err; document.getElementById('chn').textContent=allCh.length; document.getElementById('avg').textContent=pvs.length?(pvs.reduce((a,b)=>a+b,0)/pvs.length).toFixed(1):'--';
    document.getElementById('cards').innerHTML=ch.map((c,i)=>{
      const commBad=c.st===1, warn=c.st===2||c.web_alarm===true, bad=commBad;
      const cls=bad?'bad':(warn?'warn':'ok'); const badge=bad?'ERR':(warn?'ALARM':'OK');
      return `<div class="card ${cls}">
        <div class="name"><span>CH${c.id} ${c.name||''}</span><span class="badge">${badge}</span></div>
        <div class="pv">${val(c.pv)} <span class="unit">°C</span></div>
        <div class="sv">SV：${val(c.sv)} °C</div>
        <canvas class="mini" id="mini${i}"></canvas>
        <div class="minmax"><div>MIN<b>${val(c.min)}</b></div><div>MAX<b>${val(c.max)}</b></div></div>
        <div class="limit">${webLang==='en'?'Web Limits':'Web設定'}：LOW ${val(c.web_lo)} / HIGH ${val(c.web_hi)}</div>
        <div class="tools"><button class="smallbtn orange" onclick="clearMinMax('${c.id}')">${T('清除')}</button><button class="smallbtn" onclick="setLimit('${c.id}',${c.web_lo===null||c.web_lo===undefined?'null':JSON.stringify(c.web_lo)},${c.web_hi===null||c.web_hi===undefined?'null':JSON.stringify(c.web_hi)})">${T('設定MAX/MIN')}</button>${(bad||warn)?`<button class="smallbtn" onclick="manualRecovery('${c.id}')">解除記錄</button>`:''}</div>
        <div class="meta">Slave ID：${c.id}<br>${T('更新時間')}：${c.time||'--'}<br>COUNT：${c.count||0}</div>
      </div>`
    }).join('');
    handleAlarmSound(allCh);
    updateSoundUI();
    ch.forEach((c,i)=>drawMini(document.getElementById('mini'+i),c.history,c.st!==0));
  }catch(e){document.getElementById('status').textContent='Web 讀取失敗：'+e;}
}
switchWebTab(localStorage.getItem('ec62_web_tab')||'dashboard'); updateSoundUI(); load(); setInterval(load,3000); window.addEventListener('resize',()=>setTimeout(load,200));
</script>
</body>
</html>"""

    def _web_manifest(self):
        """手機加入主畫面用 PWA manifest。"""
        return json.dumps({
            "name": "EC62 Web V5.0H Alarm History",
            "short_name": "EC62",
            "start_url": "/",
            "display": "standalone",
            "background_color": "#0b0f14",
            "theme_color": "#0b0f14",
            "description": "EC62 RTU Mobile/Desktop Monitor V4.8 CH30 Bilingual Email LINE"
        }, ensure_ascii=False)

    def start_web_server(self):
        """啟動內建 Web Server。固定監聽 0.0.0.0，支援多個 LAN URL 顯示。"""
        if self.web_server is not None:
            return
        app = self

        class EC62WebHandler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                return

            def _send(self, code, content, ctype="text/html; charset=utf-8"):
                data = content.encode("utf-8") if isinstance(content, str) else content
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                try:
                    parsed = urlparse(self.path)
                    path = parsed.path
                    try:
                        length = int(self.headers.get("Content-Length", "0") or 0)
                        raw = self.rfile.read(length) if length > 0 else b"{}"
                        data = json.loads(raw.decode("utf-8") or "{}")
                    except Exception:
                        data = {}
                    if path == "/api/save_notify":
                        result = app.web_save_notify_config(data)
                        self._send(200, json.dumps(result, ensure_ascii=False), "application/json; charset=utf-8")
                    elif path == "/api/test_notify":
                        result = app.web_test_notify(str(data.get("target", "all")))
                        self._send(200, json.dumps(result, ensure_ascii=False), "application/json; charset=utf-8")
                    elif path == "/api/manual_recovery":
                        result = app.web_manual_recovery(data)
                        self._send(200, json.dumps(result, ensure_ascii=False), "application/json; charset=utf-8")
                    else:
                        self._send(404, "Not Found", "text/plain; charset=utf-8")
                except Exception as e:
                    app.write_error_log(f"web post error: {e}")
                    try:
                        self._send(500, "Web Error", "text/plain; charset=utf-8")
                    except Exception:
                        pass

            def do_GET(self):
                try:
                    parsed = urlparse(self.path)
                    path = parsed.path
                    query = {}
                    try:
                        for part in (parsed.query or "").split("&"):
                            if not part:
                                continue
                            if "=" in part:
                                k, v = part.split("=", 1)
                            else:
                                k, v = part, ""
                            from urllib.parse import unquote_plus
                            query[unquote_plus(k)] = unquote_plus(v)
                    except Exception:
                        query = {}

                    if path in ("/", "/index.html"):
                        self._send(200, app._web_html())
                    elif path == "/api/data":
                        self._send(
                            200,
                            json.dumps(app.get_web_snapshot(), ensure_ascii=False),
                            "application/json; charset=utf-8",
                        )
                    elif path == "/api/clear_minmax":
                        result = app.web_clear_minmax(query.get("uid", "all"))
                        self._send(200, json.dumps(result, ensure_ascii=False), "application/json; charset=utf-8")
                    elif path == "/api/set_limits":
                        result = app.web_set_alarm_limits(query.get("uid", "1"), query.get("lo", ""), query.get("hi", ""))
                        self._send(200, json.dumps(result, ensure_ascii=False), "application/json; charset=utf-8")
                    elif path == "/api/set_language":
                        result = app.web_set_language(query.get("lang", "zh"))
                        self._send(200, json.dumps(result, ensure_ascii=False), "application/json; charset=utf-8")
                    elif path == "/api/alarm_history":
                        result = app.web_alarm_history(query.get("limit", "200"))
                        self._send(200, json.dumps(result, ensure_ascii=False), "application/json; charset=utf-8")
                    elif path == "/manifest.json":
                        self._send(200, app._web_manifest(), "application/manifest+json; charset=utf-8")
                    else:
                        self._send(404, "Not Found", "text/plain; charset=utf-8")
                except Exception as e:
                    app.write_error_log(f"web request error: {e}")
                    try:
                        self._send(500, "Web Error", "text/plain; charset=utf-8")
                    except Exception:
                        pass

        try:
            self.web_server = ThreadingHTTPServer(("0.0.0.0", int(self.web_port)), EC62WebHandler)
            self.web_thread = threading.Thread(target=self.web_server.serve_forever, daemon=True)
            self.web_thread.start()
            urls = self._get_lan_urls()
            self.update_lan_url_display()
            self.set_status(f"🌐 Web 已啟動 0.0.0.0:{self.web_port}", "green")
            self.audit("WEB_START", "0.0.0.0:" + str(self.web_port) + " | " + " | ".join(urls))
        except OSError as e:
            self.web_server = None
            self.write_error_log(f"start web server failed port={self.web_port}: {e}")
            self.set_status(f"⚠️ Web Port {self.web_port} 無法啟動", "orange")
        except Exception as e:
            self.web_server = None
            self.write_error_log(f"start web server error: {e}")

    def stop_web_server(self):
        """停止 Web Server。"""
        try:
            if self.web_server is not None:
                self.web_server.shutdown()
                self.web_server.server_close()
                self.web_server = None
        except Exception as e:
            self.write_error_log(f"stop web server error: {e}")

    def open_web_page(self):
        """開啟本機瀏覽器 Web 監看頁。"""
        try:
            url = f"http://127.0.0.1:{self.web_port}/"
            webbrowser.open(url)
            urls = self._get_lan_urls()
            try:
                self.update_lan_url_display()
            except Exception:
                pass
            msg_urls = "\n".join([f"區網{i+1}：{u}" for i, u in enumerate(urls)])
            messagebox.showinfo("Web Monitor", f"本機：{url}\n{msg_urls}")
        except Exception as e:
            messagebox.showerror("Web Monitor", f"無法開啟 Web：{e}")

    def connect(self):
        if self.closing:
            return

        self._reconnect_after_id = None

        with self._lock:
            self._stop_event.set()
            self.running = False

            if self._poll_thread and self._poll_thread.is_alive():
                try:
                    self._poll_thread.join(timeout=0.5)
                except Exception:
                    pass

            self._stop_event.clear()

            try:
                if self.client:
                    self.client.close()
            except Exception:
                pass

            time.sleep(0.2)

            ports = _usb_port_candidates()
            self.com_cb["values"] = ports

            if not ports:
                self.set_status("❌ 無可用 USB COM 埠", "red")
                self.schedule_reconnect()
                return

            cur = (self.com_var.get() or "").strip()
            if (not cur) or (cur not in ports):
                cur = ports[0]
                self.com_var.set(cur)

            tried = []
            success = False
            usb_opened = []
            rtu_probe_errors = []

            first_uid = self.unit_ids[0] if self.unit_ids else 1
            probe_pv_addr = self.unit_addrs.get(
                first_uid,
                {},
            ).get("PV", PV_ADDR_DEFAULT)

            now_ts = time.time()
            # 清除已過期的 COM 黑名單
            self._blocked_ports = {
                p: until for p, until in self._blocked_ports.items()
                if until > now_ts
            }

            for cand in [cur] + [p for p in ports if p != cur]:
                if self.closing:
                    return

                # COM 被占用/拒絕存取時，30秒內先跳過，避免一直噴錯
                if self._blocked_ports.get(cand, 0) > now_ts:
                    tried.append(f"{cand}(busy)")
                    continue

                tried.append(cand)

                # V3.7C：先測試 COM 權限，可避免 pymodbus/pyserial 在 console 噴錯
                if not self._port_permission_ok(cand):
                    tried[-1] = f"{cand}(busy/denied)"
                    continue

                try:
                    self.client = self._build_client(cand)
                    ok = self.client.connect()
                    if ok:
                        usb_opened.append(cand)
                        self.set_status(f"🔌 USB 已開啟：{cand}，RTU 測試中...", "yellow")
                except (PermissionError, OSError) as e:
                    # Windows 常見：PermissionError(13, '存取被拒')，代表 COM 被其他程式占用
                    self._blocked_ports[cand] = time.time() + self._port_block_seconds
                    self._port_error_cache[cand] = str(e)
                    self.write_error_log(f"COM busy/permission denied port={cand}: {e}")
                    try:
                        if self.client:
                            self.client.close()
                    except Exception:
                        pass
                    self.client = None
                    continue
                except Exception as e:
                    self.write_error_log(f"open port failed port={cand}: {e}")
                    try:
                        if self.client:
                            self.client.close()
                    except Exception:
                        pass
                    self.client = None
                    continue

                if not ok:
                    try:
                        self.client.close()
                    except Exception:
                        pass
                    self.client = None
                    continue

                try:
                    test = self._read_holding(
                        address=probe_pv_addr,
                        count=1,
                        unit_id=first_uid,
                    )
                    if (
                        hasattr(test, "isError")
                        and not test.isError()
                        and getattr(test, "registers", [])
                    ):
                        self.set_status("✅ 已連線", "green")
                        self.com_var.set(cand)
                        self.running = True
                        self._reconnect_backoff_s = 1.5
                        self._poll_thread = threading.Thread(
                            target=self.poll_data,
                            daemon=True,
                        )
                        self._poll_thread.start()
                        success = True
                        break
                except Exception as e:
                    rtu_probe_errors.append(f"{cand}: {e}")
                    self.write_error_log(f"probe failed port={cand}: {e}")

                try:
                    self.client.close()
                except Exception:
                    pass
                self.client = None

            if not success:
                busy_ports = [p for p in ports if self._blocked_ports.get(p, 0) > time.time()]
                if busy_ports:
                    self.set_status(
                        f"⚠️ COM 被占用/存取被拒：{', '.join(busy_ports)}，請關閉其他程式或換 COM，再按重新連線",
                        "orange",
                    )
                elif usb_opened:
                    # USB/COM 可以正常開啟，但 Modbus 設備沒有正確回覆。
                    # 此時重點檢查 Baud/Parity/Stop/Bits、Slave ID、PV Register、A/B 線。
                    self.set_status(
                        f"⚠️ USB 已開啟但 RTU 無回應：{usb_opened[0]} | 請檢查 19200-E-8-1 / ID / A-B / PV位址",
                        "orange",
                    )
                else:
                    self.set_status(f"❌ USB/COM 連線失敗（嘗試：{', '.join(tried)}）", "red")

                self.write_error_log(
                    f"連線失敗：{tried} | usb_opened={usb_opened} | probe_errors={rtu_probe_errors} | blocked={self._blocked_ports} | serial={self.serial_cfg}"
                )
                self.schedule_reconnect()

    def poll_data(self):
        while (
            (not self._stop_event.is_set())
            and self.running
            and (not self.closing)
        ):
            start_ts = time.time()
            now_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

            pv_line = []
            sv_line = []

            for uid in list(self.unit_ids):
                if self._stop_event.is_set() or self.closing:
                    break

                pv_addr = self.unit_addrs.get(uid, {}).get(
                    "PV",
                    PV_ADDR_DEFAULT,
                )
                sv_addr = self.unit_addrs.get(uid, {}).get(
                    "SV",
                    SV_ADDR_DEFAULT,
                )

                pv_ok = False
                pv_val = None

                try:
                    rr = self._read_holding(
                        address=pv_addr,
                        count=1,
                        unit_id=uid,
                    )
                    if (
                        hasattr(rr, "isError")
                        and not rr.isError()
                        and getattr(rr, "registers", [])
                    ):
                        pv_val = float(self.decode_e62_temp(rr.registers[0]))
                        pv_ok = True
                except Exception as e:
                    if "Errno 5" in str(e) or "I/O error" in str(e):
                        self.write_error_log(
                            f"Errno 5 I/O error -> reconnect: {e}"
                        )
                        self.safe_gui(
                            self.set_status,
                            "⚠️ I/O error（將自動重連）",
                            "red",
                        )
                        self.running = False
                        self._stop_event.set()
                        self.schedule_reconnect()
                        return
                    self.write_error_log(
                        f"PV read fail uid={uid} addr={pv_addr}: {e}"
                    )

                pv_line.append(
                    {
                        "id": f"{uid:02d}",
                        "time": now_utc,
                        "value": pv_val if pv_ok else None,
                        "st": 0 if pv_ok else 1,
                    }
                )

                # V3.7 Trend：PV 成功讀取時加入即時趨勢資料
                if pv_ok:
                    self.add_trend_point(
                        uid,
                        pv_val,
                        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    )

                if uid in self.pv_vars:
                    self.safe_gui(
                        self.pv_vars[uid].set,
                        "--" if pv_val is None else f"{pv_val:.1f}",
                    )

                sv_ok = False
                sv_val = None

                try:
                    rr2 = self._read_holding(
                        address=sv_addr,
                        count=1,
                        unit_id=uid,
                    )
                    if (
                        hasattr(rr2, "isError")
                        and not rr2.isError()
                        and getattr(rr2, "registers", [])
                    ):
                        sv_val = float(self.decode_e62_temp(rr2.registers[0]))
                        sv_ok = True
                except Exception as e:
                    if "Errno 5" in str(e) or "I/O error" in str(e):
                        self.write_error_log(
                            f"Errno 5 I/O error -> reconnect: {e}"
                        )
                        self.safe_gui(
                            self.set_status,
                            "⚠️ I/O error（將自動重連）",
                            "red",
                        )
                        self.running = False
                        self._stop_event.set()
                        self.schedule_reconnect()
                        return
                    self.write_error_log(
                        f"SV read fail uid={uid} addr={sv_addr}: {e}"
                    )

                # V3.9 WEB：更新 Web 即時資料快照
                try:
                    with self.web_lock:
                        self.web_latest[uid] = {
                            "id": f"{uid:02d}",
                            "name": self.unit_names.get(uid, f"CH{uid:02d}"),
                            "pv": pv_val if pv_ok else None,
                            "sv": sv_val if sv_ok else None,
                            "st": 0 if pv_ok else 1,
                            "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        }
                except Exception as e:
                    self.write_error_log(f"web latest update error uid={uid}: {e}")

                # V4.2：依 Web LOW/HIGH 警戒設定觸發 Email / LINE 通知
                try:
                    self.process_alarm_notification(uid, pv_val if pv_ok else None, comm_ok=bool(pv_ok))
                except Exception as e:
                    self.write_error_log(f"notify process error uid={uid}: {e}")

                if uid in self.sv_vars:
                    self.safe_gui(
                        self.sv_vars[uid].set,
                        "--" if sv_val is None else f"{sv_val:.1f}",
                    )

                if sv_ok:
                    sv_line.append(
                        {
                            "id": f"{uid:02d}",
                            "time": now_utc,
                            "value": sv_val,
                        }
                    )

            if pv_line:
                self.append_pv_log(pv_line)
            if sv_line:
                self.append_sv_log(sv_line)

            try:
                interval = max(1, int(self.interval_var.get() or 60))
            except Exception:
                interval = 60

            spent = time.time() - start_ts
            remain = interval - spent

            if remain > 0:
                end_wait = time.time() + remain
                while (
                    time.time() < end_wait
                    and not self._stop_event.is_set()
                    and not self.closing
                ):
                    time.sleep(min(0.2, end_wait - time.time()))

    def append_pv_log(self, arr):
        try:
            fname = datetime.now().strftime("%Y-%m-%d_Log.txt")
            log_path = os.path.join(self.log_folder, fname)
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(arr, ensure_ascii=False) + "\n")
        except Exception as e:
            self.write_error_log(f"append_pv_log error: {e}")

    def append_sv_log(self, arr):
        try:
            fname = datetime.now().strftime("%Y-%m-%d_SV_Log.txt")
            sv_log_path = os.path.join(self.sv_log_folder, fname)
            with open(sv_log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(arr, ensure_ascii=False) + "\n")
        except Exception as e:
            self.write_error_log(f"append_sv_log error: {e}")

    # =========================================================
    # 熱插拔監控
    # =========================================================
    def monitor_ports(self):
        last_set = set()

        while not self.closing:
            try:
                ports = _usb_port_candidates()
                now_set = set(ports)

                if now_set != last_set:
                    last_set = now_set
                    self.safe_gui(self.com_cb.configure, values=ports)

                cur = (self.com_var.get() or "").strip()
                if self.running and cur and (cur not in now_set):
                    self.write_error_log(
                        f"Port disappeared: {cur} -> reconnect"
                    )
                    self.safe_gui(self.set_status, "⚠️ COM 已拔除（將自動重連）", "red")
                    self.safe_gui(self.connect)

            except Exception as e:
                self.write_error_log(f"monitor_ports error: {e}")

            time.sleep(2.0)

    # =========================================================
    # 開啟資料夾 / 報表檔
    # =========================================================
    def _open_path_by_system(self, path):
        """依作業系統開啟檔案或資料夾。"""
        try:
            if not path:
                return False
            sysname = platform.system().lower()
            if sysname == "windows":
                os.startfile(path)  # type: ignore[attr-defined]
            elif sysname == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
            return True
        except Exception as e:
            messagebox.showerror("錯誤", f"無法開啟：{e}")
            return False

    def _latest_report_file(self, patterns):
        """在今日報表資料夾尋找最新檔案。"""
        try:
            folder = self._trend_report_dir()
            files = []
            for pat in patterns:
                files.extend(glob.glob(os.path.join(folder, pat)))
            files = [f for f in files if os.path.isfile(f)]
            if not files:
                return None
            return max(files, key=os.path.getmtime)
        except Exception as e:
            self.write_error_log(f"latest report file error: {e}")
            return None

    def open_today_report_folder(self):
        """開啟今日報表資料夾。"""
        try:
            folder = self._trend_report_dir()
            self._open_path_by_system(folder)
            self.set_status(f"📂 已開啟今日資料夾：{folder}", "blue")
        except Exception as e:
            messagebox.showerror("錯誤", f"無法開啟今日資料夾：{e}")

    def open_latest_pdf(self):
        """開啟今日資料夾內最新 PDF。"""
        path = self._latest_report_file(["Trend_Report_*.pdf", "*.pdf"])
        if not path:
            messagebox.showwarning("提醒", "今日資料夾內找不到 PDF 檔")
            return
        self._open_path_by_system(path)
        self.set_status(f"📄 已開啟最新 PDF：{os.path.basename(path)}", "blue")

    def open_latest_png(self):
        """開啟今日資料夾內最新 PNG。"""
        path = self._latest_report_file(["Trend_Report_*.png", "*.png"])
        if not path:
            messagebox.showwarning("提醒", "今日資料夾內找不到 PNG 圖檔")
            return
        self._open_path_by_system(path)
        self.set_status(f"🖼 已開啟最新 PNG：{os.path.basename(path)}", "blue")

    def open_latest_csv(self):
        """開啟今日資料夾內最新 CSV。"""
        path = self._latest_report_file(["*_Trend_*.csv", "*.csv"])
        if not path:
            messagebox.showwarning("提醒", "今日資料夾內找不到 CSV 檔")
            return
        self._open_path_by_system(path)
        self.set_status(f"📄 已開啟最新 CSV：{os.path.basename(path)}", "blue")

    def open_data_file_dialog(self):
        """相容舊版呼叫：直接開啟今日報表資料夾，不再跳出資料檔選單。"""
        self.open_today_report_folder()

    def open_report_folder(self):
        """開啟今日報表資料夾。"""
        self.open_today_report_folder()

    # =========================================================
    # 開啟資料夾
    # =========================================================
    def open_log_folder(self):
        path = self.log_folder
        try:
            sysname = platform.system().lower()
            if sysname == "windows":
                os.startfile(path)  # type: ignore[attr-defined]
            elif sysname == "darwin":
                subprocess.Popen(["open", path])
            else:
                subprocess.Popen(["xdg-open", path])
        except Exception as e:
            messagebox.showerror("錯誤", f"無法開啟資料夾：{e}")

    # =========================================================
    # 離開
    # =========================================================
    def exit_program(self):
        self.close_trend_window()
        self.closing = True

        try:
            self.audit("EXIT")
        except Exception:
            pass

        try:
            if self._reconnect_after_id is not None:
                self.root.after_cancel(self._reconnect_after_id)
                self._reconnect_after_id = None
        except Exception:
            pass

        try:
            self.stop_web_server()
        except Exception:
            pass

        try:
            self._stop_event.set()
            self.running = False
        except Exception:
            pass

        try:
            if self._poll_thread and self._poll_thread.is_alive():
                self._poll_thread.join(timeout=0.8)
        except Exception:
            pass

        try:
            if self.client:
                self.client.close()
        except Exception:
            pass

        try:
            self.root.destroy()
        except Exception:
            pass

# =========================================================
# V5.0A Administrator / Operator Only 權限補強
# =========================================================
def _ec62_v50_default_users(admin_password=None):
    # V5.0A：登入使用者只保留 admin / operator。
    # 未登入 Web 仍會以內部 guest 狀態只讀顯示，但不出現在下拉選單。
    return {
        "admin": {"password": str(admin_password or DEFAULT_PASSWORD), "role": "administrator", "display": "Admin"},
        "operator": {"password": "1234", "role": "operator", "display": "Operator"},
    }

def _ec62_v50_norm_role(role):
    r = str(role or "guest").strip().lower()
    if r in ("admin", "administrator", "管理者"):
        return "administrator"
    if r in ("op", "operator", "操作員"):
        return "operator"
    return "guest"

def _ec62_v50_role_name(role, lang="en"):
    """依語言回傳權限名稱：中文只顯示中文，英文只顯示英文。"""
    r = _ec62_v50_norm_role(role)
    is_zh = str(lang or "").lower().startswith("zh") or str(lang or "") in ("中文", "cn")
    if is_zh:
        return "管理者" if r == "administrator" else ("操作者" if r == "operator" else "訪客")
    return "Admin" if r == "administrator" else ("Operator" if r == "operator" else "Guest")

def _ec62_v50_lang(self):
    try:
        return "zh" if str(getattr(self, "language", "zh")).lower().startswith("zh") else "en"
    except Exception:
        return "zh"

def _ec62_v50_text(self, zh_text, en_text):
    return zh_text if _ec62_v50_lang(self) == "zh" else en_text

def _ec62_v50_can(role, action):
    r = _ec62_v50_norm_role(role)
    if r == "administrator":
        return True
    if r == "operator":
        return action in {"alarm_recovery", "clear_minmax", "set_limits", "test_notify", "reconnect", "view", "alarm_history"}
    return action in {"view"}

_ORIG_EC62_INIT = E62GUI.__init__
_ORIG_LOAD_CONFIG = E62GUI.load_config
_ORIG_SAVE_CONFIG = E62GUI.save_config
_ORIG_SAVE_PW_ONLY = E62GUI.save_config_silent_password_only
_ORIG_LOCK_SETTINGS = E62GUI.lock_settings
_ORIG_UNLOCK_SETTINGS = E62GUI.unlock_settings
_ORIG_GET_WEB_SNAPSHOT = E62GUI.get_web_snapshot
_ORIG_WEB_SAVE_NOTIFY = E62GUI.web_save_notify_config
_ORIG_WEB_TEST_NOTIFY = E62GUI.web_test_notify
_ORIG_WEB_MANUAL_RECOVERY = E62GUI.web_manual_recovery
_ORIG_WEB_HTML = E62GUI._web_html


def _v50_init(self, root):
    self.users = _ec62_v50_default_users(DEFAULT_PASSWORD)
    self.current_user = "guest"
    self.current_role = "guest"
    self.web_sessions = {}
    _ORIG_EC62_INIT(self, root)
    self.web_sessions = getattr(self, "web_sessions", {}) or {}


def _v50_authenticate(self, username, password, allow_guest=True):
    uname = str(username or "guest").strip().lower()
    pwd = str(password or "")
    users = getattr(self, "users", {}) or {}
    user = users.get(uname)
    if user is None:
        for k, u in users.items():
            if str(u.get("display", "")).lower() == uname:
                uname, user = k, u
                break
    if user is None:
        return None, None
    role = _ec62_v50_norm_role(user.get("role"))
    if role == "guest" and allow_guest:
        return uname, role
    if pwd == str(user.get("password", "")):
        return uname, role
    return None, None


def _v50_load_config(self):
    _ORIG_LOAD_CONFIG(self)
    try:
        if not os.path.exists(self.config_path):
            self.users = _ec62_v50_default_users(getattr(self, "password", DEFAULT_PASSWORD))
            return
        with open(self.config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f) or {}
        base = _ec62_v50_default_users(getattr(self, "password", DEFAULT_PASSWORD))
        users = cfg.get("users", {})
        if isinstance(users, dict):
            for k, u in users.items():
                if isinstance(u, dict) and str(k).strip():
                    base[str(k).strip().lower()] = {
                        "password": str(u.get("password", "")),
                        "role": _ec62_v50_norm_role(u.get("role", "guest")),
                        "display": str(u.get("display", k)),
                    }
        self.users = base
        try:
            if str(self.users.get("admin", {}).get("display", "")).strip().lower() == "administrator":
                self.users["admin"]["display"] = "Admin"
        except Exception:
            pass
        self.password = self.users.get("admin", {}).get("password") or getattr(self, "password", DEFAULT_PASSWORD)
    except Exception as e:
        try: self.write_error_log(f"v5 load users error: {e}")
        except Exception: pass


def _v50_save_users_into_config(self):
    cfg = {}
    try:
        if os.path.exists(self.config_path):
            with open(self.config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or {}
        cfg["users"] = getattr(self, "users", _ec62_v50_default_users(getattr(self, "password", DEFAULT_PASSWORD)))
        if "admin" in cfg["users"]:
            cfg["password"] = cfg["users"]["admin"].get("password", getattr(self, "password", DEFAULT_PASSWORD))
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        try: self.write_error_log(f"v5 save users error: {e}")
        except Exception: pass
        return False


def _v50_save_config(self):
    if not _ec62_v50_can(getattr(self, "current_role", "guest"), "admin_config"):
        try: messagebox.showwarning(_ec62_v50_text(self, "提醒", "Notice"), _ec62_v50_text(self, "🔒 只有管理者可以儲存系統設定", "🔒 Admin only can save system settings"))
        except Exception: pass
        return
    _ORIG_SAVE_CONFIG(self)
    _v50_save_users_into_config(self)


def _v50_save_config_silent_password_only(self):
    try:
        users = getattr(self, "users", _ec62_v50_default_users(getattr(self, "password", DEFAULT_PASSWORD)))
        users.setdefault("admin", {"role":"administrator", "display":"Admin", "password": DEFAULT_PASSWORD})
        users["admin"]["password"] = str(getattr(self, "password", DEFAULT_PASSWORD))
        self.users = users
        _v50_save_users_into_config(self)
    except Exception:
        _ORIG_SAVE_PW_ONLY(self)


def _v50_lock_settings(self, init=False):
    _ORIG_LOCK_SETTINGS(self, init)
    try:
        self.current_user = "guest"; self.current_role = "guest"; self.is_unlocked = False; self.web_sessions = {}
    except Exception:
        pass


def _v50_unlock_settings(self, role="administrator", username="admin"):
    self.current_user = str(username or "admin")
    self.current_role = _ec62_v50_norm_role(role)
    _ORIG_UNLOCK_SETTINGS(self)
    try:
        role_text = _ec62_v50_role_name(self.current_role, _ec62_v50_lang(self))
        if _ec62_v50_lang(self) == "zh":
            self.btn_toggle_config.config(text=f"▲ {role_text}已登入 / 按上鎖關閉")
        else:
            self.btn_toggle_config.config(text=f"▲ {role_text} Login / Lock")
        if self.current_role != "administrator":
            for w in [getattr(self,"save_btn",None), getattr(self,"change_pw_btn",None), getattr(self,"apply_serial_btn",None), getattr(self,"apply_web_btn",None), getattr(self,"apply_ch_count_btn",None), getattr(self,"channel_count_cb",None)]:
                if w is not None:
                    try: w.config(state="disabled")
                    except Exception: pass
            self.set_status(_ec62_v50_text(self, "✅ 操作員已登入：可解除警報、清除 MAX/MIN、測試通知", "✅ Operator login: alarm recovery, clear MAX/MIN, test notification enabled"), "green")
        else:
            self.set_status(_ec62_v50_text(self, "✅ 管理者已登入：所有設定功能已開啟", "✅ Admin login: all settings enabled"), "green")
        self.audit("LOGIN", f"user={self.current_user} role={self.current_role}")
    except Exception:
        pass


def _v50_unlock_dialog(self):
    remain = self._lockout_remaining()
    if remain > 0:
        messagebox.showwarning(self.tr("鎖定中"), f"⛔ {self.tr('密碼錯誤')} / {remain} {self.tr('秒')}")
        return
    try:
        if self.password_window is not None and self.password_window.winfo_exists():
            self.password_window.lift(); self.password_window.focus_force(); return
    except Exception:
        pass
    win = tk.Toplevel(self.root); self.password_window = win
    win.title(_ec62_v50_text(self, "使用者登入", "User Login")); win.geometry("820x390"); win.configure(bg="#111111"); win.resizable(False, False); win.transient(self.root); win.grab_set()
    topbar = tk.Frame(win, bg="#1A1A1A", height=46); topbar.pack(fill="x"); topbar.pack_propagate(False)
    tk.Label(topbar, text=_ec62_v50_text(self, "🔐 EC62 管理者權限登入", "🔐 EC62 Admin Login"), bg="#1A1A1A", fg="#00E5FF", font=("Arial", 15, "bold")).pack(side="left", padx=12)
    tk.Button(topbar, text="✕", command=self.close_password_window, bg="#661111", fg="white", font=("Arial", 11, "bold"), width=4, relief="flat").pack(side="right", padx=8, pady=6)
    body = tk.Frame(win, bg="#111111"); body.pack(fill="both", expand=True, padx=22, pady=16)
    tk.Label(body, text=_ec62_v50_text(self, "管理者可修改全部設定；操作者可解除警報與現場操作。", "Admin can edit all settings; Operator can recover alarms and operate."), bg="#111111", fg="#BBBBBB", font=("Arial", 11, "bold"), wraplength=760).grid(row=0, column=0, columnspan=2, sticky="we", pady=(0,14))
    tk.Label(body, text=_ec62_v50_text(self, "使用者", "User Name"), bg="#111111", fg="#facc15", font=("Arial", 13, "bold")).grid(row=1, column=0, sticky="e", padx=8, pady=8)
    user_var = tk.StringVar(value="admin")
    user_cb = ttk.Combobox(body, textvariable=user_var, values=[u for u in ((getattr(self,"users",{}) or {}).keys()) if str(u).lower() in ("admin","operator")] or ["admin","operator"], width=26, font=("Arial", 14, "bold"))
    user_cb.grid(row=1, column=1, sticky="w", padx=8, pady=8)
    tk.Label(body, text=_ec62_v50_text(self, "密碼", "Password"), bg="#111111", fg="#facc15", font=("Arial", 13, "bold")).grid(row=2, column=0, sticky="e", padx=8, pady=8)
    pwd_var = tk.StringVar(); show_pwd_var = tk.BooleanVar(value=False)
    pwd_entry = tk.Entry(body, textvariable=pwd_var, show="*", font=("Courier", 18, "bold"), width=28, justify="center", bg="#1A1A1A", fg="#00FFCC", insertbackground="#00FFCC", relief="solid", bd=1)
    pwd_entry.grid(row=2, column=1, sticky="w", padx=8, pady=8, ipady=6)
    hint_label = tk.Label(body, text=_ec62_v50_text(self, "預設：admin / SGS@1234；operator / 1234", "Default: admin / SGS@1234; operator / 1234"), bg="#111111", fg="#94a3b8", font=("Arial", 11, "bold")); hint_label.grid(row=3, column=0, columnspan=2, pady=(2,8))
    def toggle_show_password(): pwd_entry.config(show="" if show_pwd_var.get() else "*")
    tk.Checkbutton(body, text=_ec62_v50_text(self, "顯示密碼", "Show Password"), variable=show_pwd_var, command=toggle_show_password, bg="#111111", fg="yellow", selectcolor="#111111", activebackground="#111111", activeforeground="yellow", font=("Arial", 11, "bold")).grid(row=4, column=0, columnspan=2, pady=(0,8))
    btn_frame = tk.Frame(body, bg="#111111"); btn_frame.grid(row=5, column=0, columnspan=2, pady=6)
    def do_login():
        uname, role = self.authenticate_user(user_var.get(), pwd_var.get(), allow_guest=False)
        if uname and role in ("administrator", "operator"):
            self._fail_count = 0; self._lockout_until = 0.0; self.close_password_window(); self.unlock_settings(role, uname); return
        self._fail_count += 1; left = MAX_FAILS - self._fail_count; self.flash_password_window_red(win); pwd_var.set(""); pwd_entry.focus_set()
        if self._fail_count >= MAX_FAILS:
            self._lockout_until = time.time() + LOCKOUT_SECONDS; self._fail_count = 0; hint_label.config(text=_ec62_v50_text(self, f"錯誤 3 次，已鎖定 {LOCKOUT_SECONDS} 秒", f"3 wrong attempts, locked for {LOCKOUT_SECONDS} sec"), fg="#FF6666")
        else:
            hint_label.config(text=_ec62_v50_text(self, f"密碼錯誤，剩餘 {left} 次機會", f"Password incorrect, {left} attempts left"), fg="#FF6666")
    tk.Button(btn_frame, text=_ec62_v50_text(self, "登入", "Login"), command=do_login, bg="#00AA00", fg="white", font=("Courier", 12, "bold"), width=16, height=2, relief="flat").pack(side="left", padx=12)
    tk.Button(btn_frame, text=_ec62_v50_text(self, "取消", "Cancel"), command=self.close_password_window, bg="#AA3333", fg="white", font=("Courier", 12, "bold"), width=16, height=2, relief="flat").pack(side="left", padx=12)
    pwd_entry.focus_set(); win.bind("<Return>", lambda _e: do_login()); win.bind("<Escape>", lambda _e: self.close_password_window()); win.protocol("WM_DELETE_WINDOW", self.close_password_window)


def _v50_change_password_dialog(self):
    if getattr(self, "current_role", "guest") != "administrator":
        messagebox.showwarning(_ec62_v50_text(self, "提醒", "Notice"), _ec62_v50_text(self, "🔒 只有管理者可以管理使用者 / 修改密碼", "🔒 Admin only can manage users / change password")); return
    win = tk.Toplevel(self.root); win.title(_ec62_v50_text(self, "使用者管理", "User Management")); win.geometry("720x460"); win.configure(bg="#111827"); win.transient(self.root); win.grab_set(); win.resizable(False, False)
    users = getattr(self, "users", _ec62_v50_default_users(getattr(self, "password", DEFAULT_PASSWORD)))
    user_var = tk.StringVar(value="admin"); pass_var = tk.StringVar(value=""); role_var = tk.StringVar(value="administrator"); display_var = tk.StringVar(value="Admin")
    tk.Label(win, text=_ec62_v50_text(self, "🔑 使用者管理", "🔑 User Management"), bg="#111827", fg="#38bdf8", font=("Arial", 18, "bold")).pack(fill="x", pady=(12,8))
    frm = tk.Frame(win, bg="#111827"); frm.pack(fill="both", expand=True, padx=18, pady=8); frm.columnconfigure(2, weight=1)
    lb = tk.Listbox(frm, height=10, bg="#0b1220", fg="white", font=("Consolas", 12), width=32); lb.grid(row=0, column=0, rowspan=7, sticky="ns", padx=(0,14))
    def refresh_list():
        lb.delete(0, "end")
        for k in sorted(users.keys()): lb.insert("end", f"{k:<14} {users[k].get('role','guest')}")
    def load_selected(_e=None):
        sel = lb.curselection();
        if not sel: return
        key = lb.get(sel[0]).split()[0]; u = users.get(key, {})
        user_var.set(key); pass_var.set(""); role_var.set(_ec62_v50_norm_role(u.get("role"))); display_var.set(u.get("display", key))
    lb.bind("<<ListboxSelect>>", load_selected)
    def row(r, label, widget):
        tk.Label(frm, text=label, bg="#111827", fg="#facc15", font=("Arial", 12, "bold")).grid(row=r, column=1, sticky="w", pady=6)
        widget.grid(row=r, column=2, sticky="we", pady=6, ipady=4)
    row(0,_ec62_v50_text(self, "使用者", "User Name"),tk.Entry(frm,textvariable=user_var,bg="#1f2937",fg="white",insertbackground="white",font=("Arial",12)))
    row(1,_ec62_v50_text(self, "顯示名稱", "Display"),tk.Entry(frm,textvariable=display_var,bg="#1f2937",fg="white",insertbackground="white",font=("Arial",12)))
    row(2,_ec62_v50_text(self, "權限", "Role"),ttk.Combobox(frm,textvariable=role_var,values=["administrator","operator","guest"],state="readonly",font=("Arial",12)))
    row(3,_ec62_v50_text(self, "新密碼", "New Password"),tk.Entry(frm,textvariable=pass_var,show="*",bg="#1f2937",fg="white",insertbackground="white",font=("Arial",12)))
    tk.Label(frm,text=_ec62_v50_text(self, "密碼空白：保留原密碼。admin 不可刪除。", "Blank password: keep old password. admin cannot be deleted."),bg="#111827",fg="#94a3b8",font=("Arial",10,"bold")).grid(row=4,column=1,columnspan=2,sticky="w",pady=6)
    def save_user():
        key = user_var.get().strip().lower(); role = _ec62_v50_norm_role(role_var.get()); old = users.get(key,{})
        if not key: messagebox.showerror(_ec62_v50_text(self, "錯誤", "Error"), _ec62_v50_text(self, "使用者不可空白", "User Name cannot be blank")); return
        pwd = pass_var.get()
        if role != "guest" and not pwd and not old.get("password"): messagebox.showerror(_ec62_v50_text(self, "錯誤", "Error"), _ec62_v50_text(self, "新使用者需輸入密碼", "New user needs a password")); return
        users[key] = {"password": pwd if pwd else old.get("password", ""), "role": role, "display": display_var.get().strip() or key}
        if key == "admin": self.password = users[key]["password"] or DEFAULT_PASSWORD
        self.users = users; _v50_save_users_into_config(self); refresh_list(); pass_var.set(""); self.audit("USER_SAVE", f"user={key} role={role}"); messagebox.showinfo(_ec62_v50_text(self, "完成", "Done"), _ec62_v50_text(self, "✅ 使用者已儲存", "✅ User saved"))
    def delete_user():
        key = user_var.get().strip().lower()
        if key == "admin": messagebox.showwarning(_ec62_v50_text(self, "提醒", "Notice"), _ec62_v50_text(self, "admin 不可刪除", "admin cannot be deleted")); return
        if key in users and messagebox.askyesno(_ec62_v50_text(self, "確認", "Confirm"), _ec62_v50_text(self, f"刪除使用者 {key}？", f"Delete user {key}?")):
            users.pop(key,None); self.users=users; _v50_save_users_into_config(self); refresh_list(); self.audit("USER_DELETE", f"user={key}")
    btns=tk.Frame(frm,bg="#111827"); btns.grid(row=6,column=1,columnspan=2,sticky="we",pady=12)
    tk.Button(btns,text=_ec62_v50_text(self, "💾 儲存 / 新增", "💾 Save / Add"),command=save_user,bg="#16a34a",fg="white",font=("Arial",12,"bold"),relief="flat").pack(side="left",fill="x",expand=True,padx=4,ipady=8)
    tk.Button(btns,text=_ec62_v50_text(self, "🗑 刪除", "🗑 Delete"),command=delete_user,bg="#dc2626",fg="white",font=("Arial",12,"bold"),relief="flat").pack(side="left",fill="x",expand=True,padx=4,ipady=8)
    tk.Button(btns,text=_ec62_v50_text(self, "關閉", "Close"),command=win.destroy,bg="#334155",fg="white",font=("Arial",12,"bold"),relief="flat").pack(side="left",fill="x",expand=True,padx=4,ipady=8)
    refresh_list()


def _v50_create_session(self, username, role):
    import secrets
    token = secrets.token_urlsafe(24); self.web_sessions[token] = {"username": username, "role": _ec62_v50_norm_role(role), "time": time.time()}; return token

def _v50_get_session_role(self, token):
    sess = (getattr(self, "web_sessions", {}) or {}).get(str(token), {}) if token else {}
    return sess.get("role", "guest"), sess.get("username", "guest")

def _v50_web_login(self, data):
    uname, role = self.authenticate_user((data or {}).get("username", ""), (data or {}).get("password", ""), allow_guest=True)
    if uname is None: return {"ok": False, "message": "登入失敗 / Login failed"}
    token = self.create_web_session(uname, role)
    lang = "zh" if str((data or {}).get("lang", "")).lower().startswith("zh") else "en"
    return {"ok": True, "message": "登入成功" if lang == "zh" else "Login successful", "token": token, "username": uname, "role": role, "role_name": _ec62_v50_role_name(role, lang)}


def _v50_web_html(self):
    html = _ORIG_WEB_HTML(self)
    html = html.replace('<button class="smallbtn" style="max-width:170px" onclick="toggleWebLanguage()" id="langBtn">🌐 中文 / English</button>', '<button class="smallbtn" style="max-width:170px" onclick="toggleWebLanguage()" id="langBtn">🌐 中文 / English</button><span class="pill" id="loginState">Guest</span><input id="loginUser" placeholder="admin / operator" style="max-width:150px;background:#0b1220;color:white;border:1px solid #334155;border-radius:10px;padding:8px"><input id="loginPass" type="password" placeholder="Password" style="max-width:150px;background:#0b1220;color:white;border:1px solid #334155;border-radius:10px;padding:8px"><button class="smallbtn" style="max-width:110px" onclick="webLogin()">Login</button><button class="smallbtn" style="max-width:110px" onclick="webLogout()">Logout</button>')
    html = html.replace("let webLang='zh';", "let webLang='zh';\nlet ec62Token=localStorage.getItem('ec62_token')||'';\nlet ec62Role=localStorage.getItem('ec62_role')||'guest';")
    html = html.replace("headers:{'Cache-Control':'no-cache'}", "headers:{'Cache-Control':'no-cache','X-EC62-Token':ec62Token}")
    html = html.replace("headers:{'Content-Type':'application/json'}", "headers:{'Content-Type':'application/json','X-EC62-Token':ec62Token}")
    html = html.replace("async function clearMinMax(uid){", "async function webLogin(){const username=(document.getElementById('loginUser')||{}).value||'guest'; const password=(document.getElementById('loginPass')||{}).value||''; const d=await postJson('/api/login',{username,password,lang:webLang}); if(d.ok){ec62Token=d.token; ec62Role=d.role; localStorage.setItem('ec62_token',ec62Token); localStorage.setItem('ec62_role',ec62Role); alert((webLang==='zh'?'登入成功：':'Login OK: ')+d.role_name); await load();}else alert(d.message||'Login failed');}\nfunction webLogout(){ec62Token=''; ec62Role='guest'; localStorage.removeItem('ec62_token'); localStorage.removeItem('ec62_role'); const u=document.getElementById('loginUser'); const p=document.getElementById('loginPass'); const s=document.getElementById('loginState'); if(u)u.value=''; if(p)p.value=''; if(s)s.textContent=(webLang==='zh'?'訪客':'Guest'); window._notifyLoaded=false; load();}\nasync function clearMinMax(uid){")
    html = html.replace("if(d.settings_unlocked){ if(notifySection)notifySection.style.display='block'; if(notifyLocked)notifyLocked.style.display='none'; }", "if(d.can_admin){ if(notifySection)notifySection.style.display='block'; if(notifyLocked)notifyLocked.style.display='none'; }")
    html = html.replace("if(d.settings_unlocked){loadAlarmHistory();}", "if(d.can_operator){loadAlarmHistory();}")
    html = html.replace("if(d.notify && !window._notifyLoaded){setNotifyForm(d.notify); setAuditForm(d.alarm_audit); window._notifyLoaded=true;}", "ec62Role=d.web_role||ec62Role; const ls=document.getElementById('loginState'); if(ls)ls.textContent=(d.web_user||'guest')+' ('+(d.web_role_name||(webLang==='zh'?'訪客':'Guest'))+')';\n    if(d.notify && !window._notifyLoaded){setNotifyForm(d.notify); setAuditForm(d.alarm_audit); window._notifyLoaded=true;}")
    html = html.replace("if(d.settings_unlocked && ((d.lan_urls&&d.lan_urls.length)||d.lan_url))", "if(d.can_admin && ((d.lan_urls&&d.lan_urls.length)||d.lan_url))")
    return html


def _v50_start_web_server(self):
    if self.web_server is not None: return
    app = self
    class EC62WebHandler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args): return
        def _send(self, code, content, ctype="text/html; charset=utf-8"):
            data = content.encode("utf-8") if isinstance(content, str) else content
            self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Cache-Control", "no-store"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
        def _json(self, obj, code=200): self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")
        def _parse_query(self, parsed):
            q={}
            try:
                for part in (parsed.query or "").split("&"):
                    if not part: continue
                    k,v = part.split("=",1) if "=" in part else (part,"")
                    from urllib.parse import unquote_plus
                    q[unquote_plus(k)] = unquote_plus(v)
            except Exception: pass
            return q
        def _token(self, data=None, query=None): return str(self.headers.get("X-EC62-Token", "") or (data or {}).get("token", "") or (query or {}).get("token", ""))
        def _role_user(self, data=None, query=None): return app.get_web_session_role(self._token(data, query))
        def _check(self, action, data=None, query=None):
            role,user = self._role_user(data, query)
            if not _ec62_v50_can(role, action):
                self._json({"ok":False,"message":"權限不足：需要操作員或管理者 / Permission denied: Operator or Admin required","role":role}); return False, role, user
            return True, role, user
        def do_POST(self):
            try:
                parsed=urlparse(self.path); path=parsed.path
                try:
                    length=int(self.headers.get("Content-Length","0") or 0); raw=self.rfile.read(length) if length>0 else b"{}"; data=json.loads(raw.decode("utf-8") or "{}")
                except Exception: data={}
                if path == "/api/login": self._json(app.web_login(data)); return
                if path == "/api/save_notify":
                    ok,role,user=self._check("admin_config",data=data)
                    if not ok: return
                    old=app.is_unlocked
                    try: app.is_unlocked=True; self._json(_ORIG_WEB_SAVE_NOTIFY(app,data))
                    finally: app.is_unlocked=old
                    return
                if path == "/api/test_notify":
                    ok,role,user=self._check("test_notify",data=data)
                    if not ok: return
                    old=app.is_unlocked
                    try: app.is_unlocked=True; self._json(_ORIG_WEB_TEST_NOTIFY(app,str(data.get("target","all"))))
                    finally: app.is_unlocked=old
                    return
                if path == "/api/manual_recovery":
                    ok,role,user=self._check("alarm_recovery",data=data)
                    if not ok: return
                    old_unlocked, old_user, old_role = app.is_unlocked, getattr(app,"current_user","guest"), getattr(app,"current_role","guest")
                    try:
                        app.is_unlocked=True; app.current_user=user; app.current_role=role; self._json(_ORIG_WEB_MANUAL_RECOVERY(app,data))
                    finally:
                        app.is_unlocked, app.current_user, app.current_role = old_unlocked, old_user, old_role
                    return
                self._send(404,"Not Found","text/plain; charset=utf-8")
            except Exception as e:
                app.write_error_log(f"web post error: {e}"); self._send(500,"Web Error","text/plain; charset=utf-8")
        def do_GET(self):
            try:
                parsed=urlparse(self.path); path=parsed.path; query=self._parse_query(parsed)
                if path in ("/","/index.html"): self._send(200,app._web_html()); return
                if path == "/api/data":
                    role,user=self._role_user(query=query); snap=_ORIG_GET_WEB_SNAPSHOT(app)
                    snap["web_role"]=role; snap["web_user"]=user; snap["web_role_name"]=_ec62_v50_role_name(role, getattr(app, "language", "zh")); snap["can_admin"]=_ec62_v50_can(role,"admin_config"); snap["can_operator"]=_ec62_v50_can(role,"alarm_recovery"); snap["settings_unlocked"]=bool(snap["can_admin"])
                    if not snap["can_admin"]: snap["notify"]=None; snap["alarm_audit"]=None; snap["lan_url"]=None; snap["lan_urls"]=[]; snap["local_url"]=None
                    self._json(snap); return
                if path == "/api/clear_minmax":
                    ok,role,user=self._check("clear_minmax",query=query)
                    if not ok: return
                    self._json(app.web_clear_minmax(query.get("uid","all"))); return
                if path == "/api/set_limits":
                    ok,role,user=self._check("set_limits",query=query)
                    if not ok: return
                    self._json(app.web_set_alarm_limits(query.get("uid","1"),query.get("lo",""),query.get("hi",""))); return
                if path == "/api/set_language": self._json(app.web_set_language(query.get("lang","zh"))); return
                if path == "/api/alarm_history":
                    ok,role,user=self._check("alarm_history",query=query)
                    if not ok: return
                    self._json(app.web_alarm_history(query.get("limit","200"))); return
                if path == "/manifest.json": self._send(200, app._web_manifest(), "application/manifest+json; charset=utf-8"); return
                self._send(404,"Not Found","text/plain; charset=utf-8")
            except Exception as e:
                app.write_error_log(f"web request error: {e}"); self._send(500,"Web Error","text/plain; charset=utf-8")
    try:
        self.web_server = ThreadingHTTPServer(("0.0.0.0", int(self.web_port)), EC62WebHandler)
        self.web_thread = threading.Thread(target=self.web_server.serve_forever, daemon=True); self.web_thread.start(); self.update_lan_url_display(); self.set_status(f"🌐 Web V5.0 已啟動 0.0.0.0:{self.web_port}", "green"); self.audit("WEB_START_V50", "0.0.0.0:"+str(self.web_port))
    except OSError as e:
        self.web_server=None; self.write_error_log(f"start web server failed port={self.web_port}: {e}"); self.set_status(f"❌ Web Port {self.web_port} 無法啟動：{e}", "red")

# 套用 V5.0 patch
E62GUI.__init__ = _v50_init
E62GUI.authenticate_user = _v50_authenticate
E62GUI.load_config = _v50_load_config
E62GUI.save_config = _v50_save_config
E62GUI.save_config_silent_password_only = _v50_save_config_silent_password_only
E62GUI.lock_settings = _v50_lock_settings
E62GUI.unlock_settings = _v50_unlock_settings
E62GUI.unlock_dialog = _v50_unlock_dialog
E62GUI.change_password_dialog = _v50_change_password_dialog
E62GUI.create_web_session = _v50_create_session
E62GUI.get_web_session_role = _v50_get_session_role
E62GUI.web_login = _v50_web_login
E62GUI._web_html = _v50_web_html
E62GUI.start_web_server = _v50_start_web_server


# =========================================================
# V5.0C 主畫面 Operator 下拉選單顯示修正 + Config 固定代碼
# 只修改「輸入密碼以顯示設定」後的主畫面設定區，不新增 Web 下拉功能。
# =========================================================
_EC62_OPERATOR_ITEMS = (
    ("admin", "admin(管理者)", "admin(管理者)"),
    ("operator", "operator(操作者)", "operator(操作者)"),
    ("guest", "guest(測試者)", "guest(測試者)"),
)

def _ec62_operator_language(self):
    try:
        lang = str(getattr(self, "language", "zh") or "zh").lower()
        return "en" if lang.startswith("en") else "zh"
    except Exception:
        return "zh"


def _ec62_operator_values(self):
    lang = _ec62_operator_language(self)
    return [en if lang == "en" else zh for _code, zh, en in _EC62_OPERATOR_ITEMS]


def _ec62_operator_to_code(value):
    t = str(value or "").strip().lower()
    if not t:
        return "admin"
    mapping = {
        "admin": "admin", "administrator": "admin", "管理者": "admin", "admin(管理者)": "admin", "admin(admin)": "admin", "system": "admin", "記錄人": "admin", "紀錄人": "admin",
        "operator": "operator", "op": "operator", "操作員": "operator", "操作者": "operator", "operator(操作者)": "operator", "operator(operator)": "operator",
        "guest": "guest", "visitor": "guest", "訪客": "guest", "測試者": "guest", "測試員": "guest", "guest(測試者)": "guest", "guest(guest)": "guest", "quest": "guest",
    }
    return mapping.get(t, "admin")


def _ec62_operator_display(self, code=None):
    c = _ec62_operator_to_code(code if code is not None else getattr(self, "alarm_operator", "admin"))
    lang = _ec62_operator_language(self)
    for item_code, zh, en in _EC62_OPERATOR_ITEMS:
        if item_code == c:
            return en if lang == "en" else zh
    return "admin(管理者)"


def _ec62_update_operator_combobox_display(self):
    """同步主畫面 Operator 下拉：中文/英文 values + 目前顯示文字。"""
    try:
        current = ""
        try:
            current = self.alarm_operator_var.get()
        except Exception:
            current = getattr(self, "alarm_operator", "admin")
        code = _ec62_operator_to_code(current)
        self.alarm_operator = code
        if hasattr(self, "operator_cb") and self.operator_cb is not None:
            vals = _ec62_operator_values(self)
            self.operator_cb["values"] = vals
            display = _ec62_operator_display(self, code)
            self.alarm_operator_var.set(display)
            try:
                self.operator_cb.set(display)
            except Exception:
                pass
        else:
            self.alarm_operator_var.set(_ec62_operator_display(self, code))
    except Exception as e:
        try:
            self.write_error_log(f"update operator combobox error: {e}")
        except Exception:
            pass


def _ec62_alarm_audit_defaults_v51(self):
    """回傳固定代碼 operator + reason；Config / Alarm Log 使用 admin/operator/guest。"""
    try:
        raw_op = self.alarm_operator_var.get()
    except Exception:
        raw_op = getattr(self, "alarm_operator", "admin")
    op_code = _ec62_operator_to_code(raw_op)
    try:
        reason = str(self.alarm_reason_var.get() or "").strip()
    except Exception:
        reason = str(getattr(self, "alarm_reason", "") or "").strip()
    if not reason:
        reason = "Temperature Returned to Normal"
    self.alarm_operator = op_code
    self.alarm_reason = reason
    return op_code, reason


_ORIG_APPLY_LANGUAGE_V51_GUI_OPERATOR = E62GUI.apply_language
_ORIG_LOAD_CONFIG_V51_GUI_OPERATOR = E62GUI.load_config


def _ec62_apply_language_v51_gui_operator(self):
    _ORIG_APPLY_LANGUAGE_V51_GUI_OPERATOR(self)
    _ec62_update_operator_combobox_display(self)


def _ec62_load_config_v51_gui_operator(self):
    _ORIG_LOAD_CONFIG_V51_GUI_OPERATOR(self)
    try:
        # 將舊版 System/Admin/管理者 等統一轉成固定代碼，顯示時再依語言轉中文/英文。
        code = _ec62_operator_to_code(getattr(self, "alarm_operator", "admin"))
        try:
            code = _ec62_operator_to_code(self.alarm_operator_var.get())
        except Exception:
            pass
        self.alarm_operator = code
        _ec62_update_operator_combobox_display(self)
    except Exception:
        pass


E62GUI._ec62_update_operator_combobox_display = _ec62_update_operator_combobox_display
E62GUI._alarm_audit_defaults = _ec62_alarm_audit_defaults_v51
E62GUI.apply_language = _ec62_apply_language_v51_gui_operator
E62GUI.load_config = _ec62_load_config_v51_gui_operator


# =========================================================
# V5.0C Web Alarm History：查看 / 解除 / 刪除 / 全部刪除 / 下載
# V5.2A Web Logout：登出時清除帳號、密碼、Role、Token 與登入狀態
# - 管理者(Admin/管理者)：解除、刪除、全部刪除、下載
# - 操作者(Operator/操作者)：查看、解除、下載
# # =========================================================
import base64


def _ec62_v52_can(role, action):
    r = _ec62_v50_norm_role(role)
    if r == "administrator":
        return True
    if r == "operator":
        return action in {"alarm_recovery", "clear_minmax", "set_limits", "test_notify", "reconnect", "view", "alarm_history", "download_log"}
    return action in {"view", "alarm_history"}


def _ec62_v52_row_key(row):
    try:
        raw = "|".join([
            str(row.get("time", "")),
            str(row.get("utc", "")),
            str(row.get("channel", "")),
            str(row.get("event", "")),
            str(row.get("value", "")),
            str(row.get("operator", "")),
            str(row.get("reason", "")),
            str(row.get("source", "")),
        ])
        return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")
    except Exception:
        return ""


def _ec62_v52_match_row(row, key=None, uid=None, time_text=None, event=None):
    try:
        if key:
            return _ec62_v52_row_key(row) == str(key)
        if uid not in (None, "", "all"):
            ch = f"CH{int(uid):02d}"
            if str(row.get("channel", "")) != ch:
                return False
        if time_text and str(row.get("time", "")) != str(time_text):
            return False
        if event and str(row.get("event", "")).upper() != str(event).upper():
            return False
        return True
    except Exception:
        return False


def _ec62_v52_alarm_files(self):
    try:
        os.makedirs(self.error_folder, exist_ok=True)
    except Exception:
        pass
    return {
        "jsonl": sorted(glob.glob(os.path.join(self.error_folder, "*_Alarm_Event.jsonl"))),
        "csv": sorted(glob.glob(os.path.join(self.error_folder, "*_Alarm_Event.csv"))),
        "txt": sorted(glob.glob(os.path.join(self.error_folder, "*_ERROR.txt"))),
    }


def _ec62_v52_read_all_alarm_rows(self, limit=300):
    rows = []
    try:
        limit = max(1, min(5000, int(limit or 300)))
        for path in reversed(_ec62_v52_alarm_files(self)["jsonl"][-31:]):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            r = json.loads(line)
                            r["key"] = _ec62_v52_row_key(r)
                            r["file"] = os.path.basename(path)
                            ev = str(r.get("event", "")).upper()
                            r["active"] = ev.startswith("ERR") or ev in ("ALARM", "WEB_ALARM", "COMMUNICATION ERROR")
                            rows.append(r)
                        except Exception:
                            pass
            except Exception:
                pass
        rows.sort(key=lambda x: str(x.get("time", "")), reverse=True)
        return rows[:limit]
    except Exception as e:
        try: self.write_error_log(f"V5.0 read all alarm rows error: {e}")
        except Exception: pass
        return []


def _ec62_v52_web_alarm_history(self, limit=300):
    try:
        all_rows = _ec62_v52_read_all_alarm_rows(self, limit)
        active_rows = self.read_alarm_event_history(limit)
        active_keys = set(_ec62_v52_row_key(r) for r in active_rows)
        for r in all_rows:
            if r.get("key") in active_keys:
                r["active"] = True
        return {"ok": True, "rows": all_rows, "active_rows": active_rows, "message": "OK"}
    except Exception as e:
        self.write_error_log(f"V5.0 web_alarm_history error: {e}")
        return {"ok": False, "message": str(e), "rows": []}


def _ec62_v52_filter_jsonl(path, key=None, uid=None, time_text=None, event=None, delete_all=False, clear_history=False):
    removed = 0
    kept = []
    if not os.path.exists(path):
        return 0
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                raw = line.rstrip("\n")
                if not raw.strip():
                    continue
                try:
                    row = json.loads(raw)
                except Exception:
                    kept.append(raw)
                    continue
                ev = str(row.get("event", "")).upper()
                is_active = ev.startswith("ERR") or ev in ("ALARM", "WEB_ALARM", "COMMUNICATION ERROR")
                remove = False
                if delete_all:
                    remove = True
                elif clear_history:
                    remove = not is_active
                elif _ec62_v52_match_row(row, key, uid, time_text, event):
                    remove = True
                if remove:
                    removed += 1
                else:
                    kept.append(json.dumps(row, ensure_ascii=False))
        with open(path, "w", encoding="utf-8") as f:
            if kept:
                f.write("\n".join(kept) + "\n")
            else:
                f.write("")
    except Exception:
        pass
    return removed


def _ec62_v52_rebuild_csv_from_jsonl(self):
    try:
        fields = ["time","utc","channel","name","event","value","unit","operator","reason","source"]
        files = _ec62_v52_alarm_files(self)
        for csv_path in files["csv"]:
            try:
                date_prefix = os.path.basename(csv_path).replace("_Alarm_Event.csv", "")
                json_path = os.path.join(self.error_folder, date_prefix + "_Alarm_Event.jsonl")
                rows = []
                if os.path.exists(json_path):
                    with open(json_path, "r", encoding="utf-8") as f:
                        for line in f:
                            try:
                                rows.append(json.loads(line))
                            except Exception:
                                pass
                with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
                    writer = csv.DictWriter(f, fieldnames=fields)
                    writer.writeheader()
                    for r in rows:
                        writer.writerow({k: r.get(k, "") for k in fields})
            except Exception:
                pass
    except Exception:
        pass


def _ec62_v52_rebuild_txt_from_jsonl(self):
    try:
        # 重新產生 YYYYMMDD_ERROR.txt，避免刪除後 TXT 還殘留舊警報。
        for txt_path in _ec62_v52_alarm_files(self)["txt"]:
            try:
                open(txt_path, "w", encoding="utf-8").close()
            except Exception:
                pass
        for json_path in _ec62_v52_alarm_files(self)["jsonl"]:
            try:
                ymd = os.path.basename(json_path).split("_", 1)[0].replace("-", "")
                txt_path = os.path.join(self.error_folder, f"{ymd}_ERROR.txt")
                with open(json_path, "r", encoding="utf-8") as f, open(txt_path, "a", encoding="utf-8") as out:
                    for line in f:
                        try:
                            r = json.loads(line)
                            out.write(f"[{r.get('time','')}] {r.get('channel','')} {r.get('name','')} EVENT={r.get('event','')} PV={r.get('value','')} {r.get('unit','°C')} OPERATOR={r.get('operator','')} REASON={r.get('reason','')} SOURCE={r.get('source','')}\n")
                        except Exception:
                            pass
            except Exception:
                pass
    except Exception:
        pass


def _ec62_v52_web_delete_alarm(self, data, mode="one"):
    try:
        mode = str((data or {}).get("mode", mode) or "one")
        key = str((data or {}).get("key", "") or "")
        uid = (data or {}).get("uid", None)
        time_text = str((data or {}).get("time", "") or "")
        event = str((data or {}).get("event", "") or "")
        delete_all = mode in ("all", "delete_all")
        clear_history = mode in ("history", "clear_history")
        removed = 0
        for p in _ec62_v52_alarm_files(self)["jsonl"]:
            removed += _ec62_v52_filter_jsonl(p, key=key, uid=uid, time_text=time_text, event=event, delete_all=delete_all, clear_history=clear_history)
        _ec62_v52_rebuild_csv_from_jsonl(self)
        _ec62_v52_rebuild_txt_from_jsonl(self)
        try:
            if delete_all:
                for i in range(1, self.max_unit_id + 1):
                    self.web_alarm_ack[i] = True
            elif uid not in (None, "", "all"):
                self.web_alarm_ack[int(uid)] = True
        except Exception:
            pass
        try:
            self.audit("WEB_ALARM_DELETE", f"mode={mode} uid={uid} removed={removed}")
        except Exception:
            pass
        msg = "已全部刪除" if delete_all else ("已清除歷史紀錄" if clear_history else "已刪除警報紀錄")
        return {"ok": True, "message": f"{msg}，共 {removed} 筆", "removed": removed}
    except Exception as e:
        try: self.write_error_log(f"v52 web delete alarm error: {e}")
        except Exception: pass
        return {"ok": False, "message": str(e), "removed": 0}


def _ec62_v52_download_alarm_log(self, kind="txt"):
    try:
        kind = str(kind or "txt").lower()
        files = _ec62_v52_alarm_files(self)
        if kind in ("csv", "excel"):
            paths = files["csv"]
            ctype = "text/csv; charset=utf-8"
        elif kind in ("json", "jsonl"):
            paths = files["jsonl"]
            ctype = "application/json; charset=utf-8"
        else:
            paths = files["txt"]
            ctype = "text/plain; charset=utf-8"
        if not paths:
            return None, b"No log file", "text/plain; charset=utf-8"
        path = paths[-1]
        with open(path, "rb") as f:
            data = f.read()
        return os.path.basename(path), data, ctype
    except Exception as e:
        try: self.write_error_log(f"v52 download alarm log error: {e}")
        except Exception: pass
        return None, str(e).encode("utf-8"), "text/plain; charset=utf-8"


_ORIG_WEB_HTML_V52 = E62GUI._web_html

def _ec62_v52_web_html(self):
    html = _ORIG_WEB_HTML_V52(self)
    html = html.replace("<title>EC62 Web V5.0H Alarm History</title>", "<title>EC62 Web V5.0H Alarm History</title>")
    html = html.replace("EC62 Web V5.0H Alarm History", "EC62 Web V5.0H Alarm History")
    html = html.replace(".histtable{width:100%;border-collapse:collapse;font-size:13px}", ".histtable{width:100%;border-collapse:collapse;font-size:13px}")
    # 在 Alarm History 區塊加入管理按鈕。若原區塊找不到，前端仍會用 JS 產生表格。
    html = html.replace("<div id=\"histRows\"></div>", "<div class=\"notify-actions\"><button onclick=\"loadAlarmHistory()\">Refresh / 重新整理</button><button onclick=\"downloadLog('txt')\">Download TXT</button><button onclick=\"downloadLog('csv')\">Download CSV</button><button onclick=\"clearHistory()\">Clear History / 清除歷史</button><button onclick=\"deleteAllAlarms()\" style=\"background:#991b1b\">Delete All / 全部刪除</button></div><div id=\"histRows\"></div>")
    old = """async function loadAlarmHistory(){
  try{
    const d=await api('/api/alarm_history?limit=100');
    const sec=document.getElementById('alarmHistory'), box=document.getElementById('histRows');
    if(sec)sec.style.display='block';
    const rows=d.rows||[];
    if(!rows.length){if(box)box.innerHTML='No Active Alarm / 目前無未解除警報'; return;}
    if(box)box.innerHTML='<table class="histtable"><thead><tr><th>Time</th><th>CH</th><th>Event</th><th>PV</th><th>Operator</th><th>Reason</th></tr></thead><tbody>'+rows.slice(0,100).map(r=>`<tr><td>${r.time||''}</td><td>${r.channel||''}</td><td>${r.event||''}</td><td>${r.value??'--'}</td><td>${r.operator||''}</td><td>${r.reason||''}</td></tr>`).join('')+'</tbody></table>';
  }catch(e){}
}
"""
    new = """function esc(s){return String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[m]));}
function canAdmin(){return ec62Role==='administrator'||ec62Role==='admin';}
function canOperator(){return canAdmin()||ec62Role==='operator';}
async function deleteAlarmRow(key,uid,time,event){
  if(!canAdmin()){alert(webLang==='zh'?'只有管理者可以刪除':'Admin only can delete');return;}
  if(!confirm(webLang==='zh'?'確定要刪除這筆警報紀錄嗎？':'Are you sure you want to delete this alarm record?'))return;
  const d=await postJson('/api/delete_alarm',{mode:'one',key,uid,time,event}); alert(d.message||'OK'); await loadAlarmHistory(); await load();
}
async function deleteAllAlarms(){
  if(!canAdmin()){alert(webLang==='zh'?'只有管理者可以全部刪除':'Admin only can delete all');return;}
  if(!confirm(webLang==='zh'?'確定要刪除全部警報紀錄嗎？':'Delete all alarm records?'))return;
  const d=await postJson('/api/delete_alarm',{mode:'all'}); alert(d.message||'OK'); await loadAlarmHistory(); await load();
}
async function clearHistory(){
  if(!canAdmin()){alert(webLang==='zh'?'只有管理者可以清除歷史':'Admin only can clear history');return;}
  if(!confirm(webLang==='zh'?'清除已完成歷史紀錄，保留目前警報？':'Clear completed history and keep active alarms?'))return;
  const d=await postJson('/api/delete_alarm',{mode:'history'}); alert(d.message||'OK'); await loadAlarmHistory();
}
function downloadLog(kind){
  const token=encodeURIComponent(ec62Token||'');
  window.open('/api/download_alarm_log?type='+encodeURIComponent(kind||'txt')+'&token='+token,'_blank');
}
async function loadAlarmHistory(){
  try{
    const d=await api('/api/alarm_history?limit=300');
    const sec=document.getElementById('alarmHistory'), box=document.getElementById('histRows');
    if(sec)sec.style.display='block';
    const rows=d.rows||[];
    if(!rows.length){if(box)box.innerHTML='No Alarm History / 目前無警報紀錄'; return;}
    if(box)box.innerHTML='<table class="histtable"><thead><tr><th>Time</th><th>CH</th><th>Event</th><th>PV</th><th>Operator</th><th>Reason</th><th>Action</th></tr></thead><tbody>'+rows.slice(0,300).map(r=>{
      const uid=String(r.channel||'').replace(/[^0-9]/g,'')||'';
      const recBtn=canOperator()?`<button class="smallbtn" onclick="manualRecovery('${uid}')">${webLang==='zh'?'解除':'Recovery'}</button>`:'';
      const delBtn=canAdmin()?`<button class="smallbtn orange" onclick="deleteAlarmRow('${esc(r.key)}','${esc(uid)}','${esc(r.time)}','${esc(r.event)}')">${webLang==='zh'?'刪除':'Delete'}</button>`:'';
      return `<tr><td>${esc(r.time)}</td><td>${esc(r.channel)}</td><td>${esc(r.event)}</td><td>${esc(r.value??'--')}</td><td>${esc(r.operator)}</td><td>${esc(r.reason)}</td><td>${recBtn} ${delBtn}</td></tr>`;
    }).join('')+'</tbody></table>';
  }catch(e){const box=document.getElementById('histRows'); if(box)box.innerHTML='Alarm History Error: '+e;}
}
"""
    if old in html:
        html = html.replace(old, new)
    else:
        html = html.replace("async function load(){", new + "\nasync function load(){")
    html = html.replace("if(d.can_operator){loadAlarmHistory();}", "loadAlarmHistory();")
    html = html.replace("document.title=d.title||'EC62 Web V5.0H Alarm History'; document.getElementById('title').textContent=d.title||'EC62 Web V5.0H Alarm History';", "document.title=d.title||'EC62 Web V5.0H Alarm History'; document.getElementById('title').textContent=d.title||'EC62 Web V5.0H Alarm History';")
    return html


def _ec62_v52_start_web_server(self):
    if self.web_server is not None:
        return
    app = self
    class EC62WebHandler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args): return
        def _send(self, code, content, ctype="text/html; charset=utf-8", filename=None):
            data = content.encode("utf-8") if isinstance(content, str) else content
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers(); self.wfile.write(data)
        def _json(self, obj, code=200): self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")
        def _parse_query(self, parsed):
            q={}
            try:
                for part in (parsed.query or "").split("&"):
                    if not part: continue
                    k,v = part.split("=",1) if "=" in part else (part,"")
                    from urllib.parse import unquote_plus
                    q[unquote_plus(k)] = unquote_plus(v)
            except Exception: pass
            return q
        def _token(self, data=None, query=None): return str(self.headers.get("X-EC62-Token", "") or (data or {}).get("token", "") or (query or {}).get("token", ""))
        def _role_user(self, data=None, query=None): return app.get_web_session_role(self._token(data, query))
        def _check(self, action, data=None, query=None):
            role,user = self._role_user(data, query)
            if not _ec62_v52_can(role, action):
                self._json({"ok":False,"message":"權限不足 / Permission denied","role":role}); return False, role, user
            return True, role, user
        def do_POST(self):
            try:
                parsed=urlparse(self.path); path=parsed.path
                try:
                    length=int(self.headers.get("Content-Length","0") or 0); raw=self.rfile.read(length) if length>0 else b"{}"; data=json.loads(raw.decode("utf-8") or "{}")
                except Exception: data={}
                if path == "/api/login": self._json(app.web_login(data)); return
                if path == "/api/save_notify":
                    ok,role,user=self._check("admin_config",data=data)
                    if not ok: return
                    old=app.is_unlocked
                    try: app.is_unlocked=True; self._json(_ORIG_WEB_SAVE_NOTIFY(app,data))
                    finally: app.is_unlocked=old
                    return
                if path == "/api/test_notify":
                    ok,role,user=self._check("test_notify",data=data)
                    if not ok: return
                    old=app.is_unlocked
                    try: app.is_unlocked=True; self._json(_ORIG_WEB_TEST_NOTIFY(app,str(data.get("target","all"))))
                    finally: app.is_unlocked=old
                    return
                if path == "/api/manual_recovery":
                    ok,role,user=self._check("alarm_recovery",data=data)
                    if not ok: return
                    old_unlocked, old_user, old_role = app.is_unlocked, getattr(app,"current_user","guest"), getattr(app,"current_role","guest")
                    try:
                        app.is_unlocked=True; app.current_user=user; app.current_role=role; self._json(_ORIG_WEB_MANUAL_RECOVERY(app,data))
                    finally:
                        app.is_unlocked, app.current_user, app.current_role = old_unlocked, old_user, old_role
                    return
                if path == "/api/delete_alarm":
                    ok,role,user=self._check("delete_alarm",data=data)
                    if not ok: return
                    self._json(app.web_delete_alarm(data)); return
                self._send(404,"Not Found","text/plain; charset=utf-8")
            except Exception as e:
                app.write_error_log(f"web post error: {e}"); self._send(500,"Web Error","text/plain; charset=utf-8")
        def do_GET(self):
            try:
                parsed=urlparse(self.path); path=parsed.path; query=self._parse_query(parsed)
                if path in ("/","/index.html"): self._send(200,app._web_html()); return
                if path == "/api/data":
                    role,user=self._role_user(query=query); snap=_ORIG_GET_WEB_SNAPSHOT(app)
                    snap["title"] = "EC62 Web V5.0H Alarm History"
                    snap["web_role"]=role; snap["web_user"]=user; snap["web_role_name"]=_ec62_v50_role_name(role, getattr(app, "language", "zh")); snap["can_admin"]=_ec62_v52_can(role,"admin_config"); snap["can_operator"]=_ec62_v52_can(role,"alarm_recovery"); snap["settings_unlocked"]=bool(snap["can_admin"])
                    if not snap["can_admin"]: snap["notify"]=None; snap["alarm_audit"]=None; snap["lan_url"]=None; snap["lan_urls"]=[]; snap["local_url"]=None
                    self._json(snap); return
                if path == "/api/clear_minmax":
                    ok,role,user=self._check("clear_minmax",query=query)
                    if not ok: return
                    self._json(app.web_clear_minmax(query.get("uid","all"))); return
                if path == "/api/set_limits":
                    ok,role,user=self._check("set_limits",query=query)
                    if not ok: return
                    self._json(app.web_set_alarm_limits(query.get("uid","1"),query.get("lo",""),query.get("hi",""))); return
                if path == "/api/set_language": self._json(app.web_set_language(query.get("lang","zh"))); return
                if path == "/api/alarm_history":
                    ok,role,user=self._check("alarm_history",query=query)
                    if not ok: return
                    self._json(app.web_alarm_history(query.get("limit","300"))); return
                if path == "/api/download_alarm_log":
                    ok,role,user=self._check("download_log",query=query)
                    if not ok: return
                    fname,data,ctype = app.web_download_alarm_log(query.get("type","txt"))
                    self._send(200, data, ctype, filename=fname or "EC62_Alarm_Log.txt"); return
                if path == "/manifest.json": self._send(200, app._web_manifest(), "application/manifest+json; charset=utf-8"); return
                self._send(404,"Not Found","text/plain; charset=utf-8")
            except Exception as e:
                app.write_error_log(f"web request error: {e}"); self._send(500,"Web Error","text/plain; charset=utf-8")
    try:
        self.web_server = ThreadingHTTPServer(("0.0.0.0", int(self.web_port)), EC62WebHandler)
        self.web_thread = threading.Thread(target=self.web_server.serve_forever, daemon=True); self.web_thread.start(); self.update_lan_url_display(); self.set_status(f"🌐 Web V5.0C 已啟動 0.0.0.0:{self.web_port}", "green"); self.audit("WEB_START_V50C", "0.0.0.0:"+str(self.web_port))
    except OSError as e:
        self.web_server=None; self.write_error_log(f"start web server failed port={self.web_port}: {e}"); self.set_status(f"❌ Web Port {self.web_port} 無法啟動：{e}", "red")


E62GUI.web_alarm_history = _ec62_v52_web_alarm_history
E62GUI.web_delete_alarm = _ec62_v52_web_delete_alarm
E62GUI.web_download_alarm_log = _ec62_v52_download_alarm_log
E62GUI._web_html = _ec62_v52_web_html
E62GUI.start_web_server = _ec62_v52_start_web_server


# =========================================================
# V5.0 Operator 標準化
# - GUI 顯示：admin(管理者) / operator(操作者) / guest(測試者)
# - English 顯示：admin(Admin) / operator(Operator) / guest(Guest)
# - Config / Alarm History 永遠只存：admin / operator / guest
# - Web 設定頁 Operator 改成下拉選單，option value 固定為代碼
# =========================================================
_EC62_OPERATOR_ITEMS = (
    ("admin", "admin(管理者)", "admin(Admin)"),
    ("operator", "operator(操作者)", "operator(Operator)"),
    ("guest", "guest(測試者)", "guest(Guest)"),
)


def _ec62_operator_language(self):
    try:
        lang = str(getattr(self, "language", "zh") or "zh").strip().lower()
        return "en" if lang.startswith("en") else "zh"
    except Exception:
        return "zh"


def _ec62_operator_to_code(value):
    """把 GUI / Web 顯示文字與舊版文字統一轉成 role code。"""
    t = str(value or "").strip().lower()
    if not t:
        return "admin"
    mapping = {
        "admin": "admin", "administrator": "admin", "system": "admin",
        "管理者": "admin", "記錄人": "admin", "紀錄人": "admin",
        "admin(管理者)": "admin", "admin(admin)": "admin", "admin（管理者）": "admin", "admin（admin）": "admin",
        "operator": "operator", "op": "operator", "操作員": "operator", "操作者": "operator",
        "operator(操作者)": "operator", "operator(operator)": "operator", "operator（操作者）": "operator", "operator（operator）": "operator",
        "guest": "guest", "visitor": "guest", "test": "guest", "tester": "guest", "quest": "guest",
        "訪客": "guest", "測試者": "guest", "測試員": "guest",
        "guest(測試者)": "guest", "guest(guest)": "guest", "guest（測試者）": "guest", "guest（guest）": "guest",
    }
    return mapping.get(t, "admin")


def _ec62_operator_display(self, code=None):
    """依語言把 role code 顯示成使用者看得懂的文字。"""
    c = _ec62_operator_to_code(code if code is not None else getattr(self, "alarm_operator", "admin"))
    lang = _ec62_operator_language(self)
    for item_code, zh, en in _EC62_OPERATOR_ITEMS:
        if item_code == c:
            return en if lang == "en" else zh
    return "admin(Admin)" if lang == "en" else "admin(管理者)"


def _ec62_operator_values(self):
    return [_ec62_operator_display(self, code) for code, _zh, _en in _EC62_OPERATOR_ITEMS]


def _ec62_update_operator_combobox_display(self):
    """同步 GUI Operator 下拉：顯示文字 + 內部 role code。"""
    try:
        try:
            current = self.alarm_operator_var.get()
        except Exception:
            current = getattr(self, "alarm_operator", "admin")
        code = _ec62_operator_to_code(current)
        self.alarm_operator = code
        display = _ec62_operator_display(self, code)
        try:
            self.alarm_operator_var.set(display)
        except Exception:
            pass
        cb = getattr(self, "operator_cb", None)
        if cb is not None:
            try:
                cb.configure(values=_ec62_operator_values(self), state="readonly")
                cb.set(display)
            except Exception:
                pass
    except Exception as e:
        try:
            self.write_error_log(f"V5.0 Final update operator combobox error: {e}")
        except Exception:
            pass


def _ec62_alarm_audit_defaults_final(self):
    """Config / Alarm History 固定回傳 admin / operator / guest 代碼。"""
    try:
        raw_op = self.alarm_operator_var.get()
    except Exception:
        raw_op = getattr(self, "alarm_operator", "admin")
    op_code = _ec62_operator_to_code(raw_op)
    try:
        reason = str(self.alarm_reason_var.get() or "").strip()
    except Exception:
        reason = str(getattr(self, "alarm_reason", "") or "").strip()
    if not reason:
        reason = "Temperature Returned to Normal"
    self.alarm_operator = op_code
    self.alarm_reason = reason
    return op_code, reason


def _ec62_load_config_operator_final(self):
    _ORIG_LOAD_CONFIG_V51_GUI_OPERATOR(self)
    try:
        # 舊版可能存 System/Admin/管理者/admin(管理者)，載入後一律轉成 code 再顯示。
        code = _ec62_operator_to_code(getattr(self, "alarm_operator", "admin"))
        try:
            code = _ec62_operator_to_code(self.alarm_operator_var.get())
        except Exception:
            pass
        self.alarm_operator = code
        _ec62_update_operator_combobox_display(self)
    except Exception:
        pass


def _ec62_apply_language_operator_final(self):
    _ORIG_APPLY_LANGUAGE_V51_GUI_OPERATOR(self)
    _ec62_update_operator_combobox_display(self)


_ORIG_WEB_HTML_V50C_FINAL = E62GUI._web_html

def _ec62_web_html_v50c_final(self):
    html = _ORIG_WEB_HTML_V50C_FINAL(self)
    try:
        zh_select = (
            '<label>Operator / 紀錄人'
            '<select id="alarm_operator">'
            '<option value="admin">admin(管理者)</option>'
            '<option value="operator">operator(操作者)</option>'
            '<option value="guest">guest(測試者)</option>'
            '</select></label>'
        )
        # 取代原本文字輸入框，Web 端顯示完整名稱，但送出 value 永遠是 code。
        html = html.replace(
            '<label>Operator / 紀錄人<input id="alarm_operator" placeholder="System"></label>',
            zh_select,
        )
        # V5.0C Final：登入欄提示也改成三種角色。
        html = html.replace('placeholder="admin / operator"', 'placeholder="admin / operator / guest"')
    except Exception:
        pass
    return html


# 套用最終版 monkey patch。
E62GUI._ec62_update_operator_combobox_display = _ec62_update_operator_combobox_display
E62GUI._alarm_audit_defaults = _ec62_alarm_audit_defaults_final
E62GUI.apply_language = _ec62_apply_language_operator_final
E62GUI.load_config = _ec62_load_config_operator_final
E62GUI._web_html = _ec62_web_html_v50c_final


# =========================================================
# V5.0C Final Cleanup
# - 預設帳號包含 admin / operator / guest
# - GUI / Web 顯示 admin(管理者)、operator(操作者)、guest(測試者)
# - Config / Alarm History 只保存 admin / operator / guest 代碼
# - Web Logout 清除帳號與密碼欄位
# - Web Alarm History Admin 才可刪除 / 全部刪除 / 下載
# =========================================================

def _ec62_v50c_default_users(admin_password=None):
    return {
        "admin": {"password": str(admin_password or DEFAULT_PASSWORD), "role": "administrator", "display": "Admin"},
        "operator": {"password": "1234", "role": "operator", "display": "Operator"},
        "guest": {"password": "", "role": "guest", "display": "Guest"},
    }

# 覆蓋 V5.0A 的 default users；_v50_init / load_config 會在執行時讀取這個全域名稱。
_ec62_v50_default_users = _ec62_v50c_default_users


def _ec62_v50c_user_keys(self, include_guest=True):
    users = getattr(self, "users", {}) or {}
    keys = []
    for k in ("admin", "operator", "guest"):
        if k in users and (include_guest or k != "guest"):
            keys.append(k)
    for k in users.keys():
        kk = str(k).strip().lower()
        if kk not in keys and (include_guest or kk != "guest"):
            keys.append(kk)
    return keys or (["admin", "operator", "guest"] if include_guest else ["admin", "operator"])


def _ec62_v50c_role_name(role, lang="en"):
    r = _ec62_v50_norm_role(role)
    is_zh = str(lang or "").lower().startswith("zh") or str(lang or "") in ("中文", "cn")
    if is_zh:
        return "管理者" if r == "administrator" else ("操作者" if r == "operator" else "測試者")
    return "Admin" if r == "administrator" else ("Operator" if r == "operator" else "Guest")

_ec62_v50_role_name = _ec62_v50c_role_name


def _ec62_v50c_can(role, action):
    r = _ec62_v50_norm_role(role)
    if r == "administrator":
        return True
    if r == "operator":
        return action in {"alarm_recovery", "clear_minmax", "set_limits", "test_notify", "reconnect", "view", "alarm_history", "download_log"}
    return action in {"view", "alarm_history"}

_ec62_v50_can = _ec62_v50c_can
_ec62_v52_can = _ec62_v50c_can


def _ec62_v50c_norm_users_after_load(self):
    try:
        base = _ec62_v50c_default_users(getattr(self, "password", DEFAULT_PASSWORD))
        old = getattr(self, "users", {}) or {}
        for k, u in old.items():
            kk = str(k).strip().lower()
            if not kk:
                continue
            if isinstance(u, dict):
                base[kk] = {
                    "password": str(u.get("password", "")),
                    "role": _ec62_v50_norm_role(u.get("role", kk)),
                    "display": str(u.get("display", kk.title())),
                }
        # guest 固定存在，無密碼也可只讀登入。
        base.setdefault("guest", {"password": "", "role": "guest", "display": "Guest"})
        self.users = base
    except Exception:
        pass


_ORIG_LOAD_CONFIG_V50C_CLEANUP = E62GUI.load_config

def _ec62_load_config_v50c_cleanup(self):
    _ORIG_LOAD_CONFIG_V50C_CLEANUP(self)
    _ec62_v50c_norm_users_after_load(self)
    try:
        code = _ec62_operator_to_code(getattr(self, "alarm_operator", "admin"))
        self.alarm_operator = code
        _ec62_update_operator_combobox_display(self)
    except Exception:
        pass

E62GUI.load_config = _ec62_load_config_v50c_cleanup


_ORIG_SAVE_USERS_V50C_CLEANUP = globals().get('_v50_save_users_into_config')

def _v50_save_users_into_config(self):
    _ec62_v50c_norm_users_after_load(self)
    cfg = {}
    try:
        if os.path.exists(self.config_path):
            with open(self.config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or {}
        cfg["users"] = getattr(self, "users", _ec62_v50c_default_users(getattr(self, "password", DEFAULT_PASSWORD)))
        if "admin" in cfg["users"]:
            cfg["password"] = cfg["users"]["admin"].get("password", getattr(self, "password", DEFAULT_PASSWORD))
        cfg.setdefault("web", {})["alarm_audit"] = {"operator": self._alarm_audit_defaults()[0], "reason": self._alarm_audit_defaults()[1]}
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        try: self.write_error_log(f"v5.0c save users error: {e}")
        except Exception: pass
        return False


_ORIG_WEB_HTML_V50C_CLEANUP = E62GUI._web_html

def _ec62_web_html_v50c_cleanup(self):
    html = _ORIG_WEB_HTML_V50C_CLEANUP(self)
    # 登入提示三帳號，Logout 清空欄位。
    html = html.replace('placeholder="admin / operator"', 'placeholder="admin / operator / guest"')
    html = html.replace('placeholder="admin / operator / guest / guest"', 'placeholder="admin / operator / guest"')
    html = html.replace('No Active Alarm / 目前無未解除警報', 'No Alarm History / 目前無警報紀錄')
    # 若前端 webLogout 舊版沒有清空，補強清空帳號密碼。
    if "function webLogout()" in html and "if(u)u.value=''" not in html:
        html = html.replace(
            "function webLogout(){ec62Token=''; ec62Role='guest'; localStorage.removeItem('ec62_token'); localStorage.removeItem('ec62_role');",
            "function webLogout(){ec62Token=''; ec62Role='guest'; localStorage.removeItem('ec62_token'); localStorage.removeItem('ec62_role'); const u=document.getElementById('loginUser'); const p=document.getElementById('loginPass'); if(u)u.value=''; if(p)p.value='';"
        )
    return html

E62GUI._web_html = _ec62_web_html_v50c_cleanup


# 顯示標題統一成 V5.0C。
_ORIG_APPLY_LANGUAGE_V50C_TITLE = E62GUI.apply_language

def _ec62_apply_language_v50c_title(self):
    _ORIG_APPLY_LANGUAGE_V50C_TITLE(self)
    try:
        self.root.title("E62/C62 RTU V5.2G Trend Ribbon Top Small")
    except Exception:
        pass

E62GUI.apply_language = _ec62_apply_language_v50c_title



# =========================================================
# V5.1A Multi-User Channel Permission
# - Admin      : all CH / all trend / all alarm history / config / delete
# - Operator1  : CH01~CH05 dashboard/trend/alarm recovery only
# - Operator2  : CH06~CH08 dashboard/trend/alarm recovery only
# - Guest      : specified CH read-only; no trend, no recovery, no config, no delete
# - Web Dashboard / JSON API / Alarm History all filter by login user
# =========================================================

def _ec62_v51a_default_permissions():
    return {
        "admin": {"channels": "all", "dashboard": True, "trend": True, "alarm_history": True, "alarm_recovery": True, "config": True, "delete": True, "download_log": True},
        "operator1": {"channels": [1, 2, 3, 4, 5], "dashboard": True, "trend": True, "alarm_history": True, "alarm_recovery": True, "config": False, "delete": False, "download_log": False},
        "operator2": {"channels": [6, 7, 8], "dashboard": True, "trend": True, "alarm_history": True, "alarm_recovery": True, "config": False, "delete": False, "download_log": False},
        "guest": {"channels": [1], "dashboard": True, "trend": False, "alarm_history": True, "alarm_recovery": False, "config": False, "delete": False, "download_log": False},
    }


def _ec62_v51a_default_users(admin_password=None):
    return {
        "admin": {"password": str(admin_password or DEFAULT_PASSWORD), "role": "administrator", "display": "Admin"},
        "operator1": {"password": "1234", "role": "operator1", "display": "Operator1"},
        "operator2": {"password": "1234", "role": "operator2", "display": "Operator2"},
        "guest": {"password": "", "role": "guest", "display": "Guest"},
    }

# 覆蓋舊版預設帳號，保留舊 operator 帳號時會在 load_config 轉成 operator1。
_ec62_v50_default_users = _ec62_v51a_default_users


def _ec62_v51a_norm_role(role):
    r = str(role or "guest").strip().lower()
    if r in ("admin", "administrator", "管理者"):
        return "administrator"
    if r in ("operator1", "operator_1", "operator-1", "op1", "操作者1", "操作員1"):
        return "operator1"
    if r in ("operator2", "operator_2", "operator-2", "op2", "操作者2", "操作員2"):
        return "operator2"
    if r in ("op", "operator", "操作員", "操作者"):
        return "operator1"
    return "guest"

_ec62_v50_norm_role = _ec62_v51a_norm_role


def _ec62_v51a_role_name(role, lang="en"):
    r = _ec62_v51a_norm_role(role)
    is_zh = str(lang or "").lower().startswith("zh") or str(lang or "") in ("中文", "cn")
    if is_zh:
        return "管理者" if r == "administrator" else ("操作者1" if r == "operator1" else ("操作者2" if r == "operator2" else "測試者"))
    return "Admin" if r == "administrator" else ("Operator1" if r == "operator1" else ("Operator2" if r == "operator2" else "Guest"))

_ec62_v50_role_name = _ec62_v51a_role_name


def _ec62_v51a_permission_key(role, username=None):
    u = str(username or "").strip().lower()
    if u in ("admin", "operator1", "operator2", "guest"):
        return u
    r = _ec62_v51a_norm_role(role)
    if r == "administrator":
        return "admin"
    if r == "operator2":
        return "operator2"
    if r == "operator1":
        return "operator1"
    return "guest"


def _ec62_v51a_channels_from_perm(self, perm):
    try:
        ch_count = int(getattr(self, "channel_count", MAX_CHANNELS) or MAX_CHANNELS)
    except Exception:
        ch_count = MAX_CHANNELS
    active = list(range(1, max(1, min(MAX_CHANNELS, ch_count)) + 1))
    channels = (perm or {}).get("channels", [1])
    if channels == "all":
        return active
    out = []
    try:
        for x in channels:
            try:
                uid = int(x)
                if uid in active and uid not in out:
                    out.append(uid)
            except Exception:
                pass
    except Exception:
        out = [1]
    return out or [1]


def _ec62_v51a_get_permission(self, username=None, role=None):
    perms = getattr(self, "user_permissions", None) or _ec62_v51a_default_permissions()
    key = _ec62_v51a_permission_key(role, username)
    base = dict(_ec62_v51a_default_permissions().get(key, _ec62_v51a_default_permissions()["guest"]))
    custom = perms.get(key, {}) if isinstance(perms, dict) else {}
    if isinstance(custom, dict):
        base.update(custom)
    base["channels"] = _ec62_v51a_channels_from_perm(self, base)
    return base


def _ec62_v51a_can_user(self, username=None, role=None, action="view", uid=None):
    perm = _ec62_v51a_get_permission(self, username, role)
    action_map = {
        "admin_config": "config",
        "delete_alarm": "delete",
        "download_log": "download_log",
        "alarm_recovery": "alarm_recovery",
        "alarm_history": "alarm_history",
        "trend": "trend",
        "view": "dashboard",
        "clear_minmax": "config",
        "set_limits": "config",
        "test_notify": "config",
        "reconnect": "config",
    }
    flag = action_map.get(str(action), str(action))
    if not bool(perm.get(flag, False)):
        return False
    if uid not in (None, "", "all"):
        try:
            return int(uid) in set(perm.get("channels", []))
        except Exception:
            return False
    return True


def _ec62_v51a_can(role, action):
    return _ec62_v51a_can_user(None, None, role, action)

_ec62_v50_can = _ec62_v51a_can
_ec62_v52_can = _ec62_v51a_can


_ORIG_AUTH_V51A = E62GUI.authenticate_user
_ORIG_LOAD_CONFIG_V51A_PERM = E62GUI.load_config
_ORIG_SAVE_CONFIG_V51A_PERM = E62GUI.save_config
_ORIG_SAVE_PW_ONLY_V51A_PERM = E62GUI.save_config_silent_password_only
_ORIG_CREATE_SESSION_V51A = E62GUI.create_web_session
_ORIG_GET_SESSION_V51A = E62GUI.get_web_session_role
_ORIG_WEB_HTML_V51A_PERM = E62GUI._web_html
_ORIG_WEB_DELETE_ALARM_V51A = getattr(E62GUI, "web_delete_alarm", None)
_ORIG_DOWNLOAD_ALARM_LOG_V51A = getattr(E62GUI, "web_download_alarm_log", None)


def _ec62_v51a_authenticate(self, username, password, allow_guest=True):
    uname = str(username or "guest").strip().lower()
    pwd = str(password or "")
    if uname == "operator":
        uname = "operator1"
    users = getattr(self, "users", {}) or {}
    user = users.get(uname)
    if user is None:
        for k, u in users.items():
            if str(u.get("display", "")).strip().lower() == uname:
                uname, user = str(k).strip().lower(), u
                break
    if user is None:
        return None, None
    role = _ec62_v51a_norm_role(user.get("role", uname))
    if role == "guest" and allow_guest:
        return uname, role
    if pwd == str(user.get("password", "")):
        return uname, role
    return None, None


def _ec62_v51a_normalize_users_permissions(self):
    try:
        old = getattr(self, "users", {}) or {}
        base = _ec62_v51a_default_users(getattr(self, "password", DEFAULT_PASSWORD))
        for k, u in old.items():
            kk = str(k).strip().lower()
            if kk == "operator":
                kk = "operator1"
            if not kk or not isinstance(u, dict):
                continue
            base[kk] = {
                "password": str(u.get("password", base.get(kk, {}).get("password", ""))),
                "role": _ec62_v51a_norm_role(u.get("role", kk)),
                "display": str(u.get("display", kk.title())),
            }
        base["operator1"]["role"] = "operator1"
        base["operator2"]["role"] = "operator2"
        base["guest"]["role"] = "guest"
        self.users = base
        self.password = self.users.get("admin", {}).get("password") or getattr(self, "password", DEFAULT_PASSWORD)
    except Exception as e:
        try: self.write_error_log(f"V5.1A normalize users error: {e}")
        except Exception: pass


def _ec62_v51a_load_config(self):
    _ORIG_LOAD_CONFIG_V51A_PERM(self)
    try:
        cfg = {}
        if os.path.exists(self.config_path):
            with open(self.config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or {}
        perms = _ec62_v51a_default_permissions()
        custom = cfg.get("user_permissions", {})
        if isinstance(custom, dict):
            for k, v in custom.items():
                key = _ec62_v51a_permission_key(k, k)
                if isinstance(v, dict):
                    perms.setdefault(key, {}).update(v)
        self.user_permissions = perms
        _ec62_v51a_normalize_users_permissions(self)
    except Exception as e:
        try: self.write_error_log(f"V5.1A load permission error: {e}")
        except Exception: pass


def _ec62_v51a_save_users_permissions(self):
    cfg = {}
    try:
        if os.path.exists(self.config_path):
            with open(self.config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or {}
        _ec62_v51a_normalize_users_permissions(self)
        cfg["users"] = getattr(self, "users", _ec62_v51a_default_users(getattr(self, "password", DEFAULT_PASSWORD)))
        cfg["user_permissions"] = getattr(self, "user_permissions", _ec62_v51a_default_permissions())
        if "admin" in cfg["users"]:
            cfg["password"] = cfg["users"]["admin"].get("password", getattr(self, "password", DEFAULT_PASSWORD))
        try:
            cfg.setdefault("web", {})["alarm_audit"] = {"operator": self._alarm_audit_defaults()[0], "reason": self._alarm_audit_defaults()[1]}
        except Exception:
            pass
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        try: self.write_error_log(f"V5.1A save users permission error: {e}")
        except Exception: pass
        return False


def _ec62_v51a_save_config(self):
    if not _ec62_v51a_can_user(self, getattr(self, "current_user", "guest"), getattr(self, "current_role", "guest"), "admin_config"):
        try: messagebox.showwarning(_ec62_v50_text(self, "提醒", "Notice"), _ec62_v50_text(self, "🔒 只有管理者可以儲存系統設定", "🔒 Admin only can save system settings"))
        except Exception: pass
        return
    _ORIG_SAVE_CONFIG_V51A_PERM(self)
    _ec62_v51a_save_users_permissions(self)


def _ec62_v51a_save_config_silent_password_only(self):
    try:
        users = getattr(self, "users", _ec62_v51a_default_users(getattr(self, "password", DEFAULT_PASSWORD)))
        users.setdefault("admin", {"role":"administrator", "display":"Admin", "password": DEFAULT_PASSWORD})
        users["admin"]["password"] = str(getattr(self, "password", DEFAULT_PASSWORD))
        self.users = users
        _ec62_v51a_save_users_permissions(self)
    except Exception:
        _ORIG_SAVE_PW_ONLY_V51A_PERM(self)


def _ec62_v51a_create_session(self, username, role):
    import secrets
    token = secrets.token_urlsafe(24)
    username = str(username or "guest").strip().lower()
    if username == "operator": username = "operator1"
    role = _ec62_v51a_norm_role(role)
    self.web_sessions[token] = {"username": username, "role": role, "time": time.time()}
    return token


def _ec62_v51a_get_session_role(self, token):
    sess = (getattr(self, "web_sessions", {}) or {}).get(str(token), {}) if token else {}
    return sess.get("role", "guest"), sess.get("username", "guest")


def _ec62_v51a_web_login(self, data):
    uname, role = self.authenticate_user((data or {}).get("username", ""), (data or {}).get("password", ""), allow_guest=True)
    if uname is None:
        return {"ok": False, "message": "登入失敗 / Login failed"}
    token = self.create_web_session(uname, role)
    lang = "zh" if str((data or {}).get("lang", "")).lower().startswith("zh") else "en"
    perm = _ec62_v51a_get_permission(self, uname, role)
    return {"ok": True, "message": "登入成功" if lang == "zh" else "Login successful", "token": token, "username": uname, "role": role, "role_name": _ec62_v51a_role_name(role, lang), "allowed_channels": perm.get("channels", []), "can_admin": bool(perm.get("config")), "can_delete": bool(perm.get("delete")), "can_trend": bool(perm.get("trend")), "can_recovery": bool(perm.get("alarm_recovery"))}


def _ec62_v51a_filter_snapshot(self, snap, username=None, role=None):
    try:
        perm = _ec62_v51a_get_permission(self, username, role)
        allowed = set(int(x) for x in perm.get("channels", []))
        filtered = []
        for c in list((snap or {}).get("channels", []) or []):
            try:
                uid = int(str(c.get("id", "0")).replace("CH", ""))
            except Exception:
                uid = 0
            if uid in allowed:
                filtered.append(c)
        snap["channels"] = filtered
        snap["allowed_channels"] = sorted(allowed)
        snap["can_admin"] = bool(perm.get("config"))
        snap["can_delete"] = bool(perm.get("delete"))
        snap["can_operator"] = bool(perm.get("alarm_recovery"))
        snap["can_recovery"] = bool(perm.get("alarm_recovery"))
        snap["can_trend"] = bool(perm.get("trend"))
        snap["can_alarm_history"] = bool(perm.get("alarm_history"))
        snap["settings_unlocked"] = bool(perm.get("config"))
        if not snap["can_admin"]:
            snap["notify"] = None
            snap["alarm_audit"] = {"operator": username or "guest", "reason": "Temperature Returned to Normal"}
            snap["lan_url"] = None
            snap["lan_urls"] = []
            snap["local_url"] = None
        return snap
    except Exception as e:
        try: self.write_error_log(f"V5.1A filter snapshot error: {e}")
        except Exception: pass
        return snap


def _ec62_v51a_filter_alarm_rows(self, rows, username=None, role=None):
    perm = _ec62_v51a_get_permission(self, username, role)
    allowed = set(int(x) for x in perm.get("channels", []))
    out = []
    for r in rows or []:
        try:
            uid = int(str(r.get("channel", "")).replace("CH", "").strip())
        except Exception:
            uid = 0
        if uid in allowed:
            out.append(r)
    return out


def _ec62_v51a_web_alarm_history_for(self, limit=300, username=None, role=None):
    if not _ec62_v51a_can_user(self, username, role, "alarm_history"):
        return {"ok": False, "message": "權限不足 / Permission denied", "rows": []}
    try:
        rows = self.read_alarm_event_history(limit)
        return {"ok": True, "rows": _ec62_v51a_filter_alarm_rows(self, rows, username, role)}
    except Exception as e:
        self.write_error_log(f"V5.1A alarm history error: {e}")
        return {"ok": False, "message": str(e), "rows": []}


def _ec62_v51a_web_html(self):
    html = _ORIG_WEB_HTML_V51A_PERM(self)
    html = html.replace("V5.0C", "V5.1A")
    html = html.replace("V5.0CC", "V5.1A")
    html = html.replace('placeholder="admin / operator / guest"', 'placeholder="admin / operator1 / operator2 / guest"')
    html = html.replace('placeholder="admin / operator"', 'placeholder="admin / operator1 / operator2 / guest"')
    html = html.replace("ec62Role='guest';", "ec62Role='guest';\nlet ec62User=localStorage.getItem('ec62_user')||'guest';")
    html = html.replace("localStorage.setItem('ec62_role',d.role||'guest');", "localStorage.setItem('ec62_role',d.role||'guest'); localStorage.setItem('ec62_user',d.username||'guest'); ec62User=d.username||'guest';")
    html = html.replace("localStorage.removeItem('ec62_role');", "localStorage.removeItem('ec62_role'); localStorage.removeItem('ec62_user'); ec62User='guest';")
    html = html.replace("function canOperator(){return canAdmin()||ec62Role==='operator';}", "function canOperator(){return canAdmin()||ec62Role==='operator1'||ec62Role==='operator2';}\nfunction canRecovery(){return canAdmin()||ec62Role==='operator1'||ec62Role==='operator2';}\nfunction canConfig(){return canAdmin();}\nfunction canTrend(){return canAdmin()||ec62Role==='operator1'||ec62Role==='operator2';}")
    html = html.replace("if(!canAdmin()){alert(webLang==='zh'?'只有管理者可以清除歷史':'Admin only can clear history');return;}", "if(!canAdmin()){alert(webLang==='zh'?'只有管理者可以清除歷史':'Admin only can clear history');return;}")
    html = html.replace("if(d.settings_unlocked){ if(notifySection)notifySection.style.display='block'; if(notifyLocked)notifyLocked.style.display='none'; }", "if(d.can_admin){ if(notifySection)notifySection.style.display='block'; if(notifyLocked)notifyLocked.style.display='none'; }")
    html = html.replace("if(d.settings_unlocked){loadAlarmHistory();}", "if(d.can_alarm_history!==false){loadAlarmHistory();}")
    html = html.replace("if(d.can_operator){loadAlarmHistory();}", "if(d.can_alarm_history!==false){loadAlarmHistory();}")
    html = html.replace("const recBtn=canOperator()?", "const recBtn=canRecovery()?")
    html = html.replace("${(bad||warn)?`<button class=\"smallbtn\" onclick=\"manualRecovery('${c.id}')\">解除記錄</button>`:''}", "${(bad||warn)&&d.can_recovery?`<button class=\"smallbtn\" onclick=\"manualRecovery('${c.id}')\">解除記錄</button>`:''}")
    html = html.replace("<div class=\"tools\"><button class=\"smallbtn orange\" onclick=\"clearMinMax('${c.id}')\">${T('清除')}</button><button class=\"smallbtn\" onclick=\"setLimit('${c.id}',${c.web_lo===null||c.web_lo===undefined?'null':JSON.stringify(c.web_lo)},${c.web_hi===null||c.web_hi===undefined?'null':JSON.stringify(c.web_hi)})\">${T('設定MAX/MIN')}</button>", "<div class=\"tools\">${d.can_admin?`<button class=\"smallbtn orange\" onclick=\"clearMinMax('${c.id}')\">${T('清除')}</button><button class=\"smallbtn\" onclick=\"setLimit('${c.id}',${c.web_lo===null||c.web_lo===undefined?'null':JSON.stringify(c.web_lo)},${c.web_hi===null||c.web_hi===undefined?'null':JSON.stringify(c.web_hi)})\">${T('設定MAX/MIN')}</button>`:''}")
    # 加入登入狀態顯示：帳號 + 角色 + 允許 CH。
    html = html.replace("(document.getElementById('loginState')||{}).textContent=(d.web_role_name||d.web_role||'Guest');", "(document.getElementById('loginState')||{}).textContent=(d.web_user||'guest')+' / '+(d.web_role_name||d.web_role||'Guest')+' / CH '+((d.allowed_channels||[]).join(','));")
    return html


def _ec62_v51a_start_web_server(self):
    if self.web_server is not None:
        return
    app = self
    class EC62WebHandler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args): return
        def _send(self, code, content, ctype="text/html; charset=utf-8", filename=None):
            data = content.encode("utf-8") if isinstance(content, str) else content
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers(); self.wfile.write(data)
        def _json(self, obj, code=200): self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")
        def _parse_query(self, parsed):
            q={}
            try:
                for part in (parsed.query or "").split("&"):
                    if not part: continue
                    k,v = part.split("=",1) if "=" in part else (part,"")
                    from urllib.parse import unquote_plus
                    q[unquote_plus(k)] = unquote_plus(v)
            except Exception: pass
            return q
        def _token(self, data=None, query=None): return str(self.headers.get("X-EC62-Token", "") or (data or {}).get("token", "") or (query or {}).get("token", ""))
        def _role_user(self, data=None, query=None): return app.get_web_session_role(self._token(data, query))
        def _check(self, action, uid=None, data=None, query=None):
            role,user = self._role_user(data, query)
            if not _ec62_v51a_can_user(app, user, role, action, uid):
                self._json({"ok":False,"message":"權限不足 / Permission denied","role":role,"user":user}); return False, role, user
            return True, role, user
        def do_POST(self):
            try:
                parsed=urlparse(self.path); path=parsed.path
                try:
                    length=int(self.headers.get("Content-Length","0") or 0); raw=self.rfile.read(length) if length>0 else b"{}"; data=json.loads(raw.decode("utf-8") or "{}")
                except Exception: data={}
                if path == "/api/login": self._json(app.web_login(data)); return
                if path == "/api/save_notify":
                    ok,role,user=self._check("admin_config",data=data)
                    if not ok: return
                    old=app.is_unlocked
                    try: app.is_unlocked=True; self._json(_ORIG_WEB_SAVE_NOTIFY(app,data))
                    finally: app.is_unlocked=old
                    return
                if path == "/api/test_notify":
                    ok,role,user=self._check("test_notify",data=data)
                    if not ok: return
                    old=app.is_unlocked
                    try: app.is_unlocked=True; self._json(_ORIG_WEB_TEST_NOTIFY(app,str(data.get("target","all"))))
                    finally: app.is_unlocked=old
                    return
                if path == "/api/manual_recovery":
                    uid = data.get("uid", "")
                    ok,role,user=self._check("alarm_recovery",uid=uid,data=data)
                    if not ok: return
                    old_unlocked, old_user, old_role = app.is_unlocked, getattr(app,"current_user","guest"), getattr(app,"current_role","guest")
                    try:
                        app.is_unlocked=True; app.current_user=user; app.current_role=role
                        self._json(_ORIG_WEB_MANUAL_RECOVERY(app,data))
                    finally:
                        app.is_unlocked, app.current_user, app.current_role = old_unlocked, old_user, old_role
                    return
                if path == "/api/delete_alarm":
                    ok,role,user=self._check("delete_alarm",data=data)
                    if not ok: return
                    self._json(app.web_delete_alarm(data)); return
                self._send(404,"Not Found","text/plain; charset=utf-8")
            except Exception as e:
                app.write_error_log(f"V5.1A web post error: {e}"); self._send(500,"Web Error","text/plain; charset=utf-8")
        def do_GET(self):
            try:
                parsed=urlparse(self.path); path=parsed.path; query=self._parse_query(parsed)
                if path in ("/","/index.html"): self._send(200,app._web_html()); return
                if path == "/api/data":
                    role,user=self._role_user(query=query)
                    snap=_ORIG_GET_WEB_SNAPSHOT(app)
                    snap["title"] = "EC62 Web V5.1A Permission"
                    snap["web_role"] = role
                    snap["web_user"] = user
                    snap["web_role_name"] = _ec62_v51a_role_name(role, getattr(app, "language", "zh"))
                    snap = _ec62_v51a_filter_snapshot(app, snap, user, role)
                    self._json(snap); return
                if path == "/api/clear_minmax":
                    uid=query.get("uid","all")
                    ok,role,user=self._check("clear_minmax",uid=None if uid=="all" else uid,query=query)
                    if not ok: return
                    self._json(app.web_clear_minmax(uid)); return
                if path == "/api/set_limits":
                    uid=query.get("uid","1")
                    ok,role,user=self._check("set_limits",uid=uid,query=query)
                    if not ok: return
                    self._json(app.web_set_alarm_limits(uid,query.get("lo",""),query.get("hi",""))); return
                if path == "/api/set_language": self._json(app.web_set_language(query.get("lang","zh"))); return
                if path == "/api/alarm_history":
                    ok,role,user=self._check("alarm_history",query=query)
                    if not ok: return
                    self._json(_ec62_v51a_web_alarm_history_for(app, query.get("limit","300"), user, role)); return
                if path == "/api/download_alarm_log":
                    ok,role,user=self._check("download_log",query=query)
                    if not ok: return
                    fname,data,ctype = app.web_download_alarm_log(query.get("type","txt"))
                    self._send(200, data, ctype, filename=fname or "EC62_Alarm_Log.txt"); return
                if path == "/manifest.json": self._send(200, app._web_manifest(), "application/manifest+json; charset=utf-8"); return
                self._send(404,"Not Found","text/plain; charset=utf-8")
            except Exception as e:
                app.write_error_log(f"V5.1A web request error: {e}"); self._send(500,"Web Error","text/plain; charset=utf-8")
    try:
        self.web_server = ThreadingHTTPServer(("0.0.0.0", int(self.web_port)), EC62WebHandler)
        self.web_thread = threading.Thread(target=self.web_server.serve_forever, daemon=True)
        self.web_thread.start()
        self.update_lan_url_display()
        self.set_status(f"🌐 Web V5.1A 權限版已啟動 0.0.0.0:{self.web_port}", "green")
        self.audit("WEB_START_V51A", "0.0.0.0:"+str(self.web_port))
    except OSError as e:
        self.web_server=None; self.write_error_log(f"start web server failed port={self.web_port}: {e}"); self.set_status(f"❌ Web Port {self.web_port} 無法啟動：{e}", "red")


# 套用 V5.1A 權限版 patch
E62GUI.authenticate_user = _ec62_v51a_authenticate
E62GUI.load_config = _ec62_v51a_load_config
E62GUI.save_config = _ec62_v51a_save_config
E62GUI.save_config_silent_password_only = _ec62_v51a_save_config_silent_password_only
E62GUI.create_web_session = _ec62_v51a_create_session
E62GUI.get_web_session_role = _ec62_v51a_get_session_role
E62GUI.web_login = _ec62_v51a_web_login
E62GUI._web_html = _ec62_v51a_web_html
E62GUI.start_web_server = _ec62_v51a_start_web_server
E62GUI._ec62_v51a_get_permission = _ec62_v51a_get_permission
E62GUI._ec62_v51a_can_user = _ec62_v51a_can_user

# =========================================================
# V5.1B Admin Account Permission Setting
# - Admin Web login 後顯示「帳號權限設定」
# - 可修改 Operator1~Operator3 / Guest 顯示名稱、密碼、CH 範圍
# =========================================================

def _ec62_v51b_norm_channels(value, fallback=None):
    if fallback is None:
        fallback = [1]
    if value == "all":
        return "all"
    out = []
    try:
        if isinstance(value, (list, tuple, set)):
            parts = list(value)
        else:
            s = str(value or "").upper().replace("CH", "").replace("～", "-").replace("~", "-").replace("，", ",").replace(" ", ",")
            parts = [x for x in s.split(",") if x.strip()]
        for item in parts:
            t = str(item).strip().upper().replace("CH", "")
            if not t:
                continue
            if "-" in t:
                a, b = t.split("-", 1)
                a, b = int(a), int(b)
                if a > b:
                    a, b = b, a
                for n in range(a, b + 1):
                    if 1 <= n <= MAX_CHANNELS and n not in out:
                        out.append(n)
            else:
                n = int(t)
                if 1 <= n <= MAX_CHANNELS and n not in out:
                    out.append(n)
    except Exception:
        out = []
    return out or list(fallback)


def _ec62_v51b_channels_text(channels):
    if channels == "all":
        return "all"
    try:
        nums = sorted(int(x) for x in channels)
        if not nums:
            return ""
        ranges = []
        start = prev = nums[0]
        for n in nums[1:]:
            if n == prev + 1:
                prev = n
            else:
                ranges.append(f"CH{start:02d}" if start == prev else f"CH{start:02d}-CH{prev:02d}")
                start = prev = n
        ranges.append(f"CH{start:02d}" if start == prev else f"CH{start:02d}-CH{prev:02d}")
        return ",".join(ranges)
    except Exception:
        return ""


_ORIG_NORM_ROLE_V51B = _ec62_v51a_norm_role
_ORIG_ROLE_NAME_V51B = _ec62_v51a_role_name
_ORIG_PERMISSION_KEY_V51B = _ec62_v51a_permission_key
_ORIG_DEFAULT_USERS_V51B = _ec62_v51a_default_users
_ORIG_DEFAULT_PERMS_V51B = _ec62_v51a_default_permissions
_ORIG_FILTER_SNAPSHOT_V51B = _ec62_v51a_filter_snapshot
_ORIG_WEB_HTML_V51B = E62GUI._web_html


def _ec62_v51b_default_permissions():
    p = _ORIG_DEFAULT_PERMS_V51B()
    p.setdefault("operator3", {"channels": [1, 2, 3, 4, 5], "dashboard": True, "trend": True, "alarm_history": True, "alarm_recovery": True, "config": False, "delete": False, "download_log": False})
    return p


def _ec62_v51b_default_users(admin_password=None):
    u = _ORIG_DEFAULT_USERS_V51B(admin_password)
    u.setdefault("operator3", {"password": "1234", "role": "operator3", "display": "Operator3"})
    return u


def _ec62_v51b_norm_role(role):
    r = str(role or "guest").strip().lower()
    if r in ("operator3", "operator_3", "operator-3", "op3", "操作者3", "操作員3"):
        return "operator3"
    return _ORIG_NORM_ROLE_V51B(role)


def _ec62_v51b_role_name(role, lang="en"):
    r = _ec62_v51b_norm_role(role)
    is_zh = str(lang or "").lower().startswith("zh") or str(lang or "") in ("中文", "cn")
    if r == "operator3":
        return "操作者3" if is_zh else "Operator3"
    return _ORIG_ROLE_NAME_V51B(role, lang)


def _ec62_v51b_permission_key(role, username=None):
    u = str(username or "").strip().lower()
    if u in ("admin", "operator1", "operator2", "operator3", "guest"):
        return u
    r = _ec62_v51b_norm_role(role)
    if r == "operator3":
        return "operator3"
    return _ORIG_PERMISSION_KEY_V51B(role, username)

_ec62_v51a_default_permissions = _ec62_v51b_default_permissions
_ec62_v51a_default_users = _ec62_v51b_default_users
_ec62_v51a_norm_role = _ec62_v51b_norm_role
_ec62_v51a_role_name = _ec62_v51b_role_name
_ec62_v51a_permission_key = _ec62_v51b_permission_key
_ec62_v50_default_users = _ec62_v51b_default_users
_ec62_v50_norm_role = _ec62_v51b_norm_role
_ec62_v50_role_name = _ec62_v51b_role_name


def _ec62_v51b_permissions_payload(self):
    try:
        _ec62_v51a_normalize_users_permissions(self)
    except Exception:
        pass
    users = getattr(self, "users", {}) or {}
    perms = getattr(self, "user_permissions", {}) or _ec62_v51b_default_permissions()
    rows = []
    for key in ["admin", "operator1", "operator2", "operator3", "guest"]:
        u = users.get(key, {})
        perm = dict(perms.get(key, _ec62_v51b_default_permissions().get(key, {})))
        rows.append({
            "key": key,
            "display": u.get("display", key.title()),
            "role": _ec62_v51b_norm_role(u.get("role", key)),
            "password": u.get("password", ""),
            "channels_text": _ec62_v51b_channels_text(perm.get("channels", [1])),
            "dashboard": bool(perm.get("dashboard", True)),
            "trend": bool(perm.get("trend", False)),
            "alarm_history": bool(perm.get("alarm_history", False)),
            "alarm_recovery": bool(perm.get("alarm_recovery", False)),
            "config": bool(perm.get("config", False)),
            "delete": bool(perm.get("delete", False)),
            "download_log": bool(perm.get("download_log", False)),
        })
    return {"ok": True, "rows": rows}


def _ec62_v51b_apply_permissions_payload(self, data):
    rows = (data or {}).get("rows", [])
    if not isinstance(rows, list):
        return {"ok": False, "message": "資料格式錯誤 / Invalid data"}
    try:
        _ec62_v51a_normalize_users_permissions(self)
        users = getattr(self, "users", {}) or _ec62_v51b_default_users(getattr(self, "password", DEFAULT_PASSWORD))
        perms = getattr(self, "user_permissions", {}) or _ec62_v51b_default_permissions()
        defaults = _ec62_v51b_default_permissions()
        for r in rows:
            if not isinstance(r, dict):
                continue
            key = str(r.get("key", "")).strip().lower()
            if key not in ("admin", "operator1", "operator2", "operator3", "guest"):
                continue
            users.setdefault(key, {"password": "", "role": key, "display": key.title()})
            users[key]["role"] = "administrator" if key == "admin" else key
            users[key]["display"] = str(r.get("display", users[key].get("display", key.title())) or key.title()).strip()
            if "password" in r and (key == "guest" or str(r.get("password", "")) != ""):
                users[key]["password"] = str(r.get("password", ""))
            base = dict(defaults.get(key, defaults["guest"]))
            ch_text = r.get("channels_text", base.get("channels", [1]))
            base["channels"] = "all" if key == "admin" or str(ch_text).strip().lower() == "all" else _ec62_v51b_norm_channels(ch_text, base.get("channels", [1]))
            if key == "admin":
                base.update({"dashboard": True, "trend": True, "alarm_history": True, "alarm_recovery": True, "config": True, "delete": True, "download_log": True})
            else:
                for flag in ["dashboard", "trend", "alarm_history", "alarm_recovery", "config", "delete", "download_log"]:
                    base[flag] = bool(r.get(flag, base.get(flag, False)))
                base["config"] = False
                if key == "guest":
                    base["alarm_recovery"] = False
                    base["delete"] = False
                    base["download_log"] = False
            perms[key] = base
        self.users = users
        self.user_permissions = perms
        self.password = users.get("admin", {}).get("password") or getattr(self, "password", DEFAULT_PASSWORD)
        ok = _ec62_v51a_save_users_permissions(self)
        return {"ok": bool(ok), "message": "帳號權限已儲存" if ok else "儲存失敗", "users_permissions": _ec62_v51b_permissions_payload(self)}
    except Exception as e:
        try:
            self.write_error_log(f"V5.1B save permission setting error: {e}")
        except Exception:
            pass
        return {"ok": False, "message": str(e)}


def _ec62_v51b_filter_snapshot(self, snap, username=None, role=None):
    snap = _ORIG_FILTER_SNAPSHOT_V51B(self, snap, username, role)
    try:
        perm = _ec62_v51a_get_permission(self, username, role)
        snap["users_permissions"] = _ec62_v51b_permissions_payload(self) if bool(perm.get("config")) else None
    except Exception as e:
        try:
            self.write_error_log(f"V5.1B snapshot permission payload error: {e}")
        except Exception:
            pass
    return snap

_ec62_v51a_filter_snapshot = _ec62_v51b_filter_snapshot


def _ec62_v51b_web_html(self):
    html = _ORIG_WEB_HTML_V51B(self)
    html = html.replace("V5.1A", "V5.1B")
    html = html.replace('placeholder="admin / operator1 / operator2 / guest"', 'placeholder="admin / operator1 / operator2 / operator3 / guest"')
    perm_section = """
<section class=\"notify\" id=\"permSection\" style=\"display:none\">
  <h2 id="permTitle">帳號權限設定</h2>
  <div class=\"note\">Admin 登入後可設定 Operator 名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。</div>
  <div id=\"permRows\" class=\"note\">Loading...</div>
  <div class=\"notify-actions\"><button class=\"smallbtn\" onclick=\"savePermissions()\">儲存帳號權限 / Save Permissions</button></div>
</section>
"""
    if 'id="permSection"' not in html:
        html = html.replace('</section>\n<section class="history" id="alarmHistory"', '</section>\n' + perm_section + '<section class="history" id="alarmHistory"', 1)
    js = """
function ec62EscHtml(s){return String(s===undefined||s===null?'':s).replace(/[&<>]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[m];});}
function ec62Checked(v){return v?'checked':'';}
function permT(zh,en){return webLang==='en'?en:zh;}
function updatePermissionLang(){
  var title=document.getElementById('permTitle'), note=document.getElementById('permNote'), btn=document.getElementById('permSaveBtn');
  if(title)title.textContent=permT('帳號權限設定','Account Permission Setting');
  if(note)note.textContent=permT('Admin 登入後可設定 Operator 名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。','After Admin login, you can configure the Operator name, password and assigned channels. Channel format: CH01-CH05, 1-5, 6,7,8 or all.');
  if(btn)btn.textContent=permT('儲存帳號權限','Save Permissions');
}
function setPermissionForm(p){
  var sec=document.getElementById('permSection'), box=document.getElementById('permRows');
  if(!sec||!box)return;
  if(!p||!p.rows){sec.style.display='none';return;}
  sec.style.display='block';
  updatePermissionLang();
  box.innerHTML='<table class="histtable"><thead><tr><th>'+permT('帳號','Account')+'</th><th>'+permT('名稱','Name')+'</th><th>'+permT('密碼','Password')+'</th><th>'+permT('CH 權限','CH Permission')+'</th><th>Dashboard</th><th>Trend</th><th>Alarm History</th><th>'+permT('解除','Recovery')+'</th><th>'+permT('設定','Config')+'</th><th>'+permT('刪除','Delete')+'</th></tr></thead><tbody>'+p.rows.map(function(r){
    var disAdmin=r.key==='admin'?'disabled':'';
    var disGuest=(r.key==='guest'||r.key==='admin')?disAdmin:'';
    return '<tr data-user="'+ec62EscHtml(r.key)+'">'+
      '<td><b>'+ec62EscHtml(r.key)+'</b></td>'+
      '<td><input id="perm_'+r.key+'_display" value="'+ec62EscHtml(r.display)+'" style="width:110px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px"></td>'+
      '<td><input id="perm_'+r.key+'_password" type="password" value="'+ec62EscHtml(r.password)+'" style="width:110px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px"></td>'+
      '<td><input id="perm_'+r.key+'_channels" value="'+ec62EscHtml(r.channels_text)+'" '+(r.key==='admin'?'readonly':'')+' style="width:130px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px"></td>'+
      '<td><input type="checkbox" id="perm_'+r.key+'_dashboard" '+ec62Checked(r.dashboard)+' '+disAdmin+'></td>'+
      '<td><input type="checkbox" id="perm_'+r.key+'_trend" '+ec62Checked(r.trend)+' '+disAdmin+'></td>'+
      '<td><input type="checkbox" id="perm_'+r.key+'_alarm_history" '+ec62Checked(r.alarm_history)+' '+disAdmin+'></td>'+
      '<td><input type="checkbox" id="perm_'+r.key+'_alarm_recovery" '+ec62Checked(r.alarm_recovery)+' '+disGuest+'></td>'+
      '<td><input type="checkbox" id="perm_'+r.key+'_config" '+ec62Checked(r.config)+' disabled></td>'+
      '<td><input type="checkbox" id="perm_'+r.key+'_delete" '+ec62Checked(r.delete)+' '+disAdmin+'></td>'+
    '</tr>';}).join('')+'</tbody></table>';
}
function getPermissionForm(){
  var keys=['admin','operator1','operator2','operator3','guest'];
  var val=function(id){var e=document.getElementById(id);return e?e.value:''};
  var chk=function(id){var e=document.getElementById(id);return e?e.checked:false};
  return {token:ec62Token, rows:keys.map(function(k){return {key:k,display:val('perm_'+k+'_display'),password:val('perm_'+k+'_password'),channels_text:val('perm_'+k+'_channels'),dashboard:chk('perm_'+k+'_dashboard'),trend:chk('perm_'+k+'_trend'),alarm_history:chk('perm_'+k+'_alarm_history'),alarm_recovery:chk('perm_'+k+'_alarm_recovery'),config:chk('perm_'+k+'_config'),delete:chk('perm_'+k+'_delete'),download_log:chk('perm_'+k+'_delete')}})};
}
async function savePermissions(){
  if(!confirm(permT('儲存帳號權限設定？','Save account permission settings?')))return;
  var d=await postJson('/api/save_permissions', getPermissionForm());
  alert((webLang==='en'&&d.ok)?'Account permissions saved':(d.message||'OK'));
  if(d.users_permissions)setPermissionForm(d.users_permissions);
  await load();
}
"""
    if 'function setPermissionForm(p)' not in html:
        html = html.replace('async function load(){', js + '\nasync function load(){', 1)
    html = html.replace("if(d.notify && !window._notifyLoaded){setNotifyForm(d.notify); setAuditForm(d.alarm_audit); window._notifyLoaded=true;}", "if(d.notify && !window._notifyLoaded){setNotifyForm(d.notify); setAuditForm(d.alarm_audit); window._notifyLoaded=true;}\n    const permSection=document.getElementById('permSection'); if(d.can_admin && d.users_permissions){setPermissionForm(d.users_permissions);} else if(permSection){permSection.style.display='none';}")
    html = html.replace("(d.allowed_channels||[]).join(',')", "(d.allowed_channels||[]).map(x=>'CH'+String(x).padStart(2,'0')).join(',')")
    return html


def _ec62_v51b_start_web_server(self):
    if self.web_server is not None:
        return
    app = self
    class EC62WebHandler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            return
        def _send(self, code, content, ctype="text/html; charset=utf-8", filename=None):
            data = content.encode("utf-8") if isinstance(content, str) else content
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        def _json(self, obj, code=200):
            self._send(code, json.dumps(obj, ensure_ascii=False), "application/json; charset=utf-8")
        def _parse_query(self, parsed):
            q = {}
            try:
                for part in (parsed.query or "").split("&"):
                    if not part:
                        continue
                    k, v = part.split("=", 1) if "=" in part else (part, "")
                    from urllib.parse import unquote_plus
                    q[unquote_plus(k)] = unquote_plus(v)
            except Exception:
                pass
            return q
        def _token(self, data=None, query=None):
            return str(self.headers.get("X-EC62-Token", "") or (data or {}).get("token", "") or (query or {}).get("token", ""))
        def _role_user(self, data=None, query=None):
            return app.get_web_session_role(self._token(data, query))
        def _check(self, action, uid=None, data=None, query=None):
            role, user = self._role_user(data, query)
            if not _ec62_v51a_can_user(app, user, role, action, uid):
                self._json({"ok": False, "message": "權限不足 / Permission denied", "role": role, "user": user})
                return False, role, user
            return True, role, user
        def do_POST(self):
            try:
                parsed = urlparse(self.path)
                path = parsed.path
                try:
                    length = int(self.headers.get("Content-Length", "0") or 0)
                    raw = self.rfile.read(length) if length > 0 else b"{}"
                    data = json.loads(raw.decode("utf-8") or "{}")
                except Exception:
                    data = {}
                if path == "/api/login":
                    self._json(app.web_login(data)); return
                if path == "/api/save_permissions":
                    ok, role, user = self._check("admin_config", data=data)
                    if not ok: return
                    self._json(_ec62_v51b_apply_permissions_payload(app, data)); return
                if path == "/api/save_notify":
                    ok, role, user = self._check("admin_config", data=data)
                    if not ok: return
                    old = app.is_unlocked
                    try:
                        app.is_unlocked = True
                        self._json(_ORIG_WEB_SAVE_NOTIFY(app, data))
                    finally:
                        app.is_unlocked = old
                    return
                if path == "/api/test_notify":
                    ok, role, user = self._check("test_notify", data=data)
                    if not ok: return
                    old = app.is_unlocked
                    try:
                        app.is_unlocked = True
                        self._json(_ORIG_WEB_TEST_NOTIFY(app, str(data.get("target", "all"))))
                    finally:
                        app.is_unlocked = old
                    return
                if path == "/api/manual_recovery":
                    uid = data.get("uid", "")
                    ok, role, user = self._check("alarm_recovery", uid=uid, data=data)
                    if not ok: return
                    old_unlocked, old_user, old_role = app.is_unlocked, getattr(app, "current_user", "guest"), getattr(app, "current_role", "guest")
                    try:
                        app.is_unlocked = True
                        app.current_user = user
                        app.current_role = role
                        self._json(_ORIG_WEB_MANUAL_RECOVERY(app, data))
                    finally:
                        app.is_unlocked, app.current_user, app.current_role = old_unlocked, old_user, old_role
                    return
                if path == "/api/delete_alarm":
                    ok, role, user = self._check("delete_alarm", data=data)
                    if not ok: return
                    self._json(app.web_delete_alarm(data)); return
                self._send(404, "Not Found", "text/plain; charset=utf-8")
            except Exception as e:
                app.write_error_log(f"V5.1B web post error: {e}")
                self._send(500, "Web Error", "text/plain; charset=utf-8")
        def do_GET(self):
            try:
                parsed = urlparse(self.path)
                path = parsed.path
                query = self._parse_query(parsed)
                if path in ("/", "/index.html"):
                    self._send(200, app._web_html()); return
                if path == "/api/data":
                    role, user = self._role_user(query=query)
                    snap = _ORIG_GET_WEB_SNAPSHOT(app)
                    snap["title"] = "EC62 Web V5.1B Permission Setting"
                    snap["web_role"] = role
                    snap["web_user"] = user
                    snap["web_role_name"] = _ec62_v51b_role_name(role, getattr(app, "language", "zh"))
                    snap = _ec62_v51a_filter_snapshot(app, snap, user, role)
                    self._json(snap); return
                if path == "/api/permissions":
                    ok, role, user = self._check("admin_config", query=query)
                    if not ok: return
                    self._json(_ec62_v51b_permissions_payload(app)); return
                if path == "/api/clear_minmax":
                    uid = query.get("uid", "all")
                    ok, role, user = self._check("clear_minmax", uid=None if uid == "all" else uid, query=query)
                    if not ok: return
                    self._json(app.web_clear_minmax(uid)); return
                if path == "/api/set_limits":
                    uid = query.get("uid", "1")
                    ok, role, user = self._check("set_limits", uid=uid, query=query)
                    if not ok: return
                    self._json(app.web_set_alarm_limits(uid, query.get("lo", ""), query.get("hi", ""))); return
                if path == "/api/set_language":
                    self._json(app.web_set_language(query.get("lang", "zh"))); return
                if path == "/api/alarm_history":
                    ok, role, user = self._check("alarm_history", query=query)
                    if not ok: return
                    self._json(_ec62_v51a_web_alarm_history_for(app, query.get("limit", "300"), user, role)); return
                if path == "/api/download_alarm_log":
                    ok, role, user = self._check("download_log", query=query)
                    if not ok: return
                    fname, data, ctype = app.web_download_alarm_log(query.get("type", "txt"))
                    self._send(200, data, ctype, filename=fname or "EC62_Alarm_Log.txt"); return
                if path == "/manifest.json":
                    self._send(200, app._web_manifest(), "application/manifest+json; charset=utf-8"); return
                self._send(404, "Not Found", "text/plain; charset=utf-8")
            except Exception as e:
                app.write_error_log(f"V5.1B web request error: {e}")
                self._send(500, "Web Error", "text/plain; charset=utf-8")
    try:
        self.web_server = ThreadingHTTPServer(("0.0.0.0", int(self.web_port)), EC62WebHandler)
        self.web_thread = threading.Thread(target=self.web_server.serve_forever, daemon=True)
        self.web_thread.start()
        self.update_lan_url_display()
        self.set_status(f"🌐 Web V5.1B 帳號權限設定雙語修正版已啟動 0.0.0.0:{self.web_port}", "green")
        self.audit("WEB_START_V51B", "0.0.0.0:" + str(self.web_port))
    except OSError as e:
        self.web_server = None
        self.write_error_log(f"start web server failed port={self.web_port}: {e}")
        self.set_status(f"❌ Web Port {self.web_port} 無法啟動：{e}", "red")

E62GUI._web_html = _ec62_v51b_web_html
E62GUI.start_web_server = _ec62_v51b_start_web_server
E62GUI.get_permissions_payload = _ec62_v51b_permissions_payload
E62GUI.apply_permissions_payload = _ec62_v51b_apply_permissions_payload


# =========================================================
# V5.1C Web Menu / Permission Header Bilingual FIX
# - Dashboard -> 即時監控
# - Trend -> 趨勢圖
# - Alarm History -> 警報紀錄
# - Account Permission 說明文字支援中文 / English 即時切換
# =========================================================
_ORIG_WEB_HTML_V51C = E62GUI._web_html


def _ec62_v51c_web_html(self):
    html = _ORIG_WEB_HTML_V51C(self)
    html = html.replace('V5.0', 'V5.0')
    html = html.replace('E62/C62 Web V5.0 Permission Setting', 'E62/C62 Web V5.0 Permission Setting')

    # Account Permission 區塊加上 id，讓 updatePermissionLang() 可切換中英文。
    html = html.replace(
        '<div class="note">Admin 登入後可設定 Operator 名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。</div>',
        '<div class="note" id="permNote">Admin 登入後可設定 Operator 名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。</div>'
    )
    html = html.replace(
        '<button class="smallbtn" onclick="savePermissions()">儲存帳號權限 / Save Permissions</button>',
        '<button class="smallbtn" id="permSaveBtn" onclick="savePermissions()">儲存帳號權限</button>'
    )

    # 權限表欄位 Dashboard / Trend / Alarm History 依語言顯示。
    html = html.replace(
        "<th>Dashboard</th><th>Trend</th><th>Alarm History</th>",
        "<th>'+permT('即時監控','Dashboard')+'</th><th>'+permT('趨勢圖','Trend')+'</th><th>'+permT('警報紀錄','Alarm History')+'</th>"
    )

    # Alarm History 區塊標題改成可辨識的中文主標題。
    html = html.replace(
        '<h2>📋 Active Alarm / 目前未解除警報</h2>',
        '<h2 id="alarmHistoryTitle">📋 警報紀錄</h2>'
    )
    html = html.replace(
        '<div class="notify-actions"><button class="smallbtn" onclick="loadAlarmHistory()">重新整理 / Refresh</button></div>',
        '<div class="notify-actions"><button class="smallbtn" id="alarmRefreshBtn" onclick="loadAlarmHistory()">重新整理</button></div>'
    )

    # 擴充前端語言更新函式，處理 Alarm History 標題與權限設定欄位。
    inject = """
function ec62V51CMenuLang(){
  var ah=document.getElementById('alarmHistoryTitle');
  if(ah)ah.textContent=permT('📋 警報紀錄','📋 Alarm History');
  var rb=document.getElementById('alarmRefreshBtn');
  if(rb)rb.textContent=permT('重新整理','Refresh');
  var ps=document.getElementById('permSaveBtn');
  if(ps)ps.textContent=permT('儲存帳號權限','Save Permissions');
  var pt=document.getElementById('permTitle');
  if(pt)pt.textContent=permT('帳號權限設定','Account Permission Setting');
  var pn=document.getElementById('permNote');
  if(pn)pn.textContent=permT('Admin 登入後可設定 Operator 名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。','After Admin login, you can configure the Operator name, password and assigned channels. Channel format: CH01-CH05, 1-5, 6,7,8 or all.');
}
"""
    if 'function ec62V51CMenuLang()' not in html:
        html = html.replace('async function load(){', inject + '\nasync function load(){', 1)
    html = html.replace(
        "applyWebStaticLang(); if(typeof updatePermissionLang==='function')updatePermissionLang();",
        "applyWebStaticLang(); if(typeof updatePermissionLang==='function')updatePermissionLang(); if(typeof ec62V51CMenuLang==='function')ec62V51CMenuLang();"
    )
    return html


E62GUI._web_html = _ec62_v51c_web_html



# =========================================================
# V5.1D Account Display Name FIX
# - 修正「名稱」欄位儲存後 Web 登入狀態仍顯示 operator1/operator2 的問題
# - 登入成功提示、右上登入狀態、/api/data 均改用帳號權限設定中的 display 名稱
# - 保留原帳號 key：admin/operator1/operator2/operator3/guest，避免權限對應失效
# =========================================================

def _ec62_v51d_user_display(self, username=None, role=None):
    try:
        uname = str(username or '').strip().lower()
        users = getattr(self, 'users', {}) or {}
        if uname in users:
            disp = str(users.get(uname, {}).get('display', '') or '').strip()
            if disp:
                return disp
        for k, u in users.items():
            if str(k).strip().lower() == uname:
                disp = str(u.get('display', '') or '').strip()
                if disp:
                    return disp
        return _ec62_v51b_role_name(role or uname or 'guest', getattr(self, 'language', 'zh'))
    except Exception:
        try:
            return _ec62_v51b_role_name(role or username or 'guest', getattr(self, 'language', 'zh'))
        except Exception:
            return str(username or 'guest')

_ORIG_WEB_LOGIN_V51D = E62GUI.web_login

def _ec62_v51d_web_login(self, data):
    res = _ORIG_WEB_LOGIN_V51D(self, data)
    try:
        if isinstance(res, dict) and res.get('ok'):
            uname = str(res.get('username', '') or '').strip().lower()
            role = res.get('role', 'guest')
            disp = _ec62_v51d_user_display(self, uname, role)
            res['display_name'] = disp
            res['web_display_name'] = disp
            # role_name 保留權限角色；display_name 才是管理者可修改的名稱。
    except Exception as e:
        try: self.write_error_log(f'V5.1D web login display name error: {e}')
        except Exception: pass
    return res

_ORIG_FILTER_SNAPSHOT_V51D = _ec62_v51a_filter_snapshot

def _ec62_v51d_filter_snapshot(self, snap, username=None, role=None):
    snap = _ORIG_FILTER_SNAPSHOT_V51D(self, snap, username, role)
    try:
        snap['web_display_name'] = _ec62_v51d_user_display(self, username or snap.get('web_user', 'guest'), role or snap.get('web_role', 'guest'))
    except Exception:
        pass
    return snap

_ORIG_APPLY_PERMISSIONS_V51D = E62GUI.apply_permissions_payload

def _ec62_v51d_apply_permissions_payload(self, data):
    # 先沿用 V5.1B/V5.1C 儲存邏輯，再強制同步 display 欄位，確保名稱不會被 normalize 還原。
    res = _ORIG_APPLY_PERMISSIONS_V51D(self, data)
    try:
        rows = (data or {}).get('rows', [])
        users = getattr(self, 'users', {}) or {}
        changed = False
        if isinstance(rows, list):
            for r in rows:
                if not isinstance(r, dict):
                    continue
                key = str(r.get('key', '')).strip().lower()
                if key not in ('admin', 'operator1', 'operator2', 'operator3', 'guest'):
                    continue
                disp = str(r.get('display', '') or '').strip()
                if not disp:
                    disp = key.title()
                users.setdefault(key, {'password': '', 'role': key, 'display': disp})
                if users[key].get('display') != disp:
                    users[key]['display'] = disp
                    changed = True
        if changed:
            self.users = users
            _ec62_v51a_save_users_permissions(self)
            res = dict(res or {})
            res['ok'] = True
            res['message'] = '帳號名稱與權限已儲存'
            res['users_permissions'] = _ec62_v51b_permissions_payload(self)
    except Exception as e:
        try: self.write_error_log(f'V5.1D force save display name error: {e}')
        except Exception: pass
    return res

_ORIG_WEB_HTML_V51D = E62GUI._web_html

def _ec62_v51d_web_html(self):
    html = _ORIG_WEB_HTML_V51D(self)
    html = html.replace('V5.1C', 'V5.1D')
    html = html.replace('EC62 Web V5.1C Permission Setting', 'EC62 Web V5.1D Permission Setting')

    # 登入成功提示改顯示可修改的「名稱」。
    html = html.replace(
        "alert((webLang==='zh'?'登入成功：':'Login OK: ')+d.role_name);",
        "alert((webLang==='zh'?'登入成功：':'Login OK: ')+(d.display_name||d.role_name||d.username));"
    )

    # load() 右上角登入狀態改顯示 display_name，而不是固定 operator1/operator2 key。
    html = html.replace(
        "if(ls)ls.textContent=(d.web_user||'guest')+' ('+(d.web_role_name||(webLang==='zh'?'訪客':'Guest'))+')';",
        "if(ls)ls.textContent=(d.web_display_name||d.web_user||'guest')+' ('+(d.web_role_name||(webLang==='zh'?'訪客':'Guest'))+')';"
    )
    html = html.replace(
        "(document.getElementById('loginState')||{}).textContent=(d.web_user||'guest')+' / '+(d.web_role_name||d.web_role||'Guest')+' / CH '+((d.allowed_channels||[]).map(x=>'CH'+String(x).padStart(2,'0')).join(','));",
        "(document.getElementById('loginState')||{}).textContent=(d.web_display_name||d.web_user||'guest')+' / '+(d.web_role_name||d.web_role||'Guest')+' / CH '+((d.allowed_channels||[]).map(x=>'CH'+String(x).padStart(2,'0')).join(','));"
    )
    html = html.replace(
        "(document.getElementById('loginState')||{}).textContent=(d.web_user||'guest')+' / '+(d.web_role_name||d.web_role||'Guest')+' / CH '+((d.allowed_channels||[]).join(','));",
        "(document.getElementById('loginState')||{}).textContent=(d.web_display_name||d.web_user||'guest')+' / '+(d.web_role_name||d.web_role||'Guest')+' / CH '+((d.allowed_channels||[]).join(','));"
    )

    # 權限表中加註：帳號欄是固定登入代號，名稱欄才是可修改顯示名稱。
    html = html.replace(
        "<th>'+permT('帳號','Account')+'</th><th>'+permT('名稱','Name')+'</th>",
        "<th>'+permT('帳號','Account')+'</th><th>'+permT('顯示名稱','Display Name')+'</th>"
    )
    return html

E62GUI.web_login = _ec62_v51d_web_login
E62GUI._web_html = _ec62_v51d_web_html
E62GUI.apply_permissions_payload = _ec62_v51d_apply_permissions_payload
_ec62_v51a_filter_snapshot = _ec62_v51d_filter_snapshot



# =========================================================
# V5.1E Account Permission WRITE FIX
# - 修正「帳號 / 顯示名稱 / 密碼 / CH 權限」按儲存後未真正寫入 Config 的問題
# - /api/save_permissions 直接寫入 config_e62_multi.json 的 users 與 user_permissions
# - 修正 start_web_server 內直接呼叫舊 _ec62_v51b_apply_permissions_payload 的情況
# =========================================================

def _ec62_v51e_apply_permissions_payload(self, data):
    rows = (data or {}).get('rows', [])
    if not isinstance(rows, list):
        return {'ok': False, 'message': '資料格式錯誤 / Invalid data'}
    try:
        # 先取得目前設定，避免覆蓋其他設定值。
        cfg = {}
        try:
            if os.path.exists(self.config_path):
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f) or {}
        except Exception:
            cfg = {}

        # 讀取目前記憶體資料；不足時補預設。
        try:
            _ec62_v51a_normalize_users_permissions(self)
        except Exception:
            pass
        users = dict(getattr(self, 'users', {}) or _ec62_v51b_default_users(getattr(self, 'password', DEFAULT_PASSWORD)))
        perms = dict(getattr(self, 'user_permissions', {}) or _ec62_v51b_default_permissions())
        defaults = _ec62_v51b_default_permissions()

        valid_keys = ('admin', 'operator1', 'operator2', 'operator3', 'guest')
        for r in rows:
            if not isinstance(r, dict):
                continue
            key = str(r.get('key', '')).strip().lower()
            if key not in valid_keys:
                continue

            # 帳號 key 固定，顯示名稱可修改。
            old_user = users.get(key, {}) if isinstance(users.get(key, {}), dict) else {}
            display = str(r.get('display', old_user.get('display', key.title())) or key.title()).strip()
            password = str(r.get('password', old_user.get('password', '')) or '')
            role = 'administrator' if key == 'admin' else key
            users[key] = {
                'password': password,
                'role': role,
                'display': display,
            }

            # CH 權限可輸入 all、CH01-CH05、1-5、6,7,8。
            base = dict(defaults.get(key, defaults.get('guest', {})))
            ch_text = r.get('channels_text', base.get('channels', [1]))
            if key == 'admin' or str(ch_text).strip().lower() == 'all':
                channels = 'all'
            else:
                channels = _ec62_v51b_norm_channels(ch_text, base.get('channels', [1]))
            base['channels'] = channels

            # 權限旗標寫入。Admin 固定全開；Guest 固定不可解除 / 刪除 / 設定。
            if key == 'admin':
                base.update({
                    'dashboard': True,
                    'trend': True,
                    'alarm_history': True,
                    'alarm_recovery': True,
                    'config': True,
                    'delete': True,
                    'download_log': True,
                })
            else:
                for flag in ['dashboard', 'trend', 'alarm_history', 'alarm_recovery', 'config', 'delete', 'download_log']:
                    base[flag] = bool(r.get(flag, base.get(flag, False)))
                # 現場安全原則：Operator / Guest 不開放設定；Guest 只可瀏覽。
                base['config'] = False
                if key == 'guest':
                    base['trend'] = bool(r.get('trend', base.get('trend', False)))
                    base['alarm_recovery'] = False
                    base['delete'] = False
                    base['download_log'] = False
            perms[key] = base

        self.users = users
        self.user_permissions = perms
        self.password = users.get('admin', {}).get('password') or getattr(self, 'password', DEFAULT_PASSWORD)

        # 直接寫入 Config，避免舊 normalize / save 流程把欄位還原。
        cfg['users'] = users
        cfg['user_permissions'] = perms
        cfg['password'] = self.password
        try:
            cfg.setdefault('web', {})['alarm_audit'] = {
                'operator': self._alarm_audit_defaults()[0],
                'reason': self._alarm_audit_defaults()[1],
            }
        except Exception:
            pass
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)

        # 再回讀一次，確保畫面與檔案一致。
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                check_cfg = json.load(f) or {}
            self.users = check_cfg.get('users', users)
            self.user_permissions = check_cfg.get('user_permissions', perms)
        except Exception:
            pass

        return {
            'ok': True,
            'message': '帳號、顯示名稱、密碼與 CH 權限已儲存',
            'users_permissions': _ec62_v51b_permissions_payload(self),
        }
    except Exception as e:
        try:
            self.write_error_log(f'V5.1E save permission setting error: {e}')
        except Exception:
            pass
        return {'ok': False, 'message': '儲存失敗：' + str(e)}

_ORIG_WEB_HTML_V51E = E62GUI._web_html

def _ec62_v51e_web_html(self):
    html = _ORIG_WEB_HTML_V51E(self)
    html = html.replace('V5.0', 'V5.0')
    html = html.replace('EC62 Web V5.0 Permission Setting', 'EC62 Web V5.0 Permission Setting')

    # 按下儲存時明確送出所有欄位；成功後重新載入權限表。
    html = html.replace(
        "alert((webLang==='en'&&d.ok)?'Account permissions saved':(d.message||'OK'));",
        "alert(d.message || ((webLang==='en'&&d.ok)?'Account permissions saved':'帳號權限已儲存'));"
    )
    return html

# 重要：start_web_server 內部直接呼叫 _ec62_v51b_apply_permissions_payload(app, data)，
# 因此要覆蓋同名全域函式，才能讓 /api/save_permissions 真正走 V5.1E 寫入流程。
_ec62_v51b_apply_permissions_payload = _ec62_v51e_apply_permissions_payload
E62GUI.apply_permissions_payload = _ec62_v51e_apply_permissions_payload
E62GUI._web_html = _ec62_v51e_web_html


# =========================================================
# V5.1F Account Permission FIELD EDIT FIX
# - 修正「顯示名稱 / 密碼 / CH 權限」欄位輸入時被 3 秒自動刷新覆蓋
# - 欄位使用 input，可直接編輯；編輯中不自動重畫權限表
# - 儲存後強制重畫並寫入 config_e62_multi.json
# =========================================================

_ORIG_WEB_HTML_V51F = E62GUI._web_html

def _ec62_v51f_web_html(self):
    html = _ORIG_WEB_HTML_V51F(self)
    html = html.replace('V5.1E', 'V5.1F')
    html = html.replace('EC62 Web V5.1E Permission Setting', 'EC62 Web V5.1F Permission Setting')
    html = html.replace('<div class="note">Admin 登入後可設定 Operator 名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。</div>',
                        '<div class="note" id="permNote">Admin 登入後可設定 Operator 名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。</div>')
    html = html.replace('<button class="smallbtn" onclick="savePermissions()">儲存帳號權限 / Save Permissions</button>',
                        '<button class="smallbtn" id="permSaveBtn" onclick="savePermissions()">儲存帳號權限</button>')

    fix_js = """
<script>
window._permEditing = false;
window._permLastPayload = null;
function ec62EscHtml2(s){return String(s===undefined||s===null?'':s).replace(/[&<>\"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m];});}
function permT2(zh,en){return (typeof webLang !== 'undefined' && webLang==='en') ? en : zh;}
function permChecked2(v){return v ? 'checked' : '';}
function permEditStart(){ window._permEditing = true; var m=document.getElementById('permEditMsg'); if(m)m.textContent=permT2('編輯中，請按「儲存帳號權限」寫入設定。','Editing. Press Save Permissions to write settings.'); }
function updatePermissionLang(){
  var title=document.getElementById('permTitle'), note=document.getElementById('permNote'), btn=document.getElementById('permSaveBtn');
  if(title) title.textContent=permT2('帳號權限設定','Account Permission Setting');
  if(note) note.textContent=permT2('Admin 登入後可設定 Operator 名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。','After Admin login, you can configure the Operator name, password and assigned channels. Channel format: CH01-CH05, 1-5, 6,7,8 or all.');
  if(btn) btn.textContent=permT2('儲存帳號權限','Save Permissions');
}
function setPermissionForm(p, force){
  var sec=document.getElementById('permSection'), box=document.getElementById('permRows');
  if(!sec||!box)return;
  if(!p||!p.rows){sec.style.display='none';return;}
  sec.style.display='block';
  window._permLastPayload = p;
  updatePermissionLang();
  if(window._permEditing && !force) return;
  var head='<table class=\"histtable\"><thead><tr>'+
    '<th>'+permT2('帳號','Account')+'</th>'+
    '<th>'+permT2('顯示名稱','Display Name')+'</th>'+
    '<th>'+permT2('密碼','Password')+'</th>'+
    '<th>'+permT2('CH 權限','CH Permission')+'</th>'+
    '<th>'+permT2('即時監控','Dashboard')+'</th>'+
    '<th>'+permT2('趨勢圖','Trend')+'</th>'+
    '<th>'+permT2('警報紀錄','Alarm History')+'</th>'+
    '<th>'+permT2('解除','Recovery')+'</th>'+
    '<th>'+permT2('設定','Config')+'</th>'+
    '<th>'+permT2('刪除','Delete')+'</th>'+
    '</tr></thead><tbody>';
  var body=p.rows.map(function(r){
    var key=ec62EscHtml2(r.key);
    var admin=(r.key==='admin');
    var guest=(r.key==='guest');
    var disAdmin=admin?'disabled':'';
    var disRecover=(admin?'disabled':(guest?'disabled':''));
    var chRead=admin?'readonly':'';
    return '<tr data-user=\"'+key+'\">'+
      '<td><b>'+key+'</b></td>'+
      '<td><input class=\"permInput\" oninput=\"permEditStart()\" onchange=\"permEditStart()\" id=\"perm_'+key+'_display\" value=\"'+ec62EscHtml2(r.display)+'\" style=\"width:120px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px\"></td>'+
      '<td><input class=\"permInput\" oninput=\"permEditStart()\" onchange=\"permEditStart()\" id=\"perm_'+key+'_password\" type=\"text\" value=\"'+ec62EscHtml2(r.password)+'\" style=\"width:120px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px\"></td>'+
      '<td><input class=\"permInput\" oninput=\"permEditStart()\" onchange=\"permEditStart()\" id=\"perm_'+key+'_channels\" value=\"'+ec62EscHtml2(r.channels_text)+'\" '+chRead+' style=\"width:145px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px\"></td>'+
      '<td><input onchange=\"permEditStart()\" type=\"checkbox\" id=\"perm_'+key+'_dashboard\" '+permChecked2(r.dashboard)+' '+disAdmin+'></td>'+
      '<td><input onchange=\"permEditStart()\" type=\"checkbox\" id=\"perm_'+key+'_trend\" '+permChecked2(r.trend)+' '+disAdmin+'></td>'+
      '<td><input onchange=\"permEditStart()\" type=\"checkbox\" id=\"perm_'+key+'_alarm_history\" '+permChecked2(r.alarm_history)+' '+disAdmin+'></td>'+
      '<td><input onchange=\"permEditStart()\" type=\"checkbox\" id=\"perm_'+key+'_alarm_recovery\" '+permChecked2(r.alarm_recovery)+' '+disRecover+'></td>'+
      '<td><input type=\"checkbox\" id=\"perm_'+key+'_config\" '+permChecked2(r.config)+' disabled></td>'+
      '<td><input onchange=\"permEditStart()\" type=\"checkbox\" id=\"perm_'+key+'_delete\" '+permChecked2(r.delete)+' '+disAdmin+'></td>'+
      '</tr>';
  }).join('');
  box.innerHTML=head+body+'</tbody></table><div class=\"note\" id=\"permEditMsg\">'+permT2('可直接修改欄位後按「儲存帳號權限」。','Edit fields, then press Save Permissions.')+'</div>';
}
function getPermissionForm(){
  var keys=['admin','operator1','operator2','operator3','guest'];
  var val=function(id){var e=document.getElementById(id);return e?e.value:'';};
  var chk=function(id){var e=document.getElementById(id);return e?!!e.checked:false;};
  return {token:(typeof ec62Token!=='undefined'?ec62Token:''), rows:keys.map(function(k){return {
    key:k, display:val('perm_'+k+'_display'), password:val('perm_'+k+'_password'), channels_text:val('perm_'+k+'_channels'),
    dashboard:chk('perm_'+k+'_dashboard'), trend:chk('perm_'+k+'_trend'), alarm_history:chk('perm_'+k+'_alarm_history'),
    alarm_recovery:chk('perm_'+k+'_alarm_recovery'), config:chk('perm_'+k+'_config'), delete:chk('perm_'+k+'_delete'), download_log:chk('perm_'+k+'_delete')
  };})};
}
async function savePermissions(){
  if(!confirm(permT2('儲存帳號權限設定？','Save account permission settings?')))return;
  var d=await postJson('/api/save_permissions', getPermissionForm());
  alert(d.message || ((typeof webLang!=='undefined' && webLang==='en'&&d.ok)?'Account permissions saved':'帳號權限已儲存'));
  if(d.ok){ window._permEditing=false; if(d.users_permissions)setPermissionForm(d.users_permissions,true); await load(); }
}
</script>
"""
    if '</body>' in html:
        html = html.replace('</body>', fix_js + '\n</body>', 1)
    else:
        html += fix_js
    return html

E62GUI._web_html = _ec62_v51f_web_html


# =========================================================
# V5.0I FIX：Web Hi / Low 儲存完整修正
# 1) Web 設定 LOW/HIGH 立即寫入 config_e62_multi.json
# 2) API 回傳寫入失敗，不再假成功
# 3) set_limits 允許已登入 Operator 依 CH 權限設定；Admin 全部可設定
# 4) Web 前端 GET 同時帶 token query，避免部分瀏覽器/手機 header 遺失
# =========================================================
_ORIG_EC62_V51A_CAN_USER_V50I = _ec62_v51a_can_user

def _ec62_v50i_can_user(self, username=None, role=None, action="view", uid=None):
    # Hi / Low 是 Web 現場警戒值；允許 Admin 全部、Operator 依 CH 權限設定。
    # Guest 仍只依預設 CH 權限，不開放未授權 CH。
    if str(action) == "set_limits":
        perm = _ec62_v51a_get_permission(self, username, role)
        r = _ec62_v51a_norm_role(role)
        # Admin 全部允許
        if r == "administrator" or _ec62_v51a_permission_key(role, username) == "admin":
            return True
        # Operator 可設定自己被授權的 CH；Guest 不允許設定。
        if r not in ("operator1", "operator2"):
            return False
        try:
            return int(uid) in set(perm.get("channels", []))
        except Exception:
            return False
    return _ORIG_EC62_V51A_CAN_USER_V50I(self, username, role, action, uid)

_ec62_v51a_can_user = _ec62_v50i_can_user


def _ec62_v50i_web_set_alarm_limits(self, uid, lo=None, hi=None):
    """V5.0I：Web LOW/HIGH 寫入記憶體、Config，並驗證回讀。"""
    try:
        n = int(str(uid).strip().replace("CH", ""))
        if n < 1 or n > self.max_unit_id:
            raise ValueError("CH 超出範圍")

        lo_val = self._ec62_limit_float_or_none(lo)
        hi_val = self._ec62_limit_float_or_none(hi)
        if lo_val is not None and hi_val is not None and lo_val > hi_val:
            lo_val, hi_val = hi_val, lo_val

        with self.web_lock:
            self.web_alarm_limits[n] = {"lo": lo_val, "hi": hi_val}
            self.normalize_web_alarm_limits()

        cfg = {}
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f) or {}
            except Exception:
                cfg = {}
        if not isinstance(cfg, dict):
            cfg = {}
        web_cfg = cfg.setdefault("web", {})
        web_cfg["alarm_limits"] = self.web_alarm_limits_for_config()
        web_cfg["language"] = getattr(self, "language", "zh")
        web_cfg["lan_ip"] = getattr(self, "web_lan_ip", "")
        web_cfg["port"] = int(getattr(self, "web_port", 8080) or 8080)

        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)

        # 立即回讀驗證，避免 Windows 權限/路徑問題造成假成功。
        with open(self.config_path, "r", encoding="utf-8") as f:
            check = json.load(f) or {}
        saved = (((check.get("web") or {}).get("alarm_limits") or {}).get(str(n)) or {})
        chk_lo = self._ec62_limit_float_or_none(saved.get("lo", saved.get("Lo", None)))
        chk_hi = self._ec62_limit_float_or_none(saved.get("hi", saved.get("Hi", None)))
        if chk_lo != lo_val or chk_hi != hi_val:
            raise IOError(f"Config 驗證失敗：CH{n:02d} saved lo={chk_lo}, hi={chk_hi}")

        try:
            self.audit("WEB_SET_LIMITS", f"uid={n} lo={lo_val} hi={hi_val} path={self.config_path}")
            self.safe_gui(self.set_status, f"🌐 Web CH{n:02d} LOW/HIGH 已儲存", "green")
        except Exception:
            pass

        snap = self.get_web_snapshot()
        ch = None
        for item in snap.get("channels", []):
            try:
                if int(str(item.get("id", "0")).replace("CH", "")) == n:
                    ch = item
                    break
            except Exception:
                pass
        return {"ok": True, "message": f"CH{n:02d} Web Hi/Low 已儲存", "uid": n, "lo": lo_val, "hi": hi_val, "config_path": self.config_path, "channel": ch}
    except Exception as e:
        try:
            self.write_error_log(f"V5.0I web_set_alarm_limits error: {e}")
        except Exception:
            pass
        return {"ok": False, "message": "Web Hi/Low 儲存失敗：" + str(e)}

E62GUI.web_set_alarm_limits = _ec62_v50i_web_set_alarm_limits

_ORIG_EC62_V50I_FILTER_SNAPSHOT = _ec62_v51a_filter_snapshot

def _ec62_v50i_filter_snapshot(self, snap, username, role):
    snap = _ORIG_EC62_V50I_FILTER_SNAPSHOT(self, snap, username, role)
    try:
        r = _ec62_v51a_norm_role(role)
        snap["can_set_limits"] = r in ("administrator", "operator1", "operator2")
    except Exception:
        snap["can_set_limits"] = False
    return snap

_ec62_v51a_filter_snapshot = _ec62_v50i_filter_snapshot

_ORIG_EC62_V50I_WEB_HTML = E62GUI._web_html

def _ec62_v50i_web_html(self):
    html = _ORIG_EC62_V50I_WEB_HTML(self)
    html = html.replace("V5.0H", "V5.0I")
    html = html.replace("Hi-Low Save FIX", "Hi-Low Web Save FIX")
    # setLimit URL 加上 token query，手機瀏覽器即使 header 不帶也能通過權限檢查。
    html = html.replace(
        "const d=await api('/api/set_limits?uid='+encodeURIComponent(uid)+'&lo='+encodeURIComponent(lo)+'&hi='+encodeURIComponent(hi));",
        "const d=await api('/api/set_limits?uid='+encodeURIComponent(uid)+'&lo='+encodeURIComponent(lo)+'&hi='+encodeURIComponent(hi)+'&token='+encodeURIComponent(ec62Token||''));"
    )
    # 權限版曾把『清除』與『設定MAX/MIN』一起綁到 can_admin，改為：清除限 Admin；設定 Hi/Low 限 Admin/Operator。
    html = html.replace(
        "<div class=\"tools\">${d.can_admin?`<button class=\"smallbtn orange\" onclick=\"clearMinMax('${c.id}')\">${T('清除')}</button><button class=\"smallbtn\" onclick=\"setLimit('${c.id}',${c.web_lo===null||c.web_lo===undefined?'null':JSON.stringify(c.web_lo)},${c.web_hi===null||c.web_hi===undefined?'null':JSON.stringify(c.web_hi)})\">${T('設定MAX/MIN')}</button>`:''}",
        "<div class=\"tools\">${d.can_admin?`<button class=\"smallbtn orange\" onclick=\"clearMinMax('${c.id}')\">${T('清除')}</button>`:''}${d.can_set_limits?`<button class=\"smallbtn\" onclick=\"setLimit('${c.id}',${c.web_lo===null||c.web_lo===undefined?'null':JSON.stringify(c.web_lo)},${c.web_hi===null||c.web_hi===undefined?'null':JSON.stringify(c.web_hi)})\">${T('設定MAX/MIN')}</button>`:''}"
    )
    return html

E62GUI._web_html = _ec62_v50i_web_html



# =========================================================
# V5.0J FIX：重新執行後 Web Hi / Low 無法載入/顯示 修正
# 1) load_config 後強制從 config_e62_multi.json 回填 web.alarm_limits
# 2) /api/data 每次輸出前補上 web_lo / web_hi，避免舊 handler/filter 覆蓋
# 3) /api/set_limits 寫入 web.alarm_limits 與相容 alarm_limits，並 fsync 確認落盤
# 4) Web 前端 setLimit / api 兼容 token query，手機重新整理後仍可設定
# =========================================================
_ORIG_EC62_V50J_LOAD_CONFIG = E62GUI.load_config

def _ec62_v50j_read_saved_alarm_limits(self):
    """讀取 config 內的 Web Hi/Low；支援新版 web.alarm_limits 與舊版 alarm_limits。"""
    out = {uid: {"lo": None, "hi": None} for uid in range(1, self.max_unit_id + 1)}
    try:
        if not os.path.exists(self.config_path):
            return out
        with open(self.config_path, "r", encoding="utf-8") as f:
            cfg = json.load(f) or {}
        web_cfg = cfg.get("web", {}) if isinstance(cfg, dict) else {}
        lims = {}
        if isinstance(web_cfg, dict) and isinstance(web_cfg.get("alarm_limits"), dict):
            lims.update(web_cfg.get("alarm_limits") or {})
        if isinstance(cfg, dict) and isinstance(cfg.get("alarm_limits"), dict):
            # 舊版或外部工具寫入時也能載入
            lims.update(cfg.get("alarm_limits") or {})
        for k, vv in (lims or {}).items():
            try:
                uid = int(str(k).replace("CH", ""))
                if 1 <= uid <= self.max_unit_id and isinstance(vv, dict):
                    lo = self._ec62_limit_float_or_none(vv.get("lo", vv.get("Lo", None)))
                    hi = self._ec62_limit_float_or_none(vv.get("hi", vv.get("Hi", None)))
                    if lo is not None and hi is not None and lo > hi:
                        lo, hi = hi, lo
                    out[uid] = {"lo": lo, "hi": hi}
            except Exception:
                pass
    except Exception as e:
        try:
            self.write_error_log(f"V5.0J read saved alarm limits error: {e}")
        except Exception:
            pass
    return out

def _ec62_v50j_load_config(self):
    _ORIG_EC62_V50J_LOAD_CONFIG(self)
    try:
        saved = _ec62_v50j_read_saved_alarm_limits(self)
        with self.web_lock:
            self.web_alarm_limits = saved
        self.normalize_web_alarm_limits()
        try:
            self.audit("LOAD_WEB_HILOW_V50J", f"path={self.config_path}")
        except Exception:
            pass
    except Exception as e:
        try:
            self.write_error_log(f"V5.0J load_config web hilow error: {e}")
        except Exception:
            pass

E62GUI.load_config = _ec62_v50j_load_config


def _ec62_v50j_write_alarm_limits_config(self):
    """把目前 self.web_alarm_limits 寫回 config，並同步保留相容欄位。"""
    self.normalize_web_alarm_limits()
    cfg = {}
    if os.path.exists(self.config_path):
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                cfg = json.load(f) or {}
        except Exception:
            cfg = {}
    if not isinstance(cfg, dict):
        cfg = {}
    cfg.setdefault("web", {})
    cfg["web"]["alarm_limits"] = self.web_alarm_limits_for_config()
    # 相容舊版讀取點：有些舊 handler 會讀根層 alarm_limits
    cfg["alarm_limits"] = self.web_alarm_limits_for_config()
    cfg["web"]["language"] = getattr(self, "language", "zh")
    cfg["web"]["lan_ip"] = getattr(self, "web_lan_ip", "")
    cfg["web"]["port"] = int(getattr(self, "web_port", 8080) or 8080)
    os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
    with open(self.config_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        try:
            f.flush(); os.fsync(f.fileno())
        except Exception:
            pass
    return cfg


def _ec62_v50j_web_set_alarm_limits(self, uid, lo=None, hi=None):
    """V5.0J：Web LOW/HIGH 寫入、落盤、回讀，重新開程式仍保留。"""
    try:
        n = int(str(uid).strip().upper().replace("CH", ""))
        if n < 1 or n > self.max_unit_id:
            raise ValueError("CH 超出範圍")
        lo_val = self._ec62_limit_float_or_none(lo)
        hi_val = self._ec62_limit_float_or_none(hi)
        if lo_val is not None and hi_val is not None and lo_val > hi_val:
            lo_val, hi_val = hi_val, lo_val
        with self.web_lock:
            self.web_alarm_limits[n] = {"lo": lo_val, "hi": hi_val}
        _ec62_v50j_write_alarm_limits_config(self)
        saved = _ec62_v50j_read_saved_alarm_limits(self).get(n, {})
        chk_lo = saved.get("lo")
        chk_hi = saved.get("hi")
        if chk_lo != lo_val or chk_hi != hi_val:
            raise IOError(f"Config 回讀不一致：CH{n:02d} lo={chk_lo}, hi={chk_hi}")
        try:
            self.audit("WEB_SET_LIMITS_V50J", f"uid={n} lo={lo_val} hi={hi_val} path={self.config_path}")
            self.safe_gui(self.set_status, f"🌐 Web CH{n:02d} Hi/Low 已儲存，重新開機會自動載入", "green")
        except Exception:
            pass
        ch = None
        try:
            snap = self.get_web_snapshot()
            for item in snap.get("channels", []):
                if int(str(item.get("id", "0")).replace("CH", "")) == n:
                    ch = item; break
        except Exception:
            pass
        return {"ok": True, "message": f"CH{n:02d} Web Hi/Low 已儲存", "uid": n, "lo": lo_val, "hi": hi_val, "config_path": self.config_path, "channel": ch}
    except Exception as e:
        try:
            self.write_error_log(f"V5.0J web_set_alarm_limits error: {e}")
        except Exception:
            pass
        return {"ok": False, "message": "Web Hi/Low 儲存失敗：" + str(e)}

E62GUI.web_set_alarm_limits = _ec62_v50j_web_set_alarm_limits

_ORIG_EC62_V50J_GET_WEB_SNAPSHOT = E62GUI.get_web_snapshot

def _ec62_v50j_get_web_snapshot(self):
    snap = _ORIG_EC62_V50J_GET_WEB_SNAPSHOT(self)
    try:
        self.normalize_web_alarm_limits()
        for item in snap.get("channels", []) or []:
            try:
                uid = int(str(item.get("id", "0")).replace("CH", ""))
                lim = self.get_web_alarm_limit(uid)
                item["web_lo"] = lim.get("lo")
                item["web_hi"] = lim.get("hi")
                pv = item.get("pv", None)
                alarm = False
                if pv is not None:
                    pvf = float(pv)
                    if lim.get("lo") is not None and pvf < float(lim.get("lo")):
                        alarm = True
                    if lim.get("hi") is not None and pvf > float(lim.get("hi")):
                        alarm = True
                item["web_alarm"] = alarm and not bool(getattr(self, "web_alarm_ack", {}).get(uid, False))
            except Exception:
                pass
        snap["version"] = "V5.0J-Web-HiLow-Restart-FIX"
    except Exception as e:
        try:
            self.write_error_log(f"V5.0J snapshot hilow patch error: {e}")
        except Exception:
            pass
    return snap

E62GUI.get_web_snapshot = _ec62_v50j_get_web_snapshot

# 權限修正：Admin 全部可設定；Operator 依 CH 權限；若主程式已解鎖，也允許現場直接設定。
_ORIG_EC62_V50J_CAN_USER = _ec62_v51a_can_user

def _ec62_v50j_can_user(self, username=None, role=None, action="view", uid=None):
    if str(action) == "set_limits":
        try:
            if bool(getattr(self, "is_unlocked", False)):
                return True
            r = _ec62_v51a_norm_role(role)
            key = _ec62_v51a_permission_key(role, username)
            if r == "administrator" or key == "admin":
                return True
            if r in ("operator1", "operator2"):
                perm = _ec62_v51a_get_permission(self, username, role)
                try:
                    return int(str(uid).replace("CH", "")) in set(perm.get("channels", []))
                except Exception:
                    return False
            return False
        except Exception:
            return False
    return _ORIG_EC62_V50J_CAN_USER(self, username, role, action, uid)

_ec62_v51a_can_user = _ec62_v50j_can_user

# API data handler 內部若直接呼叫 _ORIG_GET_WEB_SNAPSHOT，改指向 V5.0J snapshot，避免重新執行後 web_lo/web_hi 被舊快照覆蓋。
try:
    _ORIG_GET_WEB_SNAPSHOT = _ec62_v50j_get_web_snapshot
except Exception:
    pass

_ORIG_EC62_V50J_FILTER_SNAPSHOT = _ec62_v51a_filter_snapshot

def _ec62_v50j_filter_snapshot(self, snap, username, role):
    snap = _ORIG_EC62_V50J_FILTER_SNAPSHOT(self, snap, username, role)
    try:
        # 依每個 channel 權限判斷，讓 Operator 只在授權 CH 顯示設定按鈕。
        r = _ec62_v51a_norm_role(role)
        snap["can_set_limits"] = (r == "administrator") or bool(getattr(self, "is_unlocked", False)) or r in ("operator1", "operator2")
        for item in snap.get("channels", []) or []:
            uid = int(str(item.get("id", "0")).replace("CH", ""))
            item["can_set_limits"] = _ec62_v50j_can_user(self, username, role, "set_limits", uid)
    except Exception:
        snap["can_set_limits"] = False
    return snap

_ec62_v51a_filter_snapshot = _ec62_v50j_filter_snapshot

_ORIG_EC62_V50J_WEB_HTML = E62GUI._web_html

def _ec62_v50j_web_html(self):
    html = _ORIG_EC62_V50J_WEB_HTML(self)
    html = html.replace("V5.0I", "V5.0J")
    html = html.replace("Hi-Low Web Save FIX", "Hi-Low Restart FIX")
    html = html.replace("V5.0H", "V5.0J")
    # 確保 setLimit 會帶 token。若前面 patch 已改過，不會重複破壞。
    html = html.replace(
        "const d=await api('/api/set_limits?uid='+encodeURIComponent(uid)+'&lo='+encodeURIComponent(lo)+'&hi='+encodeURIComponent(hi));",
        "const d=await api('/api/set_limits?uid='+encodeURIComponent(uid)+'&lo='+encodeURIComponent(lo)+'&hi='+encodeURIComponent(hi)+'&token='+encodeURIComponent(ec62Token||''));"
    )
    # 若原本只看 d.can_set_limits，改為每張卡優先看 c.can_set_limits。
    html = html.replace("${d.can_set_limits?`<button class=\"smallbtn\" onclick=\"setLimit('${c.id}',${c.web_lo===null||c.web_lo===undefined?'null':JSON.stringify(c.web_lo)},${c.web_hi===null||c.web_hi===undefined?'null':JSON.stringify(c.web_hi)})\">${T('設定MAX/MIN')}</button>`:''}", "${(c.can_set_limits||d.can_set_limits)?`<button class=\"smallbtn\" onclick=\"setLimit('${c.id}',${c.web_lo===null||c.web_lo===undefined?'null':JSON.stringify(c.web_lo)},${c.web_hi===null||c.web_hi===undefined?'null':JSON.stringify(c.web_hi)})\">${T('設定MAX/MIN')}</button>`:''}")
    return html

E62GUI._web_html = _ec62_v50j_web_html



# =========================================================
# V5.2D Account Permission Dynamic Operator ADD / DELETE
# - Admin 可新增 / 刪除 Operator 帳號
# - 保留 admin / guest，不可刪除
# - CH 權限格式：CH01-CH05、1-5、6,7,8 或 all
# - Config 直接寫入 users / user_permissions
# =========================================================

_EC62_V52D_VERSION = "E62 / C62 Web V5.2 CH30 Alarm Audit"


def _ec62_v52d_is_operator_key(key):
    k = str(key or '').strip().lower()
    return k.startswith('operator') and k not in ('administrator',)


def _ec62_v52d_sort_user_keys(keys):
    def score(k):
        k = str(k or '').lower()
        if k == 'admin': return (0, 0, k)
        if k.startswith('operator'):
            try: n = int(''.join(ch for ch in k if ch.isdigit()) or '999')
            except Exception: n = 999
            return (1, n, k)
        if k == 'guest': return (9, 0, k)
        return (2, 999, k)
    return sorted([str(k).strip().lower() for k in keys if str(k).strip()], key=score)


def _ec62_v52d_next_operator_key(users=None, perms=None):
    used = set()
    try:
        used.update(str(k).lower() for k in (users or {}).keys())
        used.update(str(k).lower() for k in (perms or {}).keys())
    except Exception:
        pass
    for i in range(1, 101):
        k = f'operator{i}'
        if k not in used:
            return k
    return 'operator_new'


_ORIG_EC62_V52D_NORM_ROLE = _ec62_v51a_norm_role
_ORIG_EC62_V52D_PERMISSION_KEY = _ec62_v51a_permission_key
_ORIG_EC62_V52D_ROLE_NAME = _ec62_v51a_role_name
_ORIG_EC62_V52D_CAN_USER = _ec62_v51a_can_user
_ORIG_EC62_V52D_FILTER_SNAPSHOT = _ec62_v51a_filter_snapshot


def _ec62_v52d_norm_role(role):
    r = str(role or '').strip().lower()
    if r in ('admin', 'administrator', '管理者'):
        return 'administrator'
    if r in ('guest', '訪客'):
        return 'guest'
    if _ec62_v52d_is_operator_key(r):
        return r
    return _ORIG_EC62_V52D_NORM_ROLE(role)


def _ec62_v52d_permission_key(role, username=None):
    u = str(username or '').strip().lower()
    if u in ('admin', 'guest') or _ec62_v52d_is_operator_key(u):
        return u
    r = _ec62_v52d_norm_role(role)
    if r == 'administrator': return 'admin'
    if r == 'guest': return 'guest'
    if _ec62_v52d_is_operator_key(r): return r
    return _ORIG_EC62_V52D_PERMISSION_KEY(role, username)


def _ec62_v52d_role_name(role, lang='en'):
    r = _ec62_v52d_norm_role(role)
    is_zh = str(lang or '').lower().startswith('zh') or str(lang or '') in ('中文', 'cn')
    if r == 'administrator': return '管理者' if is_zh else 'Admin'
    if r == 'guest': return '訪客' if is_zh else 'Guest'
    if _ec62_v52d_is_operator_key(r):
        digits = ''.join(ch for ch in r if ch.isdigit())
        return ('操作者' if is_zh else 'Operator') + (digits or '')
    return _ORIG_EC62_V52D_ROLE_NAME(role, lang)


_ec62_v51a_norm_role = _ec62_v52d_norm_role
_ec62_v51a_permission_key = _ec62_v52d_permission_key
_ec62_v51a_role_name = _ec62_v52d_role_name
try:
    _ec62_v50_norm_role = _ec62_v52d_norm_role
    _ec62_v50_role_name = _ec62_v52d_role_name
except Exception:
    pass


def _ec62_v52d_default_perm_for_key(key):
    k = str(key or '').strip().lower()
    if k == 'admin':
        return {'channels': 'all', 'dashboard': True, 'trend': True, 'alarm_history': True, 'alarm_recovery': True, 'config': True, 'delete': True, 'download_log': True}
    if k == 'guest':
        return {'channels': [1], 'dashboard': True, 'trend': False, 'alarm_history': False, 'alarm_recovery': False, 'config': False, 'delete': False, 'download_log': False}
    return {'channels': [1], 'dashboard': True, 'trend': True, 'alarm_history': True, 'alarm_recovery': True, 'config': False, 'delete': False, 'download_log': False}


def _ec62_v52d_permissions_payload(self):
    try:
        _ec62_v51a_normalize_users_permissions(self)
    except Exception:
        pass
    users = dict(getattr(self, 'users', {}) or {})
    perms = dict(getattr(self, 'user_permissions', {}) or {})
    admin_pw = getattr(self, 'password', DEFAULT_PASSWORD)
    users.setdefault('admin', {'password': admin_pw, 'role': 'administrator', 'display': 'Admin'})
    users.setdefault('guest', {'password': '', 'role': 'guest', 'display': 'Guest'})
    perms.setdefault('admin', _ec62_v52d_default_perm_for_key('admin'))
    perms.setdefault('guest', _ec62_v52d_default_perm_for_key('guest'))
    if not any(_ec62_v52d_is_operator_key(k) for k in users.keys()):
        users.setdefault('operator1', {'password': '1234', 'role': 'operator1', 'display': 'Operator1'})
        perms.setdefault('operator1', _ec62_v52d_default_perm_for_key('operator1'))
    rows = []
    for key in _ec62_v52d_sort_user_keys(set(users.keys()) | set(perms.keys())):
        if key not in ('admin', 'guest') and not _ec62_v52d_is_operator_key(key):
            continue
        u = dict(users.get(key, {}))
        perm = dict(perms.get(key, _ec62_v52d_default_perm_for_key(key)))
        role = 'administrator' if key == 'admin' else ('guest' if key == 'guest' else key)
        rows.append({
            'key': key,
            'display': u.get('display', _ec62_v52d_role_name(role, 'en')),
            'role': role,
            'password': u.get('password', ''),
            'channels_text': _ec62_v51b_channels_text(perm.get('channels', 'all' if key == 'admin' else [1])),
            'dashboard': bool(perm.get('dashboard', True)),
            'trend': bool(perm.get('trend', key != 'guest')),
            'alarm_history': bool(perm.get('alarm_history', key != 'guest')),
            'alarm_recovery': bool(perm.get('alarm_recovery', key not in ('guest',))),
            'config': bool(perm.get('config', key == 'admin')),
            'delete': bool(perm.get('delete', key == 'admin')),
            'download_log': bool(perm.get('download_log', perm.get('delete', key == 'admin'))),
            'deletable': bool(key not in ('admin', 'guest')),
        })
    return {'ok': True, 'rows': rows, 'next_operator': _ec62_v52d_next_operator_key(users, perms)}


def _ec62_v52d_apply_permissions_payload(self, data):
    rows = (data or {}).get('rows', [])
    if not isinstance(rows, list):
        return {'ok': False, 'message': '資料格式錯誤 / Invalid data'}
    try:
        cfg = {}
        try:
            if os.path.exists(self.config_path):
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f) or {}
        except Exception:
            cfg = {}
        try:
            _ec62_v51a_normalize_users_permissions(self)
        except Exception:
            pass
        users = dict(getattr(self, 'users', {}) or {})
        perms = dict(getattr(self, 'user_permissions', {}) or {})
        users.setdefault('admin', {'password': getattr(self, 'password', DEFAULT_PASSWORD), 'role': 'administrator', 'display': 'Admin'})
        users.setdefault('guest', {'password': '', 'role': 'guest', 'display': 'Guest'})
        perms.setdefault('admin', _ec62_v52d_default_perm_for_key('admin'))
        perms.setdefault('guest', _ec62_v52d_default_perm_for_key('guest'))
        for r in rows:
            if not isinstance(r, dict):
                continue
            key = str(r.get('key', '')).strip().lower()
            if not key:
                key = _ec62_v52d_next_operator_key(users, perms)
            key = ''.join(ch for ch in key if ch.isalnum() or ch == '_').lower()
            if key == 'administrator':
                key = 'admin'
            if key not in ('admin', 'guest') and not _ec62_v52d_is_operator_key(key):
                key = _ec62_v52d_next_operator_key(users, perms)
            if bool(r.get('_delete') or r.get('delete_user')) and key not in ('admin', 'guest'):
                users.pop(key, None); perms.pop(key, None); continue
            old_user = users.get(key, {}) if isinstance(users.get(key, {}), dict) else {}
            role = 'administrator' if key == 'admin' else ('guest' if key == 'guest' else key)
            display_default = _ec62_v52d_role_name(role, 'en')
            users[key] = {
                'password': str(r.get('password', old_user.get('password', '')) or ''),
                'role': role,
                'display': str(r.get('display', old_user.get('display', display_default)) or display_default).strip(),
            }
            base = _ec62_v52d_default_perm_for_key(key)
            old_perm = perms.get(key, {}) if isinstance(perms.get(key, {}), dict) else {}
            base.update(old_perm)
            ch_text = r.get('channels_text', base.get('channels', [1]))
            base['channels'] = 'all' if key == 'admin' or str(ch_text).strip().lower() == 'all' else _ec62_v51b_norm_channels(ch_text, base.get('channels', [1]))
            if key == 'admin':
                base.update(_ec62_v52d_default_perm_for_key('admin'))
            else:
                for flag in ['dashboard', 'trend', 'alarm_history', 'alarm_recovery', 'config', 'delete', 'download_log']:
                    base[flag] = bool(r.get(flag, base.get(flag, False)))
                base['config'] = False
                if key == 'guest':
                    base['alarm_recovery'] = False; base['delete'] = False; base['download_log'] = False
            perms[key] = base
        if not any(_ec62_v52d_is_operator_key(k) for k in users.keys()):
            k = _ec62_v52d_next_operator_key(users, perms)
            users[k] = {'password': '1234', 'role': k, 'display': k.title()}
            perms[k] = _ec62_v52d_default_perm_for_key(k)
        self.users = users
        self.user_permissions = perms
        self.password = users.get('admin', {}).get('password') or getattr(self, 'password', DEFAULT_PASSWORD)
        cfg['users'] = users
        cfg['user_permissions'] = perms
        cfg['password'] = self.password
        os.makedirs(os.path.dirname(self.config_path), exist_ok=True)
        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return {'ok': True, 'message': '帳號權限已儲存，可新增 / 刪除操作者', 'users_permissions': _ec62_v52d_permissions_payload(self)}
    except Exception as e:
        try: self.write_error_log(f'V5.2D dynamic operator permission save error: {e}')
        except Exception: pass
        return {'ok': False, 'message': '儲存失敗：' + str(e)}


def _ec62_v52d_can_user(self, username=None, role=None, action='view', uid=None):
    try:
        key = _ec62_v52d_permission_key(role, username)
        r = _ec62_v52d_norm_role(role)
        if action == 'set_limits':
            if r == 'administrator' or key == 'admin':
                return True
            if _ec62_v52d_is_operator_key(key) or _ec62_v52d_is_operator_key(r):
                perm = _ec62_v51a_get_permission(self, username, role)
                chs = perm.get('channels', [])
                if chs == 'all': return True
                try: return int(str(uid).replace('CH', '')) in set(chs)
                except Exception: return False
            return False
    except Exception:
        pass
    return _ORIG_EC62_V52D_CAN_USER(self, username, role, action, uid)


_ec62_v51a_can_user = _ec62_v52d_can_user


def _ec62_v52d_filter_snapshot(self, snap, username, role):
    snap = _ORIG_EC62_V52D_FILTER_SNAPSHOT(self, snap, username, role)
    try:
        perm = _ec62_v51a_get_permission(self, username, role)
        snap['users_permissions'] = _ec62_v52d_permissions_payload(self) if bool(perm.get('config')) else None
        snap['can_set_limits'] = _ec62_v52d_norm_role(role) == 'administrator' or _ec62_v52d_is_operator_key(_ec62_v52d_permission_key(role, username))
        for item in snap.get('channels', []) or []:
            try:
                uid = int(str(item.get('id', '0')).replace('CH', ''))
                item['can_set_limits'] = _ec62_v52d_can_user(self, username, role, 'set_limits', uid)
            except Exception:
                item['can_set_limits'] = False
        snap['title'] = _EC62_V52D_VERSION
        snap['version'] = 'V5.2 CH30 Alarm Audit'
    except Exception as e:
        try: self.write_error_log(f'V5.2D filter snapshot error: {e}')
        except Exception: pass
    return snap


_ec62_v51a_filter_snapshot = _ec62_v52d_filter_snapshot

_ORIG_EC62_V52D_WEB_HTML = E62GUI._web_html


def _ec62_v52d_web_html(self):
    html = _ORIG_EC62_V52D_WEB_HTML(self)
    for old in ['E62 / EC62 Web V5.0', 'EC62 Web V5.0H Alarm History', 'EC62 Web V5.0 Permission Setting']:
        html = html.replace(old, _EC62_V52D_VERSION)
    for old in ['V5.0H-CH30-HiLowSave', 'V5.0J', 'V5.0I', 'V5.0H', 'V5.1F', 'V5.1E']:
        html = html.replace(old, 'V5.2')
    html = html.replace('Admin 登入後可設定 Operator 名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。',
                        'Admin 登入後可新增、刪除 Operator，並設定名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。')
    dynamic_js = '''
<script>
(function(){
function escPerm(s){return String(s===undefined||s===null?'':s).replace(/[&<>\\"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','\\"':'&quot;',"'":'&#39;'}[m];});}
function pT(zh,en){return (typeof webLang!=='undefined' && webLang==='en')?en:zh;}
function pChk(v){return v?'checked':'';}
window._permEditing=false; window._permLastPayload=null;
window.permEditStart=function(){window._permEditing=true; var m=document.getElementById('permEditMsg'); if(m)m.textContent=pT('編輯中，請按「儲存帳號權限」寫入設定。','Editing. Press Save Permissions to write settings.');};
window.updatePermissionLang=function(){var title=document.getElementById('permTitle'),note=document.getElementById('permNote'),btn=document.getElementById('permSaveBtn'),add=document.getElementById('permAddBtn'); if(title)title.textContent=pT('帳號權限設定','Account Permission Setting'); if(note)note.textContent=pT('Admin 登入後可新增、刪除 Operator，並設定名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。','After Admin login, you can add/delete Operators and configure name, password and channels. Channel format: CH01-CH05, 1-5, 6,7,8 or all.'); if(btn)btn.textContent=pT('儲存帳號權限','Save Permissions'); if(add)add.textContent=pT('新增操作者','Add Operator');};
window.addOperatorRow=function(){var p=window._permLastPayload||{rows:[]}; var used={}; (p.rows||[]).forEach(function(r){used[String(r.key).toLowerCase()]=true;}); var key='operator1'; for(var i=1;i<=100;i++){if(!used['operator'+i]){key='operator'+i;break;}} p.rows=p.rows||[]; p.rows.splice(Math.max(1,p.rows.length-1),0,{key:key,display:'Operator'+key.replace(/[^0-9]/g,''),role:key,password:'1234',channels_text:'CH01-CH05',dashboard:true,trend:true,alarm_history:true,alarm_recovery:true,config:false,delete:false,download_log:false,deletable:true}); window._permLastPayload=p; window._permEditing=true; setPermissionForm(p,true);};
window.markDeleteOperator=function(key){if(key==='admin'||key==='guest')return; if(!confirm(pT('確定刪除此操作者？','Delete this operator?')))return; var tr=document.querySelector('tr[data-user="'+String(key).replace(/"/g,'')+'"]'); if(tr){tr.setAttribute('data-delete','1'); tr.style.opacity='0.45'; tr.style.textDecoration='line-through';} window._permEditing=true;};
window.setPermissionForm=function(p,force){var sec=document.getElementById('permSection'),box=document.getElementById('permRows'); if(!sec||!box)return; if(!p||!p.rows){sec.style.display='none';return;} sec.style.display='block'; window._permLastPayload=JSON.parse(JSON.stringify(p)); updatePermissionLang(); if(window._permEditing&&!force)return; var toolbar='<div class="notify-actions"><button class="smallbtn" id="permAddBtn" onclick="addOperatorRow()">'+pT('新增操作者','Add Operator')+'</button></div>'; var head='<table class="histtable"><thead><tr><th>'+pT('帳號','Account')+'</th><th>'+pT('顯示名稱','Display Name')+'</th><th>'+pT('密碼','Password')+'</th><th>'+pT('CH 權限','CH Permission')+'</th><th>'+pT('即時監控','Dashboard')+'</th><th>'+pT('趨勢圖','Trend')+'</th><th>'+pT('警報紀錄','Alarm History')+'</th><th>'+pT('解除','Recovery')+'</th><th>'+pT('刪除紀錄','Delete Log')+'</th><th>'+pT('操作','Action')+'</th></tr></thead><tbody>'; var body=(p.rows||[]).map(function(r){var key=escPerm(r.key),admin=r.key==='admin',guest=r.key==='guest',del=!!r.deletable; return '<tr data-user="'+key+'"><td><b>'+key+'</b></td><td><input oninput="permEditStart()" onchange="permEditStart()" id="perm_'+key+'_display" value="'+escPerm(r.display)+'" style="width:120px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px"></td><td><input oninput="permEditStart()" onchange="permEditStart()" id="perm_'+key+'_password" type="text" value="'+escPerm(r.password)+'" style="width:110px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px"></td><td><input oninput="permEditStart()" onchange="permEditStart()" id="perm_'+key+'_channels" value="'+escPerm(r.channels_text)+'" '+(admin?'readonly':'')+' style="width:145px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px"></td><td><input onchange="permEditStart()" type="checkbox" id="perm_'+key+'_dashboard" '+pChk(r.dashboard)+' '+(admin?'disabled':'')+'></td><td><input onchange="permEditStart()" type="checkbox" id="perm_'+key+'_trend" '+pChk(r.trend)+' '+(admin?'disabled':'')+'></td><td><input onchange="permEditStart()" type="checkbox" id="perm_'+key+'_alarm_history" '+pChk(r.alarm_history)+' '+(admin?'disabled':'')+'></td><td><input onchange="permEditStart()" type="checkbox" id="perm_'+key+'_alarm_recovery" '+pChk(r.alarm_recovery)+' '+((admin||guest)?'disabled':'')+'></td><td><input onchange="permEditStart()" type="checkbox" id="perm_'+key+'_delete" '+pChk(r.delete)+' '+(admin?'disabled':'')+'></td><td>'+(del?'<button class="smallbtn orange" onclick="markDeleteOperator(\\''+key+'\\')">'+pT('刪除操作者','Delete')+'</button>':'--')+'</td></tr>';}).join(''); box.innerHTML=toolbar+head+body+'</tbody></table><div class="note" id="permEditMsg">'+pT('可按「新增操作者」增加 Operator；刪除後需按「儲存帳號權限」才會寫入。','Press Add Operator to add an Operator. Deletions are saved only after pressing Save Permissions.')+'</div>';};
window.getPermissionForm=function(){var rows=[]; document.querySelectorAll('#permRows tr[data-user]').forEach(function(tr){var k=tr.getAttribute('data-user')||''; var val=function(s){var e=document.getElementById('perm_'+k+'_'+s);return e?e.value:'';}; var chk=function(s){var e=document.getElementById('perm_'+k+'_'+s);return e?!!e.checked:false;}; rows.push({key:k,_delete:tr.getAttribute('data-delete')==='1',display:val('display'),password:val('password'),channels_text:val('channels'),dashboard:chk('dashboard'),trend:chk('trend'),alarm_history:chk('alarm_history'),alarm_recovery:chk('alarm_recovery'),config:false,delete:chk('delete'),download_log:chk('delete')});}); return {token:(typeof ec62Token!=='undefined'?ec62Token:''),rows:rows};};
window.savePermissions=async function(){if(!confirm(pT('儲存帳號權限設定？','Save account permission settings?')))return; var d=await postJson('/api/save_permissions',getPermissionForm()); alert(d.message||((typeof webLang!=='undefined'&&webLang==='en'&&d.ok)?'Account permissions saved':'帳號權限已儲存')); if(d.ok){window._permEditing=false; if(d.users_permissions)setPermissionForm(d.users_permissions,true); await load();}};
})();
</script>
'''
    if '</body>' in html:
        html = html.replace('</body>', dynamic_js + '\n</body>', 1)
    else:
        html += dynamic_js
    return html


E62GUI._web_html = _ec62_v52d_web_html
E62GUI.get_permissions_payload = _ec62_v52d_permissions_payload
E62GUI.apply_permissions_payload = _ec62_v52d_apply_permissions_payload
_ec62_v51b_permissions_payload = _ec62_v52d_permissions_payload
_ec62_v51b_apply_permissions_payload = _ec62_v52d_apply_permissions_payload

try:
    _ORIG_EC62_V52D_INIT = E62GUI.__init__
    def _ec62_v52d_init(self, root):
        _ORIG_EC62_V52D_INIT(self, root)
        try:
            self.web_title = _EC62_V52D_VERSION
            self.root.title('E62/C62 RTU V5.2 CH30 Alarm Audit')
        except Exception:
            pass
    E62GUI.__init__ = _ec62_v52d_init
except Exception:
    pass

# Application startup is intentionally located after the final Web overrides.


# =========================================================
# V5.2E Operator ADD Button FINAL FIX
# - 修正「無增加 Operator」：最後覆蓋 Web JS，避免舊版 setPermissionForm/savePermissions 蓋回
# - 新增 Operator 按鈕固定顯示於帳號權限設定區上方
# - 新增後立即插入表格，按「儲存帳號權限」後寫入 Config
# =========================================================
try:
    _ORIG_EC62_V52E_WEB_HTML = E62GUI._web_html

    def _ec62_v52e_web_html(self):
        html = _ORIG_EC62_V52E_WEB_HTML(self)
        final_js = r'''
<script id="v52eOperatorAddFix">
(function(){
  function pT2(zh,en){return (typeof webLang!=='undefined' && webLang==='en')?en:zh;}
  function esc2(s){return String(s===undefined||s===null?'':s).replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]||m;});}
  function chk2(v){return v?'checked':'';}
  function permEditStart2(){window._permEditing=true; var m=document.getElementById('permEditMsg'); if(m)m.textContent=pT2('編輯中，請按「儲存帳號權限」寫入設定。','Editing. Press Save Permissions to write settings.');}
  window.permEditStart=permEditStart2;
  window.updatePermissionLang=function(){
    var title=document.getElementById('permTitle'),note=document.getElementById('permNote'),btn=document.getElementById('permSaveBtn'),add=document.getElementById('permAddBtn');
    if(title)title.textContent=pT2('帳號權限設定','Account Permission Setting');
    if(note)note.textContent=pT2('Admin 登入後可新增、刪除 Operator，並設定名稱、密碼與對應 CH。CH 格式可輸入：CH01-CH05、1-5、6,7,8 或 all。','After Admin login, you can add/delete Operators and configure name, password and channels. Channel format: CH01-CH05, 1-5, 6,7,8 or all.');
    if(btn)btn.textContent=pT2('儲存帳號權限','Save Permissions');
    if(add)add.textContent=pT2('＋ 新增 Operator','＋ Add Operator');
  };
  window.addOperatorRow=function(){
    var p=window._permLastPayload||{ok:true,rows:[]};
    p.rows=p.rows||[];
    var used={};
    p.rows.forEach(function(r){used[String(r.key||'').toLowerCase()]=true;});
    var key='operator1';
    for(var i=1;i<=100;i++){ if(!used['operator'+i]){key='operator'+i;break;} }
    var row={key:key,display:'Operator'+key.replace(/[^0-9]/g,''),role:key,password:'1234',channels_text:'CH01-CH05',dashboard:true,trend:true,alarm_history:true,alarm_recovery:true,config:false,delete:false,download_log:false,deletable:true};
    var insertAt=p.rows.length;
    for(var j=0;j<p.rows.length;j++){ if(String(p.rows[j].key).toLowerCase()==='guest'){insertAt=j;break;} }
    p.rows.splice(insertAt,0,row);
    window._permLastPayload=p;
    window._permEditing=true;
    window.setPermissionForm(p,true);
    setTimeout(function(){var e=document.getElementById('perm_'+key+'_display'); if(e){e.focus(); e.select();}},50);
  };
  window.markDeleteOperator=function(key){
    key=String(key||'').toLowerCase();
    if(key==='admin'||key==='guest')return;
    if(!confirm(pT2('確定刪除此操作者？','Delete this operator?')))return;
    var tr=document.querySelector('#permRows tr[data-user="'+key.replace(/"/g,'')+'"]');
    if(tr){tr.setAttribute('data-delete','1'); tr.style.opacity='0.45'; tr.style.textDecoration='line-through';}
    window._permEditing=true;
  };
  window.setPermissionForm=function(p,force){
    var sec=document.getElementById('permSection'),box=document.getElementById('permRows');
    if(!sec||!box)return;
    if(!p||!p.rows){sec.style.display='none';return;}
    sec.style.display='block';
    if(window._permEditing && !force){return;}
    window._permLastPayload=JSON.parse(JSON.stringify(p));
    var html='';
    html+='<div class="notify-actions" style="margin:8px 0 12px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
    html+='<button class="smallbtn" id="permAddBtn" onclick="addOperatorRow()" style="font-weight:bold">'+pT2('＋ 新增 Operator','＋ Add Operator')+'</button>';
    html+='<span class="note" id="permEditMsg">'+pT2('按「＋ 新增 Operator」後會立即增加一列，最後按「儲存帳號權限」寫入。','Press + Add Operator to insert a row, then Save Permissions to write it.')+'</span>';
    html+='</div>';
    html+='<table class="histtable"><thead><tr>';
    html+='<th>'+pT2('帳號','Account')+'</th><th>'+pT2('顯示名稱','Display Name')+'</th><th>'+pT2('密碼','Password')+'</th><th>'+pT2('CH 權限','CH Permission')+'</th>';
    html+='<th>'+pT2('即時監控','Dashboard')+'</th><th>'+pT2('趨勢圖','Trend')+'</th><th>'+pT2('警報紀錄','Alarm History')+'</th><th>'+pT2('解除','Recovery')+'</th><th>'+pT2('刪除紀錄','Delete Log')+'</th><th>'+pT2('操作','Action')+'</th>';
    html+='</tr></thead><tbody>';
    (p.rows||[]).forEach(function(r){
      var key=String(r.key||'').toLowerCase();
      if(!key)return;
      var admin=key==='admin', guest=key==='guest', del=!!r.deletable && !admin && !guest;
      html+='<tr data-user="'+esc2(key)+'">';
      html+='<td><b>'+esc2(key)+'</b></td>';
      html+='<td><input oninput="permEditStart()" onchange="permEditStart()" id="perm_'+esc2(key)+'_display" value="'+esc2(r.display)+'" style="width:120px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px"></td>';
      html+='<td><input oninput="permEditStart()" onchange="permEditStart()" id="perm_'+esc2(key)+'_password" type="text" value="'+esc2(r.password)+'" style="width:110px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px"></td>';
      html+='<td><input oninput="permEditStart()" onchange="permEditStart()" id="perm_'+esc2(key)+'_channels" value="'+esc2(r.channels_text)+'" '+(admin?'readonly':'')+' style="width:145px;background:#0b1220;color:white;border:1px solid #334155;border-radius:8px;padding:6px"></td>';
      html+='<td><input onchange="permEditStart()" type="checkbox" id="perm_'+esc2(key)+'_dashboard" '+chk2(r.dashboard)+' '+(admin?'disabled':'')+'></td>';
      html+='<td><input onchange="permEditStart()" type="checkbox" id="perm_'+esc2(key)+'_trend" '+chk2(r.trend)+' '+(admin?'disabled':'')+'></td>';
      html+='<td><input onchange="permEditStart()" type="checkbox" id="perm_'+esc2(key)+'_alarm_history" '+chk2(r.alarm_history)+' '+(admin?'disabled':'')+'></td>';
      html+='<td><input onchange="permEditStart()" type="checkbox" id="perm_'+esc2(key)+'_alarm_recovery" '+chk2(r.alarm_recovery)+' '+((admin||guest)?'disabled':'')+'></td>';
      html+='<td><input onchange="permEditStart()" type="checkbox" id="perm_'+esc2(key)+'_delete" '+chk2(r.delete)+' '+(admin?'disabled':'')+'></td>';
      html+='<td>'+(del?'<button class="smallbtn orange" onclick="markDeleteOperator(\''+esc2(key)+'\')">'+pT2('刪除操作者','Delete')+'</button>':'--')+'</td>';
      html+='</tr>';
    });
    html+='</tbody></table>';
    box.innerHTML=html;
    window.updatePermissionLang();
  };
  window.getPermissionForm=function(){
    var rows=[];
    document.querySelectorAll('#permRows tr[data-user]').forEach(function(tr){
      var k=(tr.getAttribute('data-user')||'').toLowerCase();
      var val=function(s){var e=document.getElementById('perm_'+k+'_'+s);return e?e.value:'';};
      var chk=function(s){var e=document.getElementById('perm_'+k+'_'+s);return e?!!e.checked:false;};
      rows.push({key:k,_delete:tr.getAttribute('data-delete')==='1',display:val('display'),password:val('password'),channels_text:val('channels'),dashboard:chk('dashboard'),trend:chk('trend'),alarm_history:chk('alarm_history'),alarm_recovery:chk('alarm_recovery'),config:false,delete:chk('delete'),download_log:chk('delete')});
    });
    return {token:(typeof ec62Token!=='undefined'?ec62Token:''),rows:rows};
  };
  window.savePermissions=async function(){
    if(!confirm(pT2('儲存帳號權限設定？','Save account permission settings?')))return;
    var d=await postJson('/api/save_permissions',window.getPermissionForm());
    alert(d.message||((typeof webLang!=='undefined'&&webLang==='en'&&d.ok)?'Account permissions saved':'帳號權限已儲存'));
    if(d.ok){window._permEditing=false; if(d.users_permissions)window.setPermissionForm(d.users_permissions,true); await load();}
  };
  setInterval(function(){
    var sec=document.getElementById('permSection'),box=document.getElementById('permRows');
    if(sec && sec.style.display!=='none' && box && !document.getElementById('permAddBtn') && window._permLastPayload && window._permLastPayload.rows){
      window.setPermissionForm(window._permLastPayload,true);
    }
  },1500);
})();
</script>
'''
        if '</body>' in html:
            html = html.replace('</body>', final_js + '\n</body>', 1)
        else:
            html += final_js
        return html

    E62GUI._web_html = _ec62_v52e_web_html
except Exception:
    pass


# =========================================================
# V5.2F Web Dashboard Modules
# - 以 /api/data 的 status、channels、history、權限欄位為資料來源
# - 將既有功能整理為總覽 / 通道 / 警報中心 / 系統管理
# =========================================================
_ORIG_EC62_V52F_WEB_HTML = E62GUI._web_html


def _ec62_v52f_web_html(self):
        html = _ORIG_EC62_V52F_WEB_HTML(self)
        module_css = r'''
<style id="v52f-dashboard-style">
:root{--ink:#10233d;--canvas:#f4f7fb;--surface:#ffffff;--surface-alt:#edf3f9;--line:#d8e2ee;--muted:#60748b;--accent:#087e8b;--blue:#2364aa;--green:#16856b;--amber:#c77d10;--danger:#c53b4b;--nav:#10233d}body{background:var(--canvas)!important;color:var(--ink)!important;font-family:"Segoe UI","Microsoft JhengHei",sans-serif!important}header{background:var(--nav)!important;box-shadow:none!important;padding:18px clamp(14px,2vw,34px) 14px!important;border-bottom:0!important}header h1{color:#f5fbff!important;font-size:24px!important;letter-spacing:0!important}.sub{color:#8ed1dc!important}.top{margin-top:10px!important}.pill{background:#1b3657!important;border-color:#31557f!important;color:#d9edff!important}.module-nav{display:flex;gap:4px;margin-top:18px;padding-top:12px;border-top:1px solid #2c4b6e;overflow-x:auto}.module-tab{appearance:none;border:0;background:transparent;color:#b8cae0;font-size:14px;font-weight:700;padding:10px 14px;cursor:pointer;border-bottom:3px solid transparent;white-space:nowrap}.module-tab[aria-selected="true"]{color:#fff;border-bottom-color:#72d1d8}.module-tab:focus-visible{outline:2px solid #f5c65a;outline-offset:-2px}.module-shell{width:100%;max-width:none;margin:0;padding:22px clamp(12px,2vw,34px) 40px}.module-view[hidden]{display:none!important}.module-heading{display:flex;align-items:end;justify-content:space-between;gap:16px;margin:0 0 16px}.module-heading h2{font-size:22px;margin:0;color:var(--ink);letter-spacing:0}.module-heading p{margin:5px 0 0;color:var(--muted);font-size:13px}.module-status{font-size:12px;font-weight:700;color:var(--accent);background:#dff4f3;padding:7px 10px;border-radius:5px}.summary{padding:0!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:10px!important}.sum{background:var(--surface)!important;border:1px solid var(--line)!important;border-radius:8px!important;padding:13px 16px!important;text-align:left!important;box-shadow:0 2px 8px #10233d0d}.sum b{font-size:26px!important;color:var(--blue)!important}.sum span{margin-top:3px;display:block;text-transform:uppercase;letter-spacing:0;color:var(--muted)!important}.wrap{padding:0!important;grid-template-columns:repeat(auto-fit,minmax(270px,1fr))!important;gap:14px!important}.card{background:var(--surface)!important;border:1px solid var(--line)!important;border-radius:6px!important;box-shadow:0 2px 8px #10233d0d!important;padding:16px!important}.card.ok{border-top:4px solid var(--green)!important}.card.warn{border-top:4px solid var(--amber)!important}.card.bad{border-top:4px solid var(--danger)!important;background:#fff!important}.name{color:var(--ink)!important}.badge{border-radius:4px!important}.pv{font-size:38px!important;color:var(--green)!important;letter-spacing:0!important}.sv{color:var(--blue)!important}.mini,.limit,.minmax div{background:#f7fafc!important;border-color:var(--line)!important}.history,.notify{margin:0!important;background:var(--surface)!important;border:1px solid var(--line)!important;border-radius:6px!important;padding:18px!important;box-shadow:0 2px 8px #10233d0d}.history h2,.notify h2{color:var(--ink)!important;font-size:18px!important}.histtable th{color:var(--muted)!important;background:#f3f7fa}.histtable td,.histtable th{border-bottom-color:var(--line)!important;padding:9px!important}.smallbtn,.btn{border-radius:5px!important;background:var(--blue)!important}.smallbtn.orange,.btn.orange{background:var(--amber)!important}.btn.red{background:var(--danger)!important}.btn.green{background:var(--green)!important}footer{background:#fff!important;border-top:1px solid var(--line)!important;box-shadow:0 -4px 16px #10233d12!important}.module-view footer{position:static!important;margin-top:16px;padding:16px!important;box-shadow:none!important;border:1px solid var(--line)!important;border-radius:6px}.module-admin-grid{display:grid;gap:16px}.auth-panel{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:18px;box-shadow:0 2px 8px #10233d0d}.auth-panel input{width:min(100%,320px);padding:10px;border:1px solid var(--line);border-radius:5px;margin:4px;color:var(--ink)}.auth-panel button{padding:10px 16px;margin:4px;border:0;border-radius:5px;background:var(--blue);color:#fff;font-weight:700;cursor:pointer}.loginState{font-size:12px;color:#b8cae0;margin-left:auto;align-self:center;white-space:nowrap}.sensor-toolbar{display:flex;justify-content:space-between;gap:14px;align-items:end;margin-top:14px;padding:12px 14px;background:#fff;border:1px solid var(--line);border-radius:8px}.sensor-range-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:1px}.sensor-range-tab{border:1px solid var(--line);background:#f5f8fb;color:var(--muted);border-radius:6px;padding:8px 12px;font-weight:700;white-space:nowrap;cursor:pointer}.sensor-range-tab[aria-pressed="true"]{background:var(--nav);border-color:var(--nav);color:#fff}.sensor-tools{display:flex;gap:8px}.sensor-search,.sensor-filter{display:grid;gap:3px;color:var(--muted);font-size:11px;font-weight:700}.sensor-search input,.sensor-filter select{height:34px;border:1px solid var(--line);border-radius:6px;background:#fff;color:var(--ink);padding:0 10px}.sensor-search input{width:180px}.sensor-grid-meta{display:flex;justify-content:space-between;align-items:center;margin:16px 2px 9px}.sensor-grid-meta b{font-size:15px}.sensor-grid-meta span{font-size:12px;color:var(--muted)}.sensor-overview-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:9px}.sensor-tile{min-width:0;background:#fff;border:1px solid var(--line);border-top:4px solid var(--green);border-radius:8px;padding:11px 12px;box-shadow:0 2px 7px #10233d0a}.sensor-tile.alarm{border-top-color:var(--danger);background:#fff9fa}.sensor-tile.error{border-top-color:#7b8797;background:#f3f5f7}.sensor-tile-head,.sensor-tile-foot,.sensor-band{display:flex;justify-content:space-between;gap:8px;align-items:center}.sensor-id{font-size:10px;color:var(--muted);font-weight:800;letter-spacing:.06em}.sensor-tile h3{margin:2px 0 0;font-size:14px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sensor-badge{padding:4px 7px;border-radius:999px;background:#e0f3ec;color:var(--green);font-size:10px;font-weight:800}.alarm .sensor-badge{background:#fde8eb;color:var(--danger)}.error .sensor-badge{background:#e1e5e9;color:#526173}.sensor-reading{display:flex;align-items:baseline;gap:4px;margin:10px 0 8px;color:var(--green)}.sensor-reading b{font-size:29px;line-height:1;letter-spacing:-.03em}.sensor-reading span{font-size:12px;font-weight:700}.alarm .sensor-reading{color:var(--danger)}.error .sensor-reading{color:#657384}.sensor-band{background:var(--surface-alt);border-radius:5px;padding:6px 7px;font-size:10px;color:var(--muted)}.sensor-band b{color:var(--ink);font-size:10px}.sensor-tile-foot{margin-top:8px;color:var(--muted);font-size:10px}.sensor-empty{grid-column:1/-1;padding:40px;text-align:center;background:#fff;border:1px dashed var(--line);border-radius:8px;color:var(--muted)}@media(max-width:700px){header{padding:15px 14px 10px!important}.module-shell{padding:16px 10px 30px}.module-heading{align-items:start;flex-direction:column}.summary{grid-template-columns:repeat(2,minmax(0,1fr))!important}.module-tab{padding:9px 10px;font-size:13px}.loginState{display:none}.pv{font-size:34px!important}.sensor-toolbar{align-items:stretch;flex-direction:column}.sensor-tools{display:grid;grid-template-columns:minmax(0,1fr) 110px}.sensor-search input{width:100%}.sensor-overview-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.sensor-tile{padding:10px}.sensor-reading b{font-size:25px}}@media(max-width:390px){.sensor-overview-grid{grid-template-columns:1fr}}
</style>'''
        sidebar_css = r'''
<style id="v52h-sidebar-style">
body{padding-left:238px;transition:padding-left .2s ease}.module-sidebar{position:fixed;inset:0 auto 0 0;z-index:30;width:238px;background:#0b1d33;color:#d6e5f5;display:flex;flex-direction:column;border-right:1px solid #27415f;box-shadow:8px 0 24px #07152614;transition:width .2s ease,transform .2s ease}.sidebar-head{height:72px;display:flex;align-items:center;gap:10px;padding:0 12px;border-bottom:1px solid #27415f}.sidebar-mark{width:42px;height:42px;display:grid;place-items:center;border-radius:10px;background:#72d1d8;color:#0b1d33;font-size:15px;font-weight:900;flex:0 0 auto}.sidebar-brand{font-weight:800;white-space:nowrap}.sidebar-toggle{margin-left:auto;width:30px;height:30px;border:1px solid #36516f;border-radius:7px;background:#142b47;color:#d6e5f5;font-size:23px;line-height:1;cursor:pointer}.module-sidebar .module-nav{display:flex;flex:1;flex-direction:column;gap:5px;margin:0;padding:14px 10px;border:0;overflow-y:auto;overflow-x:hidden}.module-sidebar .module-tab{width:100%;display:flex;align-items:center;gap:12px;border:0!important;border-radius:8px;padding:11px 12px;color:#abc0d8;text-align:left;transition:background .15s,color .15s}.module-sidebar .module-tab:hover{background:#142d4b;color:#fff}.module-sidebar .module-tab[aria-selected="true"]{background:#1b4166;color:#fff;box-shadow:inset 3px 0 #72d1d8}.nav-icon{width:24px;text-align:center;font-size:19px;line-height:1;flex:0 0 auto}.nav-label{font-size:14px;overflow:hidden}.module-sidebar .loginState{display:block;margin:0;padding:13px 18px;border-top:1px solid #27415f;color:#8ed1dc;overflow:hidden;text-overflow:ellipsis}.sidebar-mobile-toggle{display:none;float:left;width:38px;height:38px;margin:0 12px 8px 0;border:1px solid #36516f;border-radius:7px;background:#142b47;color:#fff;font-size:19px;cursor:pointer}.sidebar-overlay{display:none}.sidebar-collapsed{padding-left:76px}.sidebar-collapsed .module-sidebar{width:76px}.sidebar-collapsed .sidebar-brand,.sidebar-collapsed .nav-label,.sidebar-collapsed .module-sidebar .loginState{display:none}.sidebar-collapsed .sidebar-head{padding:0 10px}.sidebar-collapsed .sidebar-mark{width:38px;height:38px}.sidebar-collapsed .sidebar-toggle{position:absolute;left:60px;width:22px;height:34px;background:#173452}.sidebar-collapsed .module-sidebar .module-tab{justify-content:center;padding:12px 8px}.account-layout{display:grid;grid-template-columns:minmax(300px,.85fr) minmax(360px,1.15fr);gap:16px;align-items:start}.account-card{border-radius:10px;padding:22px;box-shadow:0 3px 12px #10233d0b}.login-gate-brand{display:none}.account-card-head{display:flex;gap:13px;align-items:flex-start;padding-bottom:17px;border-bottom:1px solid var(--line)}.account-card-head h3{margin:1px 0 5px;font-size:18px}.account-card-head p{margin:0;color:var(--muted);font-size:13px;line-height:1.5}.account-icon,.setting-card-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:10px;background:#e2f2f4;color:var(--accent);font-size:22px;flex:0 0 auto}.current-login{margin:16px 0 12px}.current-login .pill{display:inline-flex!important;margin:0!important;background:#e8f0f8!important;border-color:#cadbea!important;color:var(--ink)!important}.auth-fields{display:grid;gap:12px}.auth-fields label{display:grid;gap:5px;color:var(--muted);font-size:12px;font-weight:700}.auth-panel .auth-fields input{box-sizing:border-box;width:100%!important;max-width:none!important;margin:0!important;background:#fff!important;color:var(--ink)!important;border:1px solid var(--line)!important;border-radius:7px!important;padding:11px 12px!important}.auth-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:16px}.auth-actions button{margin:0!important}.account-primary{background:var(--blue)!important}.account-secondary{background:#64748b!important}.auth-actions #langBtn{margin-left:auto!important;max-width:none!important;background:#eef4f9!important;color:var(--blue)!important;border:1px solid var(--line)!important}.test-card #soundState{display:inline-flex!important;margin:16px 0 4px!important;background:#e8f0f8!important;border-color:#cadbea!important;color:var(--ink)!important}.account-test-footer{display:block!important;margin:10px 0 0!important;padding:0!important;border:0!important;box-shadow:none!important;background:transparent!important}.account-test-footer .footrow{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}.account-test-footer .btn{width:100%;min-width:0;margin:0;padding:11px 10px;border-radius:7px!important}.settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,520px));gap:16px}.setting-card{display:flex;gap:16px;background:#fff;border:1px solid var(--line);border-radius:10px;padding:22px;box-shadow:0 3px 12px #10233d0b}.setting-card h3{margin:2px 0 6px;font-size:18px}.setting-card p{margin:0 0 16px;color:var(--muted);font-size:13px}.api-setting-link{display:flex!important;align-items:center;gap:7px;width:max-content;margin:0!important;background:#e8f0f8!important;border:1px solid #cadbea!important;color:var(--ink)!important;border-radius:7px!important}.api-setting-link a{font-weight:800}.auth-gate-active{padding-left:0!important;background:radial-gradient(circle at 15% 15%,#e2f2f4 0,transparent 28%),linear-gradient(145deg,#f7faff,#edf3f8);min-height:100vh}.auth-gate-active .module-sidebar,.auth-gate-active .sidebar-overlay,.auth-gate-active>header{display:none!important}.auth-gate-active .module-shell{min-height:100vh;display:grid;place-items:center;padding:28px 16px}.auth-gate-active .module-heading,.auth-gate-active .test-card{display:none!important}.auth-gate-active #moduleAccount{width:min(100%,720px)}.auth-gate-active .account-layout{display:block}.auth-gate-active .account-card{padding:30px;border-radius:14px;box-shadow:0 18px 50px #10233d1f}.auth-gate-active .login-gate-brand{display:flex;align-items:center;gap:13px;margin-bottom:24px;padding-bottom:22px;border-bottom:1px solid var(--line)}.login-gate-brand>span{width:48px;height:48px;display:grid;place-items:center;border-radius:12px;background:var(--nav);color:#72d1d8;font-weight:900}.login-gate-brand b,.login-gate-brand small{display:block}.login-gate-brand b{font-size:19px}.login-gate-brand small{margin-top:4px;color:var(--muted)}.auth-gate-active .account-secondary{display:none}.auth-gate-active .account-primary{min-width:110px}.auth-gate-active .auth-actions #langBtn{min-width:190px}@media(max-width:1000px){.account-layout{grid-template-columns:1fr}}@media(max-width:800px){body,body.sidebar-collapsed{padding-left:0}.module-sidebar,.sidebar-collapsed .module-sidebar{width:min(82vw,280px);transform:translateX(-105%);box-shadow:12px 0 30px #07152655}.sidebar-open .module-sidebar{transform:translateX(0)}.sidebar-collapsed .sidebar-brand,.sidebar-collapsed .nav-label,.sidebar-collapsed .module-sidebar .loginState{display:block}.sidebar-collapsed .sidebar-toggle{position:static;width:30px;height:30px;margin-left:auto}.sidebar-collapsed .module-sidebar .module-tab{justify-content:flex-start;padding:11px 12px}.sidebar-mobile-toggle{display:grid;place-items:center}.sidebar-overlay{position:fixed;inset:0;z-index:29;border:0;background:#06101d99}.sidebar-open .sidebar-overlay{display:block}header h1{font-size:20px!important}.account-test-footer .footrow{grid-template-columns:1fr 1fr}}@media(max-width:480px){.account-card,.setting-card{padding:16px}.auth-gate-active .account-card{padding:20px}.account-test-footer .footrow{grid-template-columns:1fr}.auth-actions #langBtn{margin-left:0!important;width:100%}.auth-gate-active .account-primary{width:100%}.settings-grid{grid-template-columns:1fr}}
</style>'''
        module_js = r'''
<script id="v52f-dashboard-modules">
(function(){
    function el(id){return document.getElementById(id);}
    function move(source,target){var node=el(source),container=el(target);if(node&&container&&node.parentNode!==container)container.appendChild(node);}
    function makeView(id,title,description){var view=document.createElement('section');view.id=id;view.className='module-view';view.hidden=true;view.innerHTML='<div class="module-heading"><div><h2>'+title+'</h2><p>'+description+'</p></div><span class="module-status" id="'+id+'Status">LIVE</span></div>';return view;}
    function setup(){
        if(el('moduleShell'))return;
        var header=document.querySelector('header');if(!header)return;
        var legacyTabs=document.querySelector('header .tabbar');if(legacyTabs)legacyTabs.remove();
        var sidebar=document.createElement('aside');sidebar.id='moduleSidebar';sidebar.className='module-sidebar';sidebar.innerHTML='<div class="sidebar-head"><span class="sidebar-mark">E62</span><span class="sidebar-brand">監控系統</span><button class="sidebar-toggle" type="button" onclick="window.toggleSidebar()" aria-label="收合側邊欄" title="收合側邊欄">‹</button></div>';
        var nav=document.createElement('nav');nav.className='module-nav';nav.setAttribute('aria-label','功能模組');
        [['overview','⌂','總覽'],['channels','▦','通道監控'],['alarms','⚠','警報中心'],['notify','✉','通知設定'],['permissions','♙','帳號權限'],['account','↪','登入 / 測試'],['settings','⚙','設定']].forEach(function(item){var b=document.createElement('button');b.className='module-tab';b.innerHTML='<span class="nav-icon" aria-hidden="true">'+item[1]+'</span><span class="nav-label">'+item[2]+'</span>';b.dataset.view=item[0];b.setAttribute('aria-label',item[2]);b.setAttribute('title',item[2]);b.setAttribute('aria-selected','false');b.onclick=function(){show(item[0]);};nav.appendChild(b);});
        var login=document.createElement('span');login.id='moduleLoginState';login.className='loginState';sidebar.appendChild(nav);sidebar.appendChild(login);document.body.insertBefore(sidebar,document.body.firstChild);
        var overlay=document.createElement('button');overlay.id='sidebarOverlay';overlay.className='sidebar-overlay';overlay.type='button';overlay.setAttribute('aria-label','關閉選單');overlay.onclick=function(){document.body.classList.remove('sidebar-open');};document.body.insertBefore(overlay,sidebar.nextSibling);
        var mobileToggle=document.createElement('button');mobileToggle.className='sidebar-mobile-toggle';mobileToggle.type='button';mobileToggle.innerHTML='☰';mobileToggle.setAttribute('aria-label','開啟選單');mobileToggle.onclick=function(){document.body.classList.toggle('sidebar-open');};header.insertBefore(mobileToggle,header.firstChild);
        var shell=document.createElement('main');shell.id='moduleShell';shell.className='module-shell';
        var overview=makeView('moduleOverview','感應器即時總覽','最多 200 點即時狀態、警報與溫度範圍');overview.hidden=false;overview.innerHTML+='<div id="overviewSummary"></div><div class="sensor-toolbar"><div class="sensor-range-tabs" id="sensorRangeTabs" aria-label="感應器區段"></div><div class="sensor-tools"><label class="sensor-search"><span>搜尋</span><input id="sensorSearch" type="search" placeholder="編號或名稱" oninput="window.refreshSensorOverview()"></label><label class="sensor-filter"><span>狀態</span><select id="sensorFilter" onchange="window.refreshSensorOverview()"><option value="all">全部</option><option value="ok">正常</option><option value="alarm">警報</option><option value="error">斷線</option></select></label></div></div><div class="sensor-grid-meta"><b id="sensorPageTitle">感應器</b><span id="sensorVisibleCount">等待資料...</span></div><div id="sensorOverviewGrid" class="sensor-overview-grid" aria-live="polite"></div>';
        var channels=makeView('moduleChannels','通道監控','PV、SV、Min / Max 與最近趨勢');channels.innerHTML+='<div id="channelCards"></div>';
        var alarms=makeView('moduleAlarms','警報中心','未解除與歷史警報紀錄');alarms.innerHTML+='<div id="alarmModuleBody"></div>';
        var notify=makeView('moduleNotify','通知設定','Email 與 LINE 警報通知設定');notify.innerHTML+='<div id="notifyModuleBody" class="module-admin-grid"></div>';
        var permissions=makeView('modulePermissions','帳號權限','使用者、角色與通道存取權限');permissions.innerHTML+='<div id="permissionModuleBody" class="module-admin-grid"></div>';
        var account=makeView('moduleAccount','登入與測試','帳號驗證、聲音與通知功能檢查');account.innerHTML+='<div id="authModuleBody" class="account-layout"></div>';
        var settings=makeView('moduleSettings','系統設定','Web 資料端點與顯示資訊');settings.innerHTML+='<div class="settings-grid"><article class="setting-card"><div class="setting-card-icon">⚙</div><div><h3>API 資料端點</h3><p>提供目前感應器狀態的 JSON 即時資料。</p><div id="apiSettingSlot"></div></div></article></div>';
        [overview,channels,alarms,notify,permissions,account,settings].forEach(function(v){shell.appendChild(v);});
        var footer=document.querySelector('footer');document.body.insertBefore(shell,footer||null);
        move('cards','channelCards');move('alarmHistory','alarmModuleBody');move('notifyLocked','notifyModuleBody');move('notifySection','notifyModuleBody');move('permSection','permissionModuleBody');
        var auth=el('authModuleBody');if(auth){var panel=document.createElement('article');panel.className='auth-panel account-card';panel.innerHTML='<div class="login-gate-brand"><span>E62</span><div><b>E62 / C62 Web V5.2</b><small>溫度感應器監控系統</small></div></div><div class="account-card-head"><span class="account-icon">♙</span><div><h3>帳號登入</h3><p>登入後依帳號取得對應的通道與操作權限。</p></div></div><div id="currentLoginSlot" class="current-login"></div><div id="authFields" class="auth-fields"></div><div id="authActions" class="auth-actions"></div>';auth.appendChild(panel);var fields=el('authFields'),current=el('currentLoginSlot');var state=el('loginState');if(state)current.appendChild(state);[['loginUser','帳號'],['loginPass','密碼']].forEach(function(item){var node=el(item[0]);if(node){var label=document.createElement('label');label.textContent=item[1];label.appendChild(node);fields.appendChild(label);}});var actions=el('authActions'),loginButton=document.createElement('button');loginButton.className='account-primary';loginButton.textContent='登入';loginButton.onclick=function(){if(typeof window.webLogin==='function')window.webLogin();};var logoutButton=document.createElement('button');logoutButton.className='account-secondary';logoutButton.textContent='登出';logoutButton.onclick=function(){if(typeof window.webLogout==='function')window.webLogout();};actions.appendChild(loginButton);actions.appendChild(logoutButton);document.querySelectorAll('button').forEach(function(button){var call=button.getAttribute('onclick')||'';if(call.indexOf('webLogin')>=0||call.indexOf('webLogout')>=0)button.style.display='none';});var testCard=document.createElement('article');testCard.className='auth-panel account-card test-card';testCard.innerHTML='<div class="account-card-head"><span class="account-icon">◉</span><div><h3>系統測試</h3><p>確認瀏覽器聲音、靜音與警報通知是否正常。</p></div></div><div id="testControls"></div>';auth.appendChild(testCard);var footer=document.querySelector('footer'),controls=el('testControls');if(footer&&controls){controls.appendChild(footer);footer.classList.add('account-test-footer');}var language=el('langBtn');if(language)actions.appendChild(language);var sound=el('soundState');if(sound)controls.insertBefore(sound,controls.firstChild);}
        var apiSlot=el('apiSettingSlot'),apiPill=document.querySelector('.top .pill.hide-mobile');if(apiSlot&&apiPill){apiPill.classList.remove('hide-mobile');apiPill.classList.add('api-setting-link');apiSlot.appendChild(apiPill);}
        var summary=el('overviewSummary'),sourceSummary=document.querySelector('.summary');if(summary&&sourceSummary){summary.appendChild(sourceSummary);}
        window.toggleSidebar=function(){if(window.matchMedia('(max-width:800px)').matches){document.body.classList.toggle('sidebar-open');return;}var collapsed=document.body.classList.toggle('sidebar-collapsed');localStorage.setItem('ec62_sidebar_collapsed',collapsed?'1':'0');};if(localStorage.getItem('ec62_sidebar_collapsed')==='1')document.body.classList.add('sidebar-collapsed');
        window.showLoginGate=function(){document.body.classList.add('auth-gate-active');show('account');setTimeout(function(){var user=el('loginUser');if(user)user.focus();},50);};window.enterWebApplication=function(){document.body.classList.remove('auth-gate-active');show('overview');};
        var originalWebLogin=window.webLogin,originalWebLogout=window.webLogout;if(typeof originalWebLogin==='function'){window.webLogin=async function(){await originalWebLogin();if(typeof ec62Token!=='undefined'&&ec62Token)window.enterWebApplication();};}if(typeof originalWebLogout==='function'){window.webLogout=function(){originalWebLogout();window.showLoginGate();};}var passwordInput=el('loginPass');if(passwordInput)passwordInput.addEventListener('keydown',function(event){if(event.key==='Enter'&&typeof window.webLogin==='function')window.webLogin();});
        if(typeof ec62Token!=='undefined')ec62Token='';localStorage.removeItem('ec62_token');localStorage.removeItem('ec62_role');window.showLoginGate();
    }
    function show(name){
        setup();if(!el('moduleShell'))return;
        ['overview','channels','alarms','notify','permissions','account','settings'].forEach(function(view){var active=view===name;var section=el('module'+view[0].toUpperCase()+view.slice(1));if(section)section.hidden=!active;var button=document.querySelector('.module-tab[data-view="'+view+'"]');if(button)button.setAttribute('aria-selected',String(active));});
        document.body.classList.remove('sidebar-open');localStorage.setItem('ec62_module_view',name);if(name==='alarms'&&typeof window.loadAlarmHistory==='function')window.loadAlarmHistory();
    }
    var sensorSnapshot=null,sensorPage=0,sensorPageSize=50;
    function sensorState(channel){return channel.st===1?'error':((channel.st===2||channel.web_alarm===true)?'alarm':'ok');}
    function sensorValue(value){return value===null||value===undefined||!Number.isFinite(Number(value))?'--':Number(value).toFixed(1);}
    function renderSensorOverview(){
        var grid=el('sensorOverviewGrid'),tabs=el('sensorRangeTabs');if(!grid||!tabs||!sensorSnapshot)return;
        var all=sensorSnapshot.channels||[],pages=Math.max(1,Math.ceil(all.length/sensorPageSize));sensorPage=Math.max(0,Math.min(sensorPage,pages-1));
        tabs.innerHTML='';for(var page=0;page<pages;page++){var start=page*sensorPageSize+1,end=Math.min((page+1)*sensorPageSize,all.length),button=document.createElement('button');button.className='sensor-range-tab';button.textContent=start+'–'+end;button.setAttribute('aria-pressed',String(page===sensorPage));button.dataset.page=String(page);button.onclick=function(){sensorPage=Number(this.dataset.page);renderSensorOverview();};tabs.appendChild(button);}
        var query=((el('sensorSearch')||{}).value||'').trim().toLowerCase(),filter=((el('sensorFilter')||{}).value||'all');
        var startIndex=sensorPage*sensorPageSize,pageRows=all.slice(startIndex,startIndex+sensorPageSize),rows=pageRows.filter(function(channel){var state=sensorState(channel),matches=!query||String(channel.id||'').toLowerCase().indexOf(query)>=0||String(channel.name||'').toLowerCase().indexOf(query)>=0;return matches&&(filter==='all'||filter===state);});
        var title=el('sensorPageTitle'),count=el('sensorVisibleCount');if(title)title.textContent='感應器 '+(startIndex+1)+'–'+Math.min(startIndex+sensorPageSize,all.length);if(count)count.textContent='顯示 '+rows.length+' / '+pageRows.length+' 點';
        grid.innerHTML=rows.map(function(channel){var state=sensorState(channel),badge=state==='ok'?'正常':(state==='alarm'?'警報':'斷線'),low=sensorValue(channel.web_lo),high=sensorValue(channel.web_hi);return '<article class="sensor-tile '+state+'"><div class="sensor-tile-head"><div><span class="sensor-id">CH'+String(channel.id||'').padStart(3,'0')+'</span><h3>'+String(channel.name||'未命名')+'</h3></div><span class="sensor-badge">'+badge+'</span></div><div class="sensor-reading"><b>'+sensorValue(channel.pv)+'</b><span>°C</span></div><div class="sensor-band"><span>範圍</span><b>'+low+' ～ '+high+' °C</b></div><div class="sensor-tile-foot"><span>SV '+sensorValue(channel.sv)+' °C</span><time>'+String(channel.time||'--').slice(11,19)+'</time></div></article>';}).join('')||'<div class="sensor-empty">這個區段沒有符合條件的感應器</div>';
    }
    window.refreshSensorOverview=renderSensorOverview;
    function render(snapshot){
        if(!snapshot)return;sensorSnapshot=snapshot;renderSensorOverview();var channels=snapshot.channels||[],primary=channels[0],focus=el('focusReading'),system=el('systemSnapshot'),login=el('moduleLoginState');
        if(login)login.textContent=(snapshot.web_user||'guest')+' · '+(snapshot.web_role_name||snapshot.web_role||'Guest');
        if(primary&&focus){var pv=primary.pv===null||primary.pv===undefined?'--':Number(primary.pv).toFixed(1);focus.innerHTML='<div class="focus-reading"><b>'+pv+'</b><span>°C</span></div><div class="overview-meta"><div>CHANNEL<b>CH'+String(primary.id).padStart(2,'0')+' '+(primary.name||'')+'</b></div><div>SET VALUE<b>'+(primary.sv===null||primary.sv===undefined?'--':Number(primary.sv).toFixed(1))+' °C</b></div></div>';}else if(focus){focus.textContent='尚無通道資料';}
        if(system){var ok=String(snapshot.status||'').indexOf('已連線')>=0||String(snapshot.status||'').toLowerCase().indexOf('connected')>=0;system.innerHTML='<div class="overview-meta"><div>CONNECTION<b style="color:'+(ok?'#16856b':'#c53b4b')+'">'+(ok?'ONLINE':'CHECK LINK')+'</b></div><div>UPDATE INTERVAL<b>'+String(snapshot.interval||'--')+' s</b></div><div>PORT<b>'+String(snapshot.com||'--')+'</b></div><div>LAST UPDATE<b>'+String(snapshot.time||'--')+'</b></div></div>';var api=el('apiLink');if(!api){api=document.createElement('a');api.id='apiLink';api.href='/api/data';api.target='_blank';api.textContent='Open API data';api.style.cssText='display:inline-block;margin-top:14px;color:#2364aa;font-weight:700';system.appendChild(api);}}
    }
    var legacyLoad=window.load;
    window.load=async function(){var result=await legacyLoad();try{var response=await fetch('/api/data?ts='+Date.now(),{cache:'no-store',headers:{'X-EC62-Token':window.ec62Token||''}});render(await response.json());}catch(ignore){}return result;};
    window.switchWebTab=function(name){show(name==='dashboard'?'overview':name);};setup();window.load();setInterval(function(){window.load();},3000);
})();
</script>'''
        html = html.replace('</head>', module_css + sidebar_css + '\n</head>', 1)
        html = html.replace('</body>', module_js + '\n</body>', 1)
        return html


E62GUI._web_html = _ec62_v52f_web_html


# =========================================================
# V5.2G isolated Web demo source
# - Normal startup keeps the original Modbus/RTU acquisition snapshot.
# - ``--demo N`` swaps only the Web/API payload for independent test data.
# =========================================================
if DEMO_SENSOR_COUNT:
    try:
        from demo_sensor_data import DemoSensorData

        _EC62_DEMO_PROVIDER = DemoSensorData(DEMO_SENSOR_COUNT)
        _ORIG_EC62_PRODUCTION_SNAPSHOT = E62GUI.get_web_snapshot

        def _ec62_v52g_demo_snapshot(self):
            snap = _EC62_DEMO_PROVIDER.snapshot()
            # Keep authentication/permission metadata compatible with the
            # existing handlers while all sensor readings remain demo-only.
            snap.update({
                "web_role": "guest",
                "web_user": "guest",
                "web_role_name": "測試者",
                "allowed_channels": list(range(1, DEMO_SENSOR_COUNT + 1)),
                "can_admin": False,
                "can_delete": False,
                "can_operator": False,
                "can_recovery": False,
                "can_trend": False,
                "can_alarm_history": True,
                "users_permissions": None,
                "web_display_name": "Demo",
                "can_set_limits": False,
            })
            return snap

        E62GUI.get_web_snapshot = _ec62_v52g_demo_snapshot
        # The latest compatibility handler calls this module-level snapshot
        # function directly, so point it at the same isolated provider.
        _ORIG_GET_WEB_SNAPSHOT = _ec62_v52g_demo_snapshot
        _ORIG_EC62_DEMO_PERMISSION_FILTER = _ec62_v51a_filter_snapshot

        def _ec62_v52g_demo_permission_filter(self, snap, username=None, role=None):
            all_demo_channels = list((snap or {}).get("channels", []) or [])
            filtered = _ORIG_EC62_DEMO_PERMISSION_FILTER(self, snap, username, role)
            filtered["channels"] = all_demo_channels
            filtered["channel_count"] = DEMO_SENSOR_COUNT
            filtered["max_channel"] = DEMO_SENSOR_COUNT
            filtered["allowed_channels"] = list(range(1, DEMO_SENSOR_COUNT + 1))
            filtered["title"] = f"E62 / C62 Web V5.2 · {DEMO_SENSOR_COUNT} Sensor Demo"
            return filtered

        _ec62_v51a_filter_snapshot = _ec62_v52g_demo_permission_filter
    except Exception as _demo_import_error:
        logging.getLogger(__name__).error("Demo data provider unavailable: %s", _demo_import_error)


if __name__ == "__main__":
    root = tk.Tk()
    app = E62GUI(root)
    root.mainloop()
