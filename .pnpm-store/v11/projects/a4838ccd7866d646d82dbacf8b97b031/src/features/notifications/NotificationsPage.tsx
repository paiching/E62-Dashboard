import { FormEvent, useState } from 'react';
import { Mail, MessageCircle } from 'lucide-react';

interface NotifySettings { emailEnabled: boolean; emailTo: string; lineEnabled: boolean; lineToken: string; recovery: boolean; }

const initial: NotifySettings = JSON.parse(localStorage.getItem('edge-notify-settings') || 'null') || {
  emailEnabled: false, emailTo: '', lineEnabled: false, lineToken: '', recovery: true,
};

export function NotificationsPage() {
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(false);
  function submit(event: FormEvent) { event.preventDefault(); localStorage.setItem('edge-notify-settings', JSON.stringify(settings)); setSaved(true); window.setTimeout(() => setSaved(false), 1800); }
  return <form className="settings-form" onSubmit={submit}><section className="panel setting-section"><div className="section-title"><Mail size={21} /><div><h3>Email 通知</h3><p>警報發生時寄送到指定收件人。</p></div><label className="switch"><input type="checkbox" checked={settings.emailEnabled} onChange={(event) => setSettings({ ...settings, emailEnabled: event.target.checked })} /><span /></label></div><label>收件人<input type="email" value={settings.emailTo} onChange={(event) => setSettings({ ...settings, emailTo: event.target.value })} placeholder="team@example.com" /></label></section><section className="panel setting-section"><div className="section-title"><MessageCircle size={21} /><div><h3>LINE 通知</h3><p>透過 Messaging API 發送警報訊息。</p></div><label className="switch"><input type="checkbox" checked={settings.lineEnabled} onChange={(event) => setSettings({ ...settings, lineEnabled: event.target.checked })} /><span /></label></div><label>Channel Token<input type="password" value={settings.lineToken} onChange={(event) => setSettings({ ...settings, lineToken: event.target.value })} placeholder="Token" /></label></section><label className="check-row"><input type="checkbox" checked={settings.recovery} onChange={(event) => setSettings({ ...settings, recovery: event.target.checked })} />恢復正常時一併通知</label><button className="primary-button">{saved ? '已儲存' : '儲存通知設定'}</button></form>;
}
