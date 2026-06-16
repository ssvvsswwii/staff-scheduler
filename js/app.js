// ── Constants ─────────────────────────────────────────────────────────────────
let BRANCHES = ['Rimba Point', 'Healthy Holm Kiulap', 'Hua Ho Manggis'];
const SHIFTS  = ['AM', 'PM'];
const OWNER   = 'ssvvsswwii';
const DOW     = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const BRANCH_COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4'];
function branchColor(i) { return BRANCH_COLORS[i % BRANCH_COLORS.length]; }

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  staff:       [],
  assignments: [],
  month:       new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  editMode:    false,
  github:      { token: '', repo: 'staff-scheduler' },
  shas:        { staff: null, schedule: null },
  selectedDay: null
};

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  S.github.token = localStorage.getItem('gh_token') || '';
  S.github.repo  = localStorage.getItem('gh_repo')  || 'staff-scheduler';

  if (sessionStorage.getItem('edit_mode') === '1') {
    S.editMode = true;
  }

  document.getElementById('prevBtn').onclick     = prevMonth;
  document.getElementById('nextBtn').onclick     = nextMonth;
  document.getElementById('saveBtn').onclick     = saveData;
  document.getElementById('settingsBtn').onclick = openSettings;
  document.getElementById('lockBtn').onclick     = handleLockBtn;

  renderMonthLabel();
  renderBranchLegend();
  renderCalendar();
  updateEditUI();
  await loadPublicData();
}

