"""EC62 Web demo data provider.

This module is intentionally isolated from the Modbus/RTU acquisition path.
It is imported only when the application is launched with ``--demo <count>``.
"""

from __future__ import annotations

import math
import time
from datetime import datetime, timedelta


class DemoSensorData:
    """Build API-compatible, deterministic sensor data for Web demonstrations."""

    def __init__(self, count: int = 200) -> None:
        self.count = max(1, min(2000, int(count)))
        self.started_at = time.time()

    @staticmethod
    def _profile(uid: int) -> tuple[float, float, float]:
        profiles = (
            (5.0, 2.0, 8.0),
            (-25.0, -30.0, -18.0),
            (22.0, 18.0, 26.0),
            (36.0, 33.0, 39.0),
        )
        return profiles[(uid - 1) % len(profiles)]

    @staticmethod
    def _name(uid: int) -> str:
        area = chr(65 + ((uid - 1) // 40) % 26)
        rack = ((uid - 1) % 40) // 2 + 1
        probe = (uid - 1) % 2 + 1
        return f"{area}{((uid - 1) // 80) + 1}-R{rack:02d}-{probe}"

    def snapshot(self) -> dict:
        now = datetime.now()
        elapsed = time.time() - self.started_at
        channels = []
        for uid in range(1, self.count + 1):
            sv, low, high = self._profile(uid)
            wave = math.sin(elapsed / 13.0 + uid * 0.61) * (0.45 + (uid % 5) * 0.08)
            drift = math.sin(elapsed / 47.0 + uid * 0.17) * 0.18
            pv = sv + wave + drift

            # A stable mix of alarm and communication-error examples for demos.
            comm_error = uid % 67 == 0
            alarm = uid % 29 == 0
            if alarm:
                pv = high + 1.2 + math.sin(elapsed / 9.0 + uid) * 0.35

            history = []
            for index in range(24):
                stamp = now - timedelta(seconds=(23 - index) * 15)
                value = sv + math.sin((index + uid * 0.7) / 3.8) * 0.55
                if alarm:
                    value += (high - sv) + 1.1
                history.append({"time": stamp.strftime("%Y-%m-%d %H:%M:%S"), "value": round(value, 1)})

            values = [row["value"] for row in history] + [round(pv, 1)]
            channels.append({
                "id": f"{uid:03d}",
                "name": self._name(uid),
                "pv": None if comm_error else round(pv, 1),
                "sv": round(sv, 1),
                "st": 1 if comm_error else (2 if alarm else 0),
                "time": now.strftime("%Y-%m-%d %H:%M:%S"),
                "history": history,
                "min": min(values),
                "max": max(values),
                "avg": round(sum(values) / len(values), 1),
                "count": len(values),
                "web_lo": low,
                "web_hi": high,
                "web_alarm": alarm,
                "web_alarm_ack": False,
                "can_set_limits": False,
            })

        return {
            "title": f"E62 / C62 Web V5.2 · {self.count} Sensor Demo",
            "language": "zh",
            "version": "V5.2-RWD-DEMO",
            "demo_mode": True,
            "demo_count": self.count,
            "status": "DEMO 已連線 · 獨立模擬資料",
            "time": now.strftime("%Y-%m-%d %H:%M:%S"),
            "interval": 3,
            "channel_count": self.count,
            "max_channel": self.count,
            "com": "DEMO-SIMULATOR",
            "lan_url": None,
            "lan_urls": [],
            "local_url": None,
            "channels": channels,
            "notify": None,
            "alarm_audit": {"operator": "demo", "reason": "Demo only"},
            "settings_unlocked": False,
        }

