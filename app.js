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
function fmtMonthDay(dateStr) {
  const d = fromDateStr(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

// ---------- running plan ----------
// Benchmarks used: current fitness = 5km easy @ 6:00/km, longest run 8km.
// Race demand (Hyrox Doubles) = 8 x 1km, both partners running every leg together
// within 15s/km of each other (running is not split like station work).
// Race-day running pace typically runs ~30-45s/km slower than flat/fresh pace
// because of accumulated fatigue from the 8 stations, so a realistic goal pace
// for a sub-2h Duo finish is roughly 6:15-6:30/km rather than your flat 6:00/km.
// Structure follows a simple polarized approach (easy long runs to build the
// aerobic engine + race-pace interval/rep work to rehearse the 8x1km demand),
// progressing base -> build -> peak, then a short taper shakeout.
const GOAL_PACE = '6:15–6:30/km';
const RUN_SESSIONS = [
  // --- Base phase (8 sessions, alternating long run / intervals) ---
  { label: 'Long run', detail: '6 km, easy conversational pace (~6:30–6:45/km)' },
  { label: 'Intervals', detail: '5 × 600 m @ ~6:00–6:15/km, 90 sec jog recovery' },
  { label: 'Long run', detail: '7 km, easy pace' },
  { label: 'Intervals', detail: '6 × 600 m @ ~6:00–6:15/km, 90 sec jog recovery' },
  { label: 'Long run', detail: '8 km, easy pace — your current max, kept controlled' },
  { label: 'Intervals', detail: `5 × 1 km @ goal race pace (${GOAL_PACE}), 2 min jog recovery` },
  { label: 'Long run', detail: '9 km, easy pace — new distance territory' },
  { label: 'Intervals', detail: `6 × 1 km @ goal race pace (${GOAL_PACE}), 2 min jog recovery` },
  // --- Build phase (3 sessions) ---
  { label: 'Long run', detail: '10 km, easy pace' },
  { label: 'Intervals', detail: `7 × 1 km @ ~6:15/km, 90 sec recovery — shorter rest, more race-like` },
  { label: 'Progression run', detail: `10–11 km easy, last 2 km at goal race pace (${GOAL_PACE})` },
  // --- Peak phase (4 sessions: 2 per week for 2 weeks) ---
  { label: 'Long run', detail: '11 km steady, comfortably hard in the back half' },
  { label: 'Race simulation', detail: `8 × 1 km @ goal race pace (${GOAL_PACE}), 90 sec recovery — full rep count, dress rehearsal` },
  { label: 'Intervals', detail: '6 × 1 km @ ~6:00–6:15/km (slightly faster than race pace), 2 min recovery' },
  { label: 'Long run', detail: '8 km easy — volume easing off before taper' },
  // --- Taper (1 session, race week) ---
  { label: 'Shakeout', detail: '20–25 min very easy (3–4 km) + 4 × 20 sec strides at race effort' },
];

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
  const program = {}; // date -> {type, phase, isRace, running?}
  let cursor = PROGRAM_START;
  let runIdx = 0;
  while (cursor <= RACE_DATE) {
    const d = fromDateStr(cursor);
    const dow = d.getDay();
    const wk = mondayOf(cursor);
    const phaseKey = phaseForWeek(wk);
    const pattern = PATTERNS[phaseKey];
    const type = pattern.days[dow] || null;
    const entry = { type, phase: phaseKey, isRace: cursor === RACE_DATE };
    if (type === 'Running' && runIdx < RUN_SESSIONS.length) {
      entry.running = RUN_SESSIONS[runIdx];
      runIdx++;
    }
    program[cursor] = entry;
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
  const daysLeft = Math.max(0,