// ── Load public data (static files on GitHub Pages) ──────────────────────────
async function loadPublicData() {
  try {
    const bust = `?t=${Date.now()}`;
    const [sr, scr] = await Promise.all([
      fetch(`./data/staff.json${bust}`,    { cache: 'no-cache' }),
      fetch(`./data/schedule.json${bust}`, { cache: 'no-cache' })
    ]);
    if (sr.ok)  S.staff = await sr.json();
    if (scr.ok) {
      const d = await scr.json();
      S.assignments = d.assignments || [];
      if (d.branches && d.branches.length) BRANCHES = d.branches;
    }
    renderBranchLegend();
    renderCalendar();
  } catch { /* files not yet available */ }
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
  if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
  const j = await res.json();
  return { data: JSON.parse(atob(j.content.replace(/\n/g,''))), sha: j.sha };
}
async function ghPut(path, content, sha) {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
  async function attempt(useSha) {
    const body = { message: `Update ${path}`, content: encoded };
    if (useSha) body.sha = useSha;
    return fetch(repoUrl(path), {
      method: 'PUT',
      headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }
  let res = await attempt(sha);
  if (!res.ok && (res.status === 409 || res.status === 422)) {
    const cur = await ghGet(path);
    res = await attempt(cur?.sha);
  }
  if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
  return (await res.json()).content.sha;
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function saveData() {
  if (!S.github.token) { toast('Enter your GitHub PAT in Settings first', 'error'); openSettings(); return; }
  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = '⏳ Saving…';
  try {
    const [sr, scr] = await Promise.all([ghGet('data/staff.json'), ghGet('data/schedule.json')]);
    if (sr)  S.shas.staff    = sr.sha;
    if (scr) S.shas.schedule = scr.sha;
    const [ns, nsc] = await Promise.all([
      ghPut('data/staff.json',    S.staff,                                        S.shas.staff),
      ghPut('data/schedule.json', { periodStart: isoDate(S.month), branches: BRANCHES, assignments: S.assignments }, S.shas.schedule)
    ]);
    S.shas.staff = ns; S.shas.schedule = nsc;
    toast('Saved! Site updates in ~60 seconds.', 'success');
  } catch (e) { toast(`Save failed: ${e.message}`, 'error'); }
  finally { btn.disabled = false; btn.textContent = '💾 Save'; }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function hashPw(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw + 'sched-salt-v1'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function handleLockBtn() {
  if (S.editMode) { lockEdit(); return; }
  const hasPw = !!localStorage.getItem('edit_pw');
  if (!hasPw) {
    S.editMode = true;
    sessionStorage.setItem('edit_mode', '1');
    updateEditUI();
    openSettings();
    toast('Set an editor password in Settings', 'success');
  } else {
    document.getElementById('pwError').classList.add('hidden');
    document.getElementById('pwInput').value = '';
    openModal('authOverlay');
    setTimeout(() => document.getElementById('pwInput').focus(), 100);
  }
}

async function submitPassword() {
  const pw     = document.getElementById('pwInput').value;
  const stored = localStorage.getItem('edit_pw');
  const hash   = await hashPw(pw);
  if (hash === stored) {
    S.editMode = true;
    sessionStorage.setItem('edit_mode', '1');
    closeModal('authOverlay');
    document.getElementById('pwInput').value = '';
    updateEditUI();
    toast('Edit mode on', 'success');
  } else {
    document.getElementById('pwError').classList.remove('hidden');
  }
}

function lockEdit() {
  S.editMode = false;
  sessionStorage.removeItem('edit_mode');
  updateEditUI();
  renderCalendar();
  if (S.selectedDay) renderDayBody();
  toast('Locked');
}

function updateEditUI() {
  const badge   = document.getElementById('editBadge');
  const lockBtn = document.getElementById('lockBtn');
  const saveBtn = document.getElementById('saveBtn');
  const setBtn  = document.getElementById('settingsBtn');
  if (S.editMode) {
    badge.classList.remove('hidden');
    lockBtn.textContent = '🔓 Lock';
    saveBtn.style.display = '';
    setBtn.style.display  = '';
  } else {
    badge.classList.add('hidden');
    lockBtn.textContent = '🔒 Unlock';
    saveBtn.style.display = 'none';
    setBtn.style.display  = 'none';
  }
  renderBranchLegend();
}

// ── Month navigation ──────────────────────────────────────────────────────────
function prevMonth() { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderMonthLabel(); renderCalendar(); }
function nextMonth() { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderMonthLabel(); renderCalendar(); }
function renderMonthLabel() {
  document.getElementById('monthLabel').textContent =
    S.month.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
}

// ── Branch legend ─────────────────────────────────────────────────────────────
function renderBranchLegend() {
  const legends = BRANCHES.map((b, i) => `
    <div class="branch-legend">
      <span class="legend-dot" style="background:${branchColor(i)}"></span>
      <span>${esc(b)}</span>
    </div>`).join('');

  const addBtn = S.editMode ? `
    <div class="branch-add-wrap" id="branchAddWrap">
      <button class="branch-add-btn" onclick="showBranchInput()">＋ Add Branch</button>
      <div class="branch-input-row hidden" id="branchInputRow">
        <input class="branch-input" id="branchNameInput" type="text" placeholder="Branch name"
               onkeydown="if(event.key==='Enter')confirmBranch();if(event.key==='Escape')hideBranchInput()">
        <button class="branch-ok"  onclick="confirmBranch()">✓</button>
        <button class="branch-cancel" onclick="hideBranchInput()">✕</button>
      </div>
    </div>` : '';

  document.getElementById('branchTabs').innerHTML = legends + addBtn;
}

function showBranchInput() {
  document.getElementById('branchInputRow').classList.remove('hidden');
  document.getElementById('branchAddWrap').querySelector('.branch-add-btn').style.display = 'none';
  setTimeout(() => document.getElementById('branchNameInput').focus(), 50);
}

function hideBranchInput() {
  document.getElementById('branchNameInput').value = '';
  document.getElementById('branchInputRow').classList.add('hidden');
  document.getElementById('branchAddWrap').querySelector('.branch-add-btn').style.display = '';
}

function confirmBranch() {
  const name = document.getElementById('branchNameInput').value.trim();
  if (!name) { hideBranchInput(); return; }
  if (BRANCHES.includes(name)) { toast('Branch already exists', 'error'); return; }
  BRANCHES.push(name);
  hideBranchInput();
  renderBranchLegend();
  renderCalendar();
  toast(`"${name}" added — click Save to keep it`, 'success');
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function isoDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2,'0'); }

function initials(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0].toUpperCase()).join('').slice(0,2);
}

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Calendar ──────────────────────────────────────────────────────────────────
function renderCalendar() {
  const grid  = document.getElementById('calGrid');
  const year  = S.month.getFullYear();
  const mon   = S.month.getMonth();
  const today = isoDate(new Date());

  let html = DOW.map(d => `<div class="cal-hdr">${d}</div>`).join('');

  const firstDow = new Date(year, mon, 1).getDay();
  const offset   = firstDow === 0 ? 6 : firstDow - 1;
  for (let i = 0; i < offset; i++) html += `<div class="cal-cell empty"></div>`;

  const totalDays = new Date(year, mon + 1, 0).getDate();
  for (let day = 1; day <= totalDays; day++) {
    const d  = new Date(year, mon, day);
    const ds = isoDate(d);
    const isToday = ds === today;
    const isSun   = d.getDay() === 0;

    const branchRows = BRANCHES.map((branch, bi) => {
      const amList = S.assignments.filter(a => a.date===ds && a.shift==='AM' && a.branch===branch);
      const pmList = S.assignments.filter(a => a.date===ds && a.shift==='PM' && a.branch===branch);
      if (!amList.length && !pmList.length) {
        return `<div class="cal-branch-row"><span class="b-dot" style="background:${branchColor(bi)}"></span></div>`;
      }
      const amChips = amList.map(a => {
        const st = S.staff.find(s => s.id===a.staffId);
        return `<span class="cal-chip am" title="${esc(st?.name||a.staffId)}">${esc(initials(st?.name||a.staffId))}</span>`;
      }).join('');
      const pmChips = pmList.map(a => {
        const st = S.staff.find(s => s.id===a.staffId);
        return `<span class="cal-chip pm" title="${esc(st?.name||a.staffId)}">${esc(initials(st?.name||a.staffId))}</span>`;
      }).join('');
      return `<div class="cal-branch-row">
        <span class="b-dot" style="background:${branchColor(bi)}"></span>
        <div class="cal-chips">${amChips}${pmChips}</div>
      </div>`;
    }).join('');

    html += `
      <div class="cal-cell${isToday?' today':''}${isSun?' sunday':''}" onclick="openDay('${ds}')">
        <span class="cal-day-num">${day}</span>
        <div class="cal-branch-rows">${branchRows}</div>
      </div>`;
  }

  const used = offset + totalDays;
  const trail = used % 7 === 0 ? 0 : 7 - (used % 7);
  for (let i = 0; i < trail; i++) html += `<div class="cal-cell empty"></div>`;

  grid.innerHTML = html;
}

// ── Day modal ─────────────────────────────────────────────────────────────────
function openDay(dateStr) {
  S.selectedDay = dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  document.getElementById('dayTitle').textContent =
    d.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  renderDayBody();
  openModal('dayOverlay');
}
function closeDay() { closeModal('dayOverlay'); S.selectedDay = null; }

function renderDayBody() {
  const ds   = S.selectedDay;
  const body = document.getElementById('dayBody');
  if (!ds) return;

  const branchHdrs = BRANCHES.map((b, bi) => `
    <div class="day-col-hdr">
      <span class="b-dot" style="background:${branchColor(bi)}"></span>
      ${esc(b)}
    </div>`).join('');

  const shiftRows = SHIFTS.map(shift => {
    const cells = BRANCHES.map((branch, bi) => {
      const assigned    = S.assignments.filter(a => a.date===ds && a.shift===shift && a.branch===branch);
      const assignedIds = new Set(assigned.map(a => a.staffId));
      const available   = S.staff.filter(s => !assignedIds.has(s.id));

      const chips = assigned.map(a => {
        const st  = S.staff.find(s => s.id===a.staffId);
        const nm  = st ? st.name : a.staffId;
        const rmv = S.editMode
          ? `<button class="chip-x" onclick="removeAssign('${ds}','${shift}','${esc(branch)}','${esc(a.staffId)}')">×</button>`
          : '';
        return `<span class="chip ${shift.toLowerCase()}">${esc(nm)}${rmv}</span>`;
      }).join('');

      const picker = S.editMode ? `
        <div class="picker-wrap" id="pw-${shift}-${bi}">
          <button class="add-btn" onclick="togglePicker('${shift}-${bi}')">+ Add</button>
          <div class="picker-dd hidden" id="pd-${shift}-${bi}">
            ${available.length
              ? available.map(s =>
                  `<div class="picker-item" onclick="addAssign('${ds}','${shift}','${esc(branch)}','${esc(s.id)}')">${esc(s.name)}</div>`
                ).join('')
              : `<div class="picker-empty">All staff assigned</div>`}
          </div>
        </div>` : '';

      const empty = !assigned.length && !S.editMode ? `<span class="no-assign">—</span>` : '';

      return `<div class="day-grid-cell">${chips}${empty}${picker}</div>`;
    }).join('');

    return `
      <div class="day-shift-lbl">
        <span class="shift-badge ${shift.toLowerCase()}">${shift}</span>
        ${shift==='AM' ? 'Morning' : 'Afternoon'}
      </div>
      ${cells}`;
  }).join('');

  body.innerHTML = `
    <div class="day-grid" style="grid-template-columns:110px repeat(${BRANCHES.length},1fr)">
      <div class="day-col-hdr"></div>
      ${branchHdrs}
      ${shiftRows}
    </div>`;
}

function togglePicker(id) {
  const target = document.getElementById(`pd-${id}`);
  document.querySelectorAll('.picker-dd').forEach(el => {
    if (el !== target) el.classList.add('hidden');
  });
  target?.classList.toggle('hidden');
}

function addAssign(date, shift, branch, staffId) {
  if (!S.assignments.some(a => a.date===date && a.shift===shift && a.branch===branch && a.staffId===staffId))
    S.assignments.push({ date, shift, branch, staffId });
  document.querySelectorAll('.picker-dd').forEach(el => el.classList.add('hidden'));
  renderDayBody();
  renderCalendar();
}

function removeAssign(date, shift, branch, staffId) {
  S.assignments = S.assignments.filter(
    a => !(a.date===date && a.shift===shift && a.branch===branch && a.staffId===staffId)
  );
  renderDayBody();
  renderCalendar();
}

// ── Settings ──────────────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settingsBody').innerHTML = `
    <div class="settings-section">
      <div class="settings-title">GitHub Connection</div>
      <div class="form-group">
        <label class="label">Repository Name</label>
        <input id="cfgRepo" class="input" value="${esc(S.github.repo)}" placeholder="staff-scheduler">
      </div>
      <div class="form-group">
        <label class="label">Personal Access Token (PAT)</label>
        <input id="cfgToken" class="input" type="password" value="${esc(S.github.token)}" placeholder="ghp_…">
        <p class="hint">Needs <code>repo</code> + <code>workflow</code> scopes.</p>
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveGitHubSettings()">Save</button>
    </div>

    <hr class="divider">

    <div class="settings-section">
      <div class="settings-title">Editor Password</div>
      <p class="hint" style="margin-bottom:0.75rem">Share this password with anyone you want to allow editing.</p>
      <div class="form-group">
        <label class="label">New Password</label>
        <input id="newPw" class="input" type="password" placeholder="Enter new password">
      </div>
      <div class="form-group">
        <label class="label">Confirm Password</label>
        <input id="confirmPw" class="input" type="password" placeholder="Repeat password">
      </div>
      <button class="btn btn-primary btn-sm" onclick="savePassword()">Set Password</button>
    </div>

    <hr class="divider">

    <div class="settings-section">
      <div class="settings-title">Staff Members</div>
      <div class="form-row" style="margin-bottom:0.75rem">
        <input id="newStaffId"   class="input" type="text" placeholder="ID" style="max-width:80px;flex:none">
        <input id="newStaffName" class="input" type="text" placeholder="Full name">
        <button class="btn btn-primary btn-sm" onclick="addStaff()" style="flex:none">+ Add</button>
      </div>
      <div id="staffList">${staffListHTML()}</div>
    </div>
  `;
  openModal('settingsOverlay');
}

function staffListHTML() {
  if (!S.staff.length) return '<p class="empty-state">No staff yet.</p>';
  return S.staff.map(s => `
    <div class="staff-item">
      <span class="staff-id">${esc(s.id)}</span>
      <span class="staff-name">${esc(s.name)}</span>
      <button class="btn btn-danger btn-sm" onclick="removeStaff('${esc(s.id)}')">Remove</button>
    </div>`).join('');
}

function saveGitHubSettings() {
  const token = document.getElementById('cfgToken').value.trim();
  const repo  = document.getElementById('cfgRepo').value.trim() || 'staff-scheduler';
  S.github.token = token; S.github.repo = repo;
  localStorage.setItem('gh_token', token);
  localStorage.setItem('gh_repo',  repo);
  toast('GitHub settings saved', 'success');
}

async function savePassword() {
  const pw  = document.getElementById('newPw').value;
  const pw2 = document.getElementById('confirmPw').value;
  if (!pw)        { toast('Enter a password', 'error'); return; }
  if (pw !== pw2) { toast('Passwords do not match', 'error'); return; }
  localStorage.setItem('edit_pw', await hashPw(pw));
  document.getElementById('newPw').value = '';
  document.getElementById('confirmPw').value = '';
  toast('Password set', 'success');
}

function addStaff() {
  const id   = document.getElementById('newStaffId').value.trim();
  const name = document.getElementById('newStaffName').value.trim();
  if (!id || !name) { toast('ID and Name required', 'error'); return; }
  if (S.staff.find(s => s.id === id)) { toast('ID already exists', 'error'); return; }
  S.staff.push({ id, name });
  document.getElementById('newStaffId').value = '';
  document.getElementById('newStaffName').value = '';
  document.getElementById('staffList').innerHTML = staffListHTML();
  toast(`${name} added`, 'success');
}

function removeStaff(id) {
  const s = S.staff.find(x => x.id === id);
  S.staff       = S.staff.filter(x => x.id !== id);
  S.assignments = S.assignments.filter(a => a.staffId !== id);
  document.getElementById('staffList').innerHTML = staffListHTML();
  renderCalendar();
  if (s) toast(`${s.name} removed`);
}

// ── Modals ────────────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.addEventListener('click', e => {
  if (e.target.classList.contains('overlay')) closeModal(e.target.id);
  if (!e.target.closest?.('.picker-wrap'))
    document.querySelectorAll('.picker-dd').forEach(el => el.classList.add('hidden'));
});

// ── Toast ─────────────────────────────────────────────────────────────────────
let _tt;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${type ? ' '+type : ''}`;
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Start ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
