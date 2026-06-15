// ── Constants ────────────────────────────────────────────────────────────────
const BRANCHES = ['Rimba Point', 'Healthy Holm Kiulap', 'Hua Ho Manggis'];
const SHIFTS   = ['AM', 'PM'];
const OWNER    = 'ssvvsswwii';
const PERIOD_DAYS = 14;

// ── State ────────────────────────────────────────────────────────────────────
const S = {
  staff:       [],
  assignments: [],   // { date, shift, branch, staffId }
  periodStart: null,
  branch:      BRANCHES[0],
  github:      { token: '', repo: 'staff-scheduler' },
  shas:        { staff: null, schedule: null }
};

// ── Boot ─────────────────────────────────────────────────────────────────────
function init() {
  S.github.token = localStorage.getItem('gh_token') || '';
  S.github.repo  = localStorage.getItem('gh_repo')  || 'staff-scheduler';
  S.periodStart  = storedPeriodStart();

  document.getElementById('prevBtn').addEventListener('click', () => shiftPeriod(-1));
  document.getElementById('nextBtn').addEventListener('click', () => shiftPeriod(+1));

  renderAll();

  if (S.github.token) {
    loadData();
  } else {
    openModal('settingsModal');
  }
}

// ── Period helpers ────────────────────────────────────────────────────────────
function storedPeriodStart() {
  const s = localStorage.getItem('period_start');
  if (s) { const d = new Date(s + 'T00:00:00'); if (!isNaN(d)) return d; }
  return defaultPeriodStart();
}

function defaultPeriodStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();                   // 0=Sun
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));  // back to Monday
  return d;
}

function periodDates() {
  return Array.from({ length: PERIOD_DAYS }, (_, i) => {
    const d = new Date(S.periodStart);
    d.setDate(S.periodStart.getDate() + i);
    return d;
  });
}

function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2,'0'); }

function displayDate(d) {
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }
function isToday(d)   { return isoDate(d) === isoDate(new Date()); }

function shiftPeriod(dir) {
  const d = new Date(S.periodStart);
  d.setDate(d.getDate() + dir * PERIOD_DAYS);
  S.periodStart = d;
  localStorage.setItem('period_start', isoDate(d));
  renderAll();
}

// ── GitHub API ────────────────────────────────────────────────────────────────
function ghHeaders() {
  return {
    'Authorization': `Bearer ${S.github.token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function repoUrl(path) {
  return `https://api.github.com/repos/${OWNER}/${S.github.repo}/contents/${path}`;
}

async function ghGet(path) {
  const res = await fetch(repoUrl(path), { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || `HTTP ${res.status}`); }
  const j = await res.json();
  return { data: JSON.parse(atob(j.content.replace(/\n/g,''))), sha: j.sha };
}

async function ghPut(path, content, sha) {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
  const body = { message: `Update ${path}`, content: encoded };
  if (sha) body.sha = sha;

  const res = await fetch(repoUrl(path), {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || `HTTP ${res.status}`); }
  return (await res.json()).content.sha;
}

// ── Load / Save ───────────────────────────────────────────────────────────────
async function loadData() {
  if (!S.github.token) { toast('Enter your GitHub PAT in Settings first', 'error'); return; }
  toast('Loading from GitHub…');
  try {
    const [sr, scr] = await Promise.all([
      ghGet('data/staff.json'),
      ghGet('data/schedule.json')
    ]);
    if (sr)  { S.staff = sr.data;  S.shas.staff    = sr.sha; }
    if (scr) { S.assignments = scr.data.assignments || []; S.shas.schedule = scr.sha; }
    renderAll();
    toast('Loaded successfully', 'success');
  } catch (e) { toast(`Load failed: ${e.message}`, 'error'); }
}

async function saveData() {
  if (!S.github.token) { toast('Enter your GitHub PAT in Settings first', 'error'); openModal('settingsModal'); return; }
  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    // Always fetch latest SHAs first to avoid conflicts when repo was updated externally
    const [sr, scr] = await Promise.all([
      ghGet('data/staff.json'),
      ghGet('data/schedule.json')
    ]);
    if (sr)  S.shas.staff     = sr.sha;
    if (scr) S.shas.schedule  = scr.sha;

    const schedule = { periodStart: isoDate(S.periodStart), assignments: S.assignments };
    const [ns, nsc] = await Promise.all([
      ghPut('data/staff.json',    S.staff,   S.shas.staff),
      ghPut('data/schedule.json', schedule,  S.shas.schedule)
    ]);
    S.shas.staff = ns; S.shas.schedule = nsc;
    toast('Saved! GitHub Pages will update in ~60 seconds.', 'success');
  } catch (e) { toast(`Save failed: ${e.message}`, 'error'); }
  finally { btn.disabled = false; btn.textContent = '💾 Save to GitHub'; }
}

// ── Assignment helpers ────────────────────────────────────────────────────────
function getAssignment(dateStr, shift, branch) {
  return S.assignments.find(a => a.date === dateStr && a.shift === shift && a.branch === branch);
}

