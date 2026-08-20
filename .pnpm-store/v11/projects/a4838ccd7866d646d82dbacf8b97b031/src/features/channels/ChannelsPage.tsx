import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, RotateCcw } from 'lucide-react';
import { StatusBadge } from '../../components/common/StatusBadge';
import { SensorDetailModal } from '../../components/sensors/SensorDetailModal';
import { getSensorState, type DashboardSnapshot, type SensorChannel, type SensorState } from '../../types/dashboard';

type SortKey = 'id' | 'name' | 'state' | 'pv' | 'sv' | 'min' | 'max' | 'time';
type SortDirection = 'asc' | 'desc';

const STATUS_LABELS: Record<SensorState, string> = { ok: '正常', alarm: '警報', error: '斷線' };
const PAGE_SIZES = [25, 50, 100];

function compareNullable(left: string | number | null, right: string | number | null) {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right), 'zh-TW', { numeric: true, sensitivity: 'base' });
}

function getSortValue(channel: SensorChannel, key: SortKey): string | number | null {
  if (key === 'state') return STATUS_LABELS[getSensorState(channel)];
  if (key === 'time') {
    const timestamp = Date.parse(channel.time);
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  return channel[key];
}

function csvText(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function exportForExcel(rows: SensorChannel[]) {
  const headers = ['通道', '名稱', '狀態', 'PV (°C)', 'SV (°C)', 'MIN', 'MAX', '更新時間'];
  const body = rows.map((channel) => [
    csvText(`CH${channel.id}`), csvText(channel.name), csvText(STATUS_LABELS[getSensorState(channel)]),
    channel.pv ?? '', channel.sv ?? '', channel.min ?? '', channel.max ?? '',
    csvText(channel.time ? new Date(channel.time).toLocaleString('zh-TW') : ''),
  ].join(','));
  const blob = new Blob([`\ufeff${headers.map(csvText).join(',')}\r\n${body.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `報表資料_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ChannelsPage({ data, token, onRefresh }: { data: DashboardSnapshot; token: string; onRefresh: () => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | SensorState>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-TW');
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    return data.channels.filter((channel) => {
      const updatedAt = Date.parse(channel.time);
      return (!normalizedQuery || `CH${channel.id} ${channel.name}`.toLocaleLowerCase('zh-TW').includes(normalizedQuery))
        && (status === 'all' || getSensorState(channel) === status)
        && (from === null || (!Number.isNaN(updatedAt) && updatedAt >= from))
        && (to === null || (!Number.isNaN(updatedAt) && updatedAt <= to));
    }).sort((left, right) => {
      const comparison = compareNullable(getSortValue(left, sortKey), getSortValue(right, sortKey));
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data.channels, query, status, dateFrom, dateTo, sortKey, sortDirection]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selected = data.channels.find((channel) => channel.id === selectedId) ?? null;
  const hasFilters = Boolean(query || status !== 'all' || dateFrom || dateTo);

  useEffect(() => setPage(1), [query, status, dateFrom, dateTo, pageSize]);

  function changeSort(nextKey: SortKey) {
    if (sortKey === nextKey) setSortDirection((value) => value === 'asc' ? 'desc' : 'asc');
    else { setSortKey(nextKey); setSortDirection('asc'); }
    setPage(1);
  }

  function resetFilters() { setQuery(''); setStatus('all'); setDateFrom(''); setDateTo(''); }

  function SortHeader({ column, children }: { column: SortKey; children: string }) {
    const active = sortKey === column;
    return <th aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button className={active ? 'sort-button active' : 'sort-button'} onClick={() => changeSort(column)}>{children}<span aria-hidden="true">{active ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}</span></button></th>;
  }

  return (
    <>
      <section className="panel table-panel">
        <div className="channel-toolbar">
          <div className="channel-toolbar-summary"><b>{rows.length} 個通道</b>{rows.length !== data.channels.length && <span>共 {data.channels.length} 個</span>}</div>
          <div className="channel-filters">
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋通道或名稱" aria-label="搜尋通道或名稱" />
            <select value={status} onChange={(event) => setStatus(event.target.value as 'all' | SensorState)} aria-label="篩選狀態"><option value="all">全部狀態</option><option value="ok">正常</option><option value="alarm">警報</option><option value="error">斷線</option></select>
            <label>起始日期<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label>結束日期<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} /></label>
            {hasFilters && <button className="filter-reset" onClick={resetFilters}><RotateCcw size={15} />清除</button>}
            <button className="excel-export" onClick={() => exportForExcel(rows)} disabled={!rows.length}><Download size={16} />匯出 Excel</button>
          </div>
        </div>
        <div className="table-scroll"><table><thead><tr><SortHeader column="id">通道</SortHeader><SortHeader column="name">名稱</SortHeader><SortHeader column="state">狀態</SortHeader><SortHeader column="pv">PV</SortHeader><SortHeader column="sv">SV</SortHeader><SortHeader column="min">MIN</SortHeader><SortHeader column="max">MAX</SortHeader><SortHeader column="time">更新時間</SortHeader></tr></thead><tbody>{pageRows.map((channel) => <tr key={channel.id}><td><button className="table-sensor-link" onClick={() => setSelectedId(channel.id)}>CH{channel.id}</button></td><td><button className="table-sensor-link" onClick={() => setSelectedId(channel.id)}>{channel.name}</button></td><td><StatusBadge state={getSensorState(channel)} /></td><td>{channel.pv?.toFixed(1) ?? '--'} °C</td><td>{channel.sv?.toFixed(1) ?? '--'} °C</td><td>{channel.min?.toFixed(1) ?? '--'}</td><td>{channel.max?.toFixed(1) ?? '--'}</td><td>{channel.time ? new Date(channel.time).toLocaleString('zh-TW') : '--'}</td></tr>)}{!pageRows.length && <tr><td colSpan={8} className="table-empty">沒有符合篩選條件的通道</td></tr>}</tbody></table></div>
        <footer className="table-pagination"><label>每頁<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option value={size} key={size}>{size} 筆</option>)}</select></label><span>{rows.length ? `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, rows.length)} / ${rows.length}` : '0 / 0'}</span><div><button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label="上一頁"><ChevronLeft size={17} /></button><b>第 {currentPage} / {pageCount} 頁</b><button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage === pageCount} aria-label="下一頁"><ChevronRight size={17} /></button></div></footer>
      </section>
      {selected && <SensorDetailModal channel={selected} token={token} onClose={() => setSelectedId(null)} onChanged={onRefresh} />}
    </>
  );
}
