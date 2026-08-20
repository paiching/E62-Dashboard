import { useState } from 'react';
import { BellRing, Volume2 } from 'lucide-react';

export function AccountPage() {
  const [message, setMessage] = useState('');
  function testSound() { const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; const context = new AudioContextClass(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 880; gain.gain.value = .08; oscillator.start(); oscillator.stop(context.currentTime + .25); setMessage('測試聲音已播放'); }
  async function testNotification() { if (!('Notification' in window)) { setMessage('此瀏覽器不支援通知'); return; } const permission = await Notification.requestPermission(); if (permission === 'granted') { new Notification('E62 Edge Dashboard', { body: '測試通知正常' }); setMessage('測試通知已發送'); } else setMessage('通知權限未開啟'); }
  return <section className="panel test-panel test-panel-standalone"><h3>瀏覽器功能測試</h3><p>請確認聲音輸出及桌面通知權限皆可正常運作。</p><div><button className="test-button" onClick={testSound}><Volume2 size={19} />測試聲音</button><button className="test-button" onClick={testNotification}><BellRing size={19} />測試通知</button></div>{message && <span className="test-message">{message}</span>}</section>;
}
