import { FormEvent, useState } from 'react';
import { Pencil, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { loadLocalAccounts, saveLocalAccounts, type LocalAccount, type LocalAccountPermissions, type LocalAccountRole } from '../../services/localAccountsService';

const ROLE_LABELS: Record<LocalAccountRole, string> = { administrator: 'Administrator', operator: 'Operator', guest: 'Guest' };
const PERMISSION_LABELS: Array<{ key: keyof LocalAccountPermissions; label: string; description: string }> = [
  { key: 'dashboard', label: '即時監控', description: '檢視總覽與通道資料' },
  { key: 'alarms', label: '警報中心', description: '檢視警報及斷線事件' },
  { key: 'acknowledge', label: '解除警報', description: '允許確認及解除警報' },
  { key: 'settings', label: '系統設定', description: '修改通知與系統設定' },
  { key: 'manageUsers', label: '帳號管理', description: '新增及編輯其他帳號' },
];
const ROLE_PERMISSIONS: Record<LocalAccountRole, LocalAccountPermissions> = {
  administrator: { dashboard: true, alarms: true, acknowledge: true, settings: true, manageUsers: true },
  operator: { dashboard: true, alarms: true, acknowledge: true, settings: false, manageUsers: false },
  guest: { dashboard: true, alarms: true, acknowledge: false, settings: false, manageUsers: false },
};

function newAccount(): LocalAccount {
  return { username: '', displayName: '', password: '', role: 'operator', channelScope: 'CH001–CH100', permissions: { ...ROLE_PERMISSIONS.operator } };
}

function permissionSummary(account: LocalAccount) {
  if (account.role === 'administrator') return '完整權限';
  const enabled = PERMISSION_LABELS.filter(({ key }) => account.permissions[key]).map(({ label }) => label);
  return enabled.length ? enabled.join('／') : '無功能權限';
}

export function PermissionsPage({ currentRole }: { currentRole: string }) {
  const [accounts, setAccounts] = useState(loadLocalAccounts);
  const [editor, setEditor] = useState<LocalAccount | null>(null);
  const [originalUsername, setOriginalUsername] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const normalizedRole = currentRole.trim().toLowerCase();
  const canEdit = normalizedRole === 'admin' || normalizedRole === 'administrator';

  function openNew() { setOriginalUsername(null); setEditor(newAccount()); setError(''); }
  function openEdit(account: LocalAccount) { setOriginalUsername(account.username); setEditor({ ...account, permissions: { ...account.permissions } }); setError(''); }
  function persist(nextAccounts: LocalAccount[], notice: string) { saveLocalAccounts(nextAccounts); setAccounts(nextAccounts); setMessage(notice); }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    const username = editor.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) { setError('帳號需為 3–32 個英文字母、數字、句點、底線或連字號'); return; }
    if (!editor.displayName.trim()) { setError('請輸入顯示名稱'); return; }
    if (!editor.channelScope.trim()) { setError('請輸入通道範圍'); return; }
    if (accounts.some((account) => account.username.toLowerCase() === username && account.username !== originalUsername)) { setError('此帳號已存在'); return; }
    const isAdmin = originalUsername === 'admin' || username === 'admin';
    const saved: LocalAccount = { ...editor, username, displayName: editor.displayName.trim(), channelScope: editor.channelScope.trim(), role: isAdmin ? 'administrator' : editor.role, permissions: isAdmin ? { ...ROLE_PERMISSIONS.administrator } : { ...editor.permissions } };
    const next = originalUsername ? accounts.map((account) => account.username === originalUsername ? saved : account) : [...accounts, saved];
    persist(next, originalUsername ? `帳號 ${username} 已更新` : `帳號 ${username} 已新增`);
    setEditor(null);
  }

  function remove(account: LocalAccount) {
    if (account.username === 'admin' || !window.confirm(`確定刪除帳號 ${account.username}？`)) return;
    persist(accounts.filter((item) => item.username !== account.username), `帳號 ${account.username} 已刪除`);
  }

  function changeRole(role: LocalAccountRole) {
    if (!editor) return;
    setEditor({ ...editor, role, channelScope: role === 'guest' && editor.channelScope === 'CH001–CH100' ? '唯讀' : editor.channelScope, permissions: { ...ROLE_PERMISSIONS[role] } });
  }

  return <>
    {canEdit && <div className="page-inline-actions"><button type="button" className="primary-button" onClick={openNew}><Plus size={17} />新增帳號</button></div>}
    <div className="local-storage-notice"><ShieldCheck size={17} /><span><b>本機暫存模式</b>　資料與密碼僅保存在此瀏覽器的 localStorage，正式環境請改接 EC62 權限 API。</span></div>
    {message && <div className="permission-save-message" role="status">{message}</div>}
    <section className="panel table-panel permission-table"><div className="table-scroll"><table><thead><tr><th>帳號</th><th>顯示名稱</th><th>角色</th><th>通道範圍</th><th>權限</th>{canEdit && <th>CRUD 操作</th>}</tr></thead><tbody>{accounts.map((account) => <tr key={account.username}><td><b>{account.username}</b></td><td>{account.displayName}</td><td><span className="role-pill">{ROLE_LABELS[account.role]}</span></td><td>{account.channelScope}</td><td className="permission-summary">{permissionSummary(account)}</td>{canEdit && <td><div className="permission-row-actions"><button type="button" onClick={() => openEdit(account)} aria-label={`編輯 ${account.username}`}><Pencil size={15} />編輯／權限</button>{account.username !== 'admin' && <button type="button" className="danger" onClick={() => remove(account)} aria-label={`刪除 ${account.username}`}><Trash2 size={15} />刪除</button>}</div></td>}</tr>)}</tbody></table></div></section>
    {editor && <div className="account-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><form className="account-editor" onSubmit={submit}>
      <header><div><ShieldCheck size={22} /><h2>{originalUsername ? '編輯帳號' : '新增帳號'}</h2></div><button type="button" className="icon-button" onClick={() => setEditor(null)} aria-label="關閉"><X size={18} /></button></header>
      <div className="account-editor-fields"><label>帳號<input value={editor.username} disabled={originalUsername !== null} onChange={(event) => setEditor({ ...editor, username: event.target.value })} placeholder="operator2" autoComplete="off" required /></label><label>顯示名稱<input value={editor.displayName} onChange={(event) => setEditor({ ...editor, displayName: event.target.value })} placeholder="操作者 2" required /></label><label>密碼<input type="password" value={editor.password} onChange={(event) => setEditor({ ...editor, password: event.target.value })} placeholder="可留空" autoComplete="new-password" /></label><label>角色<select value={editor.role} disabled={originalUsername === 'admin'} onChange={(event) => changeRole(event.target.value as LocalAccountRole)}><option value="administrator">Administrator</option><option value="operator">Operator</option><option value="guest">Guest</option></select></label><label className="channel-scope-field">通道範圍<input value={editor.channelScope} onChange={(event) => setEditor({ ...editor, channelScope: event.target.value })} placeholder="全部、CH001–CH100 或唯讀" required /></label></div>
      <fieldset disabled={originalUsername === 'admin'}><legend>功能權限</legend><div className="permission-options">{PERMISSION_LABELS.map(({ key, label, description }) => <label key={key}><input type="checkbox" checked={editor.permissions[key]} onChange={(event) => setEditor({ ...editor, permissions: { ...editor.permissions, [key]: event.target.checked } })} /><span><b>{label}</b><small>{description}</small></span></label>)}</div></fieldset>
      {error && <div className="form-error" role="alert">{error}</div>}<footer><button type="button" className="secondary-button" onClick={() => setEditor(null)}>取消</button><button className="primary-button"><Save size={17} />儲存帳號</button></footer>
    </form></div>}
  </>;
}
