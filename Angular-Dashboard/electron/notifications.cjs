function createNotifier(Notification, getAlertSettings) {
  const active = new Set();
  return async function notify(token, body, test = false) {
    const settings = getAlertSettings(token, test);
    if (!settings.notificationsEnabled) return { sent: false, message: '桌面通知已關閉' };
    if (!Notification.isSupported()) return { sent: false, message: '此系統不支援桌面通知' };
    const notification = new Notification({
      title: test ? 'E62 通知測試' : 'E62 異常警報',
      body: String(body || '偵測到新的異常，請查看儀錶板。').slice(0, 500),
      silent: true, // Sound is controlled independently by the alarm-sound switch.
    });
    active.add(notification);
    notification.once('close', () => active.delete(notification));
    return new Promise(resolve => {
      let done = false;
      const finish = result => { if (done) return; done = true; clearTimeout(timer); resolve(result); };
      const timer = setTimeout(() => {
        active.delete(notification);
        finish({ sent: false, message: '系統未確認通知顯示，請檢查 Windows 通知與勿擾設定' });
      }, 5000);
      notification.once('show', () => finish({ sent: true, message: '已送出桌面通知' }));
      notification.once('failed', () => { active.delete(notification); finish({ sent: false, message: '通知發送失敗，請檢查 Windows 通知設定' }); });
      try { notification.show(); }
      catch { active.delete(notification); finish({ sent: false, message: '無法發送桌面通知' }); }
    });
  };
}
module.exports = { createNotifier };