function setAssignment(dateStr, shift, branch, staffId) {
  S.assignments = S.assignments.filter(a => !(a.date === dateStr && a.shift === shift && a.branch === branch));
  if (staffId) S.assignments.push({ date: dateStr, shift, branch, staffId });
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  renderPeriodLabel();
  renderBranchTabs();
  renderGrid();
  renderStaffList();
  populateSettings();
}

function renderPeriodLabel() {
  const end = new Date(S.periodStart);
  end.setDate(S.periodStart.getDate() + PERIOD_DAYS - 1);
  document.getElementById('periodLabel').textContent =
    `${displayDate(S.periodStart)} – ${displayDate(end)}`;
}

function renderBranchTabs() {
  document.getElementById('branchTabs').innerHTML = BRANCHES.map((b, i) => `
    <button class="branch-tab${b === S.branch ? ' active' : ''}"
            onclick="selectBranch(${i})">${b}</button>
  `).join('');
}

function renderGrid() {
  const body = document.getElementById('scheduleBody');
  const dates = periodDates();

  body.innerHTML = dates.map(d => {
    const ds   = isoDate(d);
    const cls  = isToday(d) ? ' today' : (isWeekend(d) ? ' weekend' : '');

    const cells = SHIFTS.map(sh => {
      const a = getAssignment(ds, sh, S.branch);
      const opts = `<option value="">— Unassigned —</option>` +
        S.staff.map(s =>
          `<option value="${esc(s.id)}"${a?.staffId === s.id ? ' selected' : ''}>${esc(s.name)} (${esc(s.id)})</option>`
        ).join('');
      return `<td class="shift-cell">
        <span class="shift-badge ${sh.toLowerCase()}">${sh}</span>
        <select class="staff-select"
                data-date="${ds}" data-shift="${sh}" data-branch="${esc(S.branch)}"
                onchange="handleChange(this)">
          ${opts}
        </select>
      </td>`;
    }).join('');

    return `<tr><td class="day-cell${cls}">${displayDate(d)}</td>${cells}</tr>`;
  }).join('');
}

function renderStaffList() {
  const el = document.getElementById('staffList');
  const cnt = document.getElementById('staffCount');
  if (!el) return;
  cnt.textContent = S.staff.length;
  if (!S.staff.length) {
    el.innerHTML = '<p class="empty-state">No staff added yet.</p>';
    return;
  }
  el.innerHTML = S.staff.map(s => `
    <div class="staff-item">
      <span class="staff-id">${esc(s.id)}</span>
      <span class="staff-name">${esc(s.name)}</span>
      <span class="staff-branch">${esc(s.branch || '—')}</span>
      <button class="btn btn-danger btn-sm" onclick="removeStaff('${esc(s.id)}')">Remove</button>
    </div>
  `).join('');
}

function populateSettings() {
  const r = document.getElementById('cfgRepo');
  const t = document.getElementById('cfgToken');
  if (r) r.value = S.github.repo;
  if (t) t.value = S.github.token;
}

// ── Event handlers ────────────────────────────────────────────────────────────
function handleChange(sel) {
  setAssignment(sel.dataset.date, sel.dataset.shift, sel.dataset.branch, sel.value);
}

function selectBranch(i) {
  S.branch = BRANCHES[i];
  renderBranchTabs();
  renderGrid();
}

function addStaff() {
  const id     = document.getElementById('newId').value.trim();
  const name   = document.getElementById('newName').value.trim();
  const branch = document.getElementById('newBranch').value;
  if (!id || !name) { toast('Staff ID and Name are required', 'error'); return; }
  if (S.staff.find(s => s.id === id)) { toast('Staff ID already exists', 'error'); return; }
  S.staff.push({ id, name, branch });
  document.getElementById('newId').value = '';
  document.getElementById('newName').value = '';
  document.getElementById('newBranch').value = '';
  renderStaffList();
  renderGrid();
  toast(`${name} added`, 'success');
}

function removeStaff(id) {
  const s = S.staff.find(x => x.id === id);
  S.staff       = S.staff.filter(x => x.id !== id);
  S.assignments = S.assignments.filter(a => a.staffId !== id);
  renderStaffList();
  renderGrid();
  if (s) toast(`${s.name} removed`);
}

function saveSettings() {
  const token = document.getElementById('cfgToken').value.trim();
  const repo  = document.getElementById('cfgRepo').value.trim() || 'staff-scheduler';
  S.github.token = token; S.github.repo = repo;
  localStorage.setItem('gh_token', token);
  localStorage.setItem('gh_repo',  repo);
  toast('Settings saved', 'success');
}

// ── Modals ────────────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});

// ── Toast ─────────────────────────────────────────────────────────────────────
let _tt;
function toast(msg, type='') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${type ? ' '+type : ''}`;
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.add('hidden'), 3500);
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Start ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
