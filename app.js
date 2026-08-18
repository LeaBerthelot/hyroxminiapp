/* Hyrox Duo Tracker — client-side only, all data in localStorage on this device */

const RACE_DATE = '2026-12-06';
const PROGRAM_START = '2026-09-01';
const ACTIVITY_TYPES = ['Running', 'Hyrox Training', 'Boxing', 'Crossfit', 'None'];
const HYROX_STATIONS = ['None', 'SkiErg', 'Sled Push', 'Sled Pull', 'Burpee Broad Jump', 'Rowing', 'Farmers Carry', 'Sandbag Lunge', 'Wall Balls'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TYPE_KEY = { 'Running': 'running', 'Hyrox Training': 'hyrox', 'Boxing': 'boxing', 'Crossfit': 'crossfit', 'None': 'none' };

// ---------- date helpers (all dates handled as local YYYY-MM-DD strings) ----------
function toDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fromDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(dateStr, n) {
  const d = fromDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
function todayStr() { return toDateStr(new Date()); }
function fmtShort(dateStr) {
  const d = fromDateStr(dateStr);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtFull(dateStr) {
  const d = fromDateStr(dateStr);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function mondayOf(dateStr) {
  const d = fromDateStr(dateStr);
  const dow = d.getDay(); // 0=Sun
  const diff = (dow === 0) ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

// ---------- storage ----------
const Store = {
  logs() { return JSON.parse(localStorage.getItem('hyrox.activityLog') || '[]'); },
  saveLogs(v) { localStorage.setItem('hyrox.activityLog', JSON.stringify(v)); },
  addLog(entry) {
    const logs = Store.logs();
    entry.id = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    logs.push(entry);
    logs.sort((a, b) => b.date.localeCompare(a.date));
    Store.saveLogs(logs);
  },
  deleteLog(id) {
    Store.saveLogs(Store.logs().filter(l => l.id !== id));
  },
  status() { return JSON.parse(localStorage.getItem('hyrox.dailyStatus') || '{}'); }, // {date: {food, alcohol}}
  saveStatus(v) { localStorage.setItem('hyrox.dailyStatus', JSON.stringify(v)); },
  setStatus(date, field, value) {
    const s = Store.status();
    s[date] = s[date] || {};
    s[date][field] = value;
    Store.saveStatus(s);
  }
};

// ---------- program generator ----------
// Phases (14 weeks, Tue Sept 1 -> Sun Dec 6):
//   >=6 weeks out: Base   — 3 sessions/wk (Tue Boxing, Fri Hyrox, Sun Running)
//   3-5 weeks out: Build  — 4 sessions/wk (+ Wed Crossfit)
//   1-2 weeks out: Peak   — 5 sessions/wk (+ Mon Running, Wed Crossfit, Sat Running instead of Sun)
//   race week:     Taper  — 2 sessions/wk (Tue Boxing, Thu Running, light) + race day
const PATTERNS = {
  base:  { label: 'Base',  count: 3, days: { 2: 'Boxing', 5: 'Hyrox Training', 0: 'Running' } },
  build: { label: 'Build', count: 4, days: { 2: 'Boxing', 3: 'Crossfit', 5: 'Hyrox Training', 0: 'Running' } },
  peak:  { label: 'Peak',  count: 5, days: { 1: 'Running', 2: 'Boxing', 3: 'Crossfit', 5: 'Hyrox Training', 6: 'Running' } },
  taper: { label: 'Taper', count: 2, days: { 2: 'Boxing', 4: 'Running' } },
};

function phaseForWeek(weekMonday) {
  const raceMonday = mondayOf(RACE_DATE);
  const weeksOut = Math.round((fromDateStr(raceMonday) - fromDateStr(weekMonday)) / (7 * 86400000));
  if (weeksOut <= 0) return 'taper';
  if (weeksOut <= 2) return 'peak';
  if (weeksOut <= 5) return 'build';
  return 'base';
}

let _program = null;
function generateProgram() {
  if (_program) return _program;
  const program = {}; // date -> {type, phase, isRace}
  let cursor = PROGRAM_START;
  while (cursor <= RACE_DATE) {
    const d = fromDateStr(cursor);
    const dow = d.getDay();
    const wk = mondayOf(cursor);
    const phaseKey = phaseForWeek(wk);
    const pattern = PATTERNS[phaseKey];
    const type = pattern.days[dow] || null;
    program[cursor] = { type, phase: phaseKey, isRace: cursor === RACE_DATE };
    cursor = addDays(cursor, 1);
  }
  _program = program;
  return program;
}

function plannedSessionsCount() {
  const program = generateProgram();
  return Object.values(program).filter(p => p.type).length;
}

function adherence(uptoDate) {
  const program = generateProgram();
  const logs = Store.logs();
  const loggedDates = new Set(logs.filter(l => l.type !== 'None').map(l => l.date));
  let planned = 0, done = 0;
  for (const [date, info] of Object.entries(program)) {
    if (date > uptoDate) continue;
    if (info.type) {
      planned++;
      if (loggedDates.has(date)) done++;
    }
  }
  return { planned, done, pct: planned ? Math.round((done / planned) * 100) : 0 };
}

// ---------- UI helpers ----------
function pillClass(type) { return 'pill pill-' + (TYPE_KEY[type] || 'none'); }
function dotClass(type) { return 'dot dot-' + (TYPE_KEY[type] || 'none'); }

function statusLabel(v) { return v === 'good' ? 'Good' : v === 'medium' ? 'Medium' : v === 'bad' ? 'Bad' : '—'; }

// ---------- Tab: Today ----------
function renderToday() {
  const el = document.getElementById('tab-today');
  const today = todayStr();
  const program = generateProgram();
  const raceD = fromDateStr(RACE_DATE);
  const now = new Date();
  const msLeft = raceD - new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLeft = Math.max(0, Math.round(msLeft / 86400000));
  const weeksLeft = Math.floor(daysLeft / 7);

  const info = program[today];
  const plannedType = info ? info.type : null;
  const isRaceDay = info && info.isRace;
  const status = Store.status()[today] || {};
  const adh = adherence(today);

  el.innerHTML = `
    <div class="card">
      <h2>Countdown to Hyrox Duo</h2>
      <div class="countdown-grid">
        <div class="stat-tile"><div class="num">${daysLeft}</div><div class="label">days left</div></div>
        <div class="stat-tile"><div class="num">${weeksLeft}</div><div class="label">weeks left</div></div>
        <div class="stat-tile"><div class="num">${adh.pct}%</div><div class="label">adherence</div></div>
      </div>
      <div class="adherence-bar"><div class="fill" style="width:${adh.pct}%"></div></div>
    </div>

    <div class="card">
      <h2>${isRaceDay ? 'Race day' : "Today's plan"}</h2>
      ${isRaceDay
        ? `<span class="pill pill-race">🏁 Hyrox Duo — race day!</span>`
        : plannedType
          ? `<span class="${pillClass(plannedType)}">${plannedType}</span><div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">${fmtFull(today)} · ${info.phase} phase</div>`
          : `<span class="pill pill-none">Rest day</span><div style="margin-top:8px;font-size:12px;color:var(--text-secondary)">${fmtFull(today)}</div>`}
      <button class="primary" id="quickLogBtn">+ Log today's activity</button>
    </div>

    <div class="card">
      <h2>Sugar intake today</h2>
      <div class="status-choice" id="foodChoice">
        ${['good', 'medium', 'bad'].map(v => `<button class="status-btn ${status.food === v ? 'sel-' + v : ''}" data-field="food" data-val="${v}">${statusLabel(v)}</button>`).join('')}
      </div>
    </div>

    <div class="card">
      <h2>Alcohol today</h2>
      <div class="status-choice" id="alcoholChoice">
        ${['good', 'medium', 'bad'].map(v => `<button class="status-btn ${status.alcohol === v ? 'sel-' + v : ''}" data-field="alcohol" data-val="${v}">${statusLabel(v)}</button>`).join('')}
      </div>
    </div>
  `;

  el.querySelector('#quickLogBtn').addEventListener('click', () => {
    switchTab('log');
    document.getElementById('logDate').value = today;
    if (plannedType && !isRaceDay) document.getElementById('logType').value = plannedType;
  });
  el.querySelectorAll('.status-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      Store.setStatus(today, btn.dataset.field, btn.dataset.val);
      renderToday();
    });
  });
}

// ---------- Tab: Log ----------
function renderLog() {
  const el = document.getElementById('tab-log');
  const logs = Store.logs();
  el.innerHTML = `
    <div class="card">
      <h2>Log an activity</h2>
      <label for="logDate">Date</label>
      <input type="date" id="logDate" value="${todayStr()}" max="${todayStr()}">
      <label for="logType">Activity</label>
      <select id="logType">
        ${ACTIVITY_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
      </select>
      <div id="stationWrap">
        <label for="logStation">Hyrox station worked</label>
        <select id="logStation">
          ${HYROX_STATIONS.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
      </div>
      <label for="logDuration">Duration (min)</label>
      <input type="number" id="logDuration" placeholder="e.g. 60" min="0" max="300">
      <label for="logNotes">Notes</label>
      <textarea id="logNotes" placeholder="Optional — how it went, times, reps..."></textarea>
      <button class="primary" id="saveLogBtn">Save entry</button>
    </div>

    <div class="card">
      <h2>History</h2>
      <div id="logHistory">
        ${logs.length ? logs.map(logItemHtml).join('') : `<div class="empty">No activity logged yet.</div>`}
      </div>
    </div>
  `;

  const typeSel = el.querySelector('#logType');
  const stationWrap = el.querySelector('#stationWrap');
  function syncStationVisibility() {
    stationWrap.style.display = typeSel.value === 'None' ? 'none' : '';
  }
  typeSel.addEventListener('change', syncStationVisibility);
  syncStationVisibility();

  el.querySelector('#saveLogBtn').addEventListener('click', () => {
    const date = el.querySelector('#logDate').value || todayStr();
    const type = typeSel.value;
    const station = type === 'None' ? 'None' : el.querySelector('#logStation').value;
    const duration = el.querySelector('#logDuration').value;
    const notes = el.querySelector('#logNotes').value.trim();
    Store.addLog({ date, type, station, duration: duration ? Number(duration) : null, notes });
    renderLog();
    renderToday();
    renderProgram();
  });

  el.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', () => {
      Store.deleteLog(btn.dataset.id);
      renderLog();
      renderToday();
      renderProgram();
    });
  });
}

function logItemHtml(l) {
  const subParts = [];
  if (l.station && l.station !== 'None') subParts.push(l.station);
  if (l.duration) subParts.push(l.duration + ' min');
  if (l.notes) subParts.push(l.notes);
  return `
    <div class="log-item">
      <span class="${dotClass(l.type)}"></span>
      <div class="meta">
        <div class="main">${l.type}</div>
        ${subParts.length ? `<div class="sub">${subParts.join(' · ')}</div>` : ''}
      </div>
      <div class="date">${fmtShort(l.date)}</div>
      <button class="del" data-id="${l.id}">×</button>
    </div>`;
}

// ---------- Tab: Program ----------
function renderProgram() {
  const el = document.getElementById('tab-program');
  const program = generateProgram();
  const logs = Store.logs();
  const loggedDates = new Set(logs.filter(l => l.type !== 'None').map(l => l.date));
  const today = todayStr();
  const adh = adherence(today);

  // group by week (Mon start)
  const weeks = [];
  let cursor = PROGRAM_START;
  let currentWeek = null;
  while (cursor <= RACE_DATE) {
    const wkStart = mondayOf(cursor);
    if (!currentWeek || currentWeek.start !== wkStart) {
      currentWeek = { start: wkStart, days: [] };
      weeks.push(currentWeek);
    }
    currentWeek.days.push(cursor);
    cursor = addDays(cursor, 1);
  }

  el.innerHTML = `
    <div class="card">
      <h2>Adherence so far</h2>
      <div class="row">
        <div class="stat-tile"><div class="num">${adh.done}/${adh.planned}</div><div class="label">sessions done</div></div>
        <div class="stat-tile"><div class="num">${adh.pct}%</div><div class="label">on plan</div></div>
      </div>
      <div class="adherence-bar"><div class="fill" style="width:${adh.pct}%"></div></div>
      <div class="legend">
        <span><span class="dot dot-running"></span>Running</span>
        <span><span class="dot dot-hyrox"></span>Hyrox Training</span>
        <span><span class="dot dot-boxing"></span>Boxing</span>
        <span><span class="dot dot-crossfit"></span>Crossfit</span>
      </div>
    </div>
    <div class="card">
      <h2>16-week schedule (Sept 1 → Dec 6)</h2>
      ${weeks.map(w => weekRowHtml(w, program, loggedDates, today)).join('')}
    </div>
  `;
}

function weekRowHtml(week, program, loggedDates, today) {
  const first = program[week.days[0]];
  const phaseLabel = PATTERNS[first.phase].label;
  const rangeLabel = fmtShort(week.days[0]).split(',')[1].trim() + ' – ' + fmtShort(week.days[week.days.length - 1]).split(',')[1].trim();
  return `
    <div class="week-row">
      <div class="week-head">
        <span class="phase">${phaseLabel} phase</span>
        <span class="range">${rangeLabel}</span>
      </div>
      <div class="day-strip">
        ${week.days.map(date => {
          const info = program[date];
          const done = loggedDates.has(date);
          let cls = 'day-chip';
          if (info.isRace) cls += ' race';
          else if (info.type) cls += ' planned-' + TYPE_KEY[info.type];
          if (done && !info.isRace) cls += ' done';
          if (date === today) cls += ' today';
          const d = fromDateStr(date);
          const label = info.isRace ? '🏁' : (info.type ? info.type.split(' ')[0] : '·');
          return `<div class="${cls}" title="${fmtFull(date)}"><div class="d">${WEEKDAYS[d.getDay()]}</div>${d.getDate()}<br>${label}</div>`;
        }).join('')}
      </div>
    </div>`;
}

// ---------- Tab: Progress ----------
let activityChart = null;
function renderProgress() {
  const el = document.getElementById('tab-progress');
  el.innerHTML = `
    <div class="card">
      <h2>Sessions per week by activity</h2>
      <div class="chart-wrap"><canvas id="activityChart"></canvas></div>
      <div class="legend">
        <span><span class="dot dot-running"></span>Running</span>
        <span><span class="dot dot-hyrox"></span>Hyrox Training</span>
        <span><span class="dot dot-boxing"></span>Boxing</span>
        <span><span class="dot dot-crossfit"></span>Crossfit</span>
      </div>
    </div>
    <div class="card">
      <h2>Daily log — last 8 weeks</h2>
      <div id="heatmap" class="heatmap"></div>
      <div class="legend">
        <span><span class="dot" style="background:var(--status-good)"></span>Good</span>
        <span><span class="dot" style="background:var(--status-warning)"></span>Medium</span>
        <span><span class="dot" style="background:var(--status-critical)"></span>Bad</span>
        <span>top-left dot = activity · bottom dots = food / alcohol</span>
      </div>
    </div>
  `;
  drawActivityChart();
  drawHeatmap();
}

function drawActivityChart() {
  const ctx = document.getElementById('activityChart');
  const logs = Store.logs().filter(l => l.type !== 'None');
  // bucket by week start
  const byWeek = {};
  logs.forEach(l => {
    const wk = mondayOf(l.date);
    byWeek[wk] = byWeek[wk] || { Running: 0, 'Hyrox Training': 0, Boxing: 0, Crossfit: 0 };
    if (byWeek[wk][l.type] !== undefined) byWeek[wk][l.type]++;
  });
  const weeks = Object.keys(byWeek).sort();
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const colors = dark
    ? { Running: '#3987e5', 'Hyrox Training': '#d95926', Boxing: '#199e70', Crossfit: '#c98500' }
    : { Running: '#2a78d6', 'Hyrox Training': '#eb6834', Boxing: '#1baf7a', Crossfit: '#eda100' };
  const ink = dark ? '#c3c2b7' : '#52514e';
  const grid = dark ? '#2c2c2a' : '#e1e0d9';

  if (activityChart) activityChart.destroy();
  if (!weeks.length) {
    ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
    return;
  }
  activityChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weeks.map(w => fmtShort(w).split(',')[1].trim()),
      datasets: ['Running', 'Hyrox Training', 'Boxing', 'Crossfit'].map(type => ({
        label: type,
        data: weeks.map(w => byWeek[w][type]),
        backgroundColor: colors[type],
        borderRadius: 3,
        maxBarThickness: 22,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true, ticks: { color: ink, font: { size: 10 } }, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { color: ink, stepSize: 1, precision: 0 }, grid: { color: grid } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function drawHeatmap() {
  const wrap = document.getElementById('heatmap');
  const program = generateProgram();
  const logsByDate = {};
  Store.logs().forEach(l => { logsByDate[l.date] = logsByDate[l.date] || l; });
  const status = Store.status();
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const activityColor = { Running: dark ? '#3987e5' : '#2a78d6', 'Hyrox Training': dark ? '#d95926' : '#eb6834', Boxing: dark ? '#199e70' : '#1baf7a', Crossfit: dark ? '#c98500' : '#eda100', None: 'transparent' };
  const statusColor = { good: '#0ca30c', medium: '#fab219', bad: '#d03b3b' };

  const end = todayStr() < RACE_DATE ? todayStr() : RACE_DATE;
  let cursor = addDays(end, -55); // 8 weeks
  let html = '';
  while (cursor <= end) {
    const log = logsByDate[cursor];
    const st = status[cursor] || {};
    const actColor = log ? activityColor[log.type] : 'transparent';
    html += `<div class="heat-cell" title="${fmtFull(cursor)}">
      ${actColor !== 'transparent' ? `<div class="a" style="background:${actColor};opacity:.35"></div>` : ''}
      ${st.food ? `<div class="f" style="background:${statusColor[st.food]}"></div>` : ''}
      ${st.alcohol ? `<div class="al" style="background:${statusColor[st.alcohol]}"></div>` : ''}
    </div>`;
    cursor = addDays(cursor, 1);
  }
  wrap.innerHTML = html;
}

// ---------- Tab switching ----------
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + name));
  document.querySelectorAll('nav.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'today') renderToday();
  if (name === 'log') renderLog();
  if (name === 'program') renderProgram();
  if (name === 'progress') renderProgress();
}

document.querySelectorAll('nav.tabbar button').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('topDate').textContent = fmtFull(todayStr());
renderToday();

// register service worker for offline / home-screen install
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
