// ── Constants ─────────────────────────────────────────────────────────────────
let BRANCHES = ['Rimba Point', 'Healthy Holm Kiulap', 'Hua Ho Manggis'];
const SHIFTS  = ['AM', 'PM'];
const DOW     = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const BRANCH_COLORS = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4'];
function branchColor(i) { return BRANCH_COLORS[i % BRANCH_COLORS.length]; }

const LEAVE_TYPES = [
  'Annual Leave', 'Bereavement Leave', 'Compassionate Leave',
  'Hospitalized Leave', 'In-Lieu', 'Maternity Leave', 'Matrimonial Leave',
  'Medical Leave', 'Off Day', 'Paternity Leave', 'Unpaid Leave'
];

// Brunei public holidays 2026
const BRUNEI_HOLIDAYS = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-16', name: "Isra' Mi'raj", approx: true },
  { date: '2026-02-23', name: 'National Day' },
  { date: '2026-03-05', name: 'Nuzul Al-Quran', approx: true },
  { date: '2026-03-20', name: 'Hari Raya Aidilfitri', approx: true },
  { date: '2026-03-21', name: 'Hari Raya Aidilfitri (Day 2)', approx: true },
  { date: '2026-05-27', name: 'Hari Raya Aidiladha', approx: true },
  { date: '2026-05-28', name: 'Hari Raya Aidiladha (Day 2)', approx: true },
  { date: '2026-05-31', name: 'Royal Brunei Armed Forces Day' },
  { date: '2026-06-17', name: 'Awal Muharram', approx: true },
  { date: '2026-07-15', name: "His Majesty's Birthday" },
  { date: '2026-08-26', name: 'Maulidur Rasul', approx: true },
  { date: '2026-12-25', name: 'Christmas Day' },
];
function getHoliday(ds) { return BRUNEI_HOLIDAYS.find(h => h.date === ds) || null; }

// ── Supabase ──────────────────────────────────────────────────────────────────
const SB_URL = 'https://vdwpybgfhymjfqgsvidl.supabase.co/rest/v1';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZkd3B5YmdmaHltamZxZ3N2aWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NTQzMzIsImV4cCI6MjA5ODQzMDMzMn0.foKp5NwaKMx5t32LMOWFQjjL5jjHgAXrtkU3g-myY4M';

function sbHeaders(extra) {
  return Object.assign({
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}

async function sbGet(table) {
  const res = await fetch(SB_URL + '/' + table + '?select=*', { headers: sbHeaders() });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || 'Load failed: ' + table); }
  return res.json();
}

async function sbUpsert(table, rows) {
  if (!rows.length) return;
  const res = await fetch(SB_URL + '/' + table, {
    method: 'POST',
    headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows)
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || 'Save failed: ' + table); }
}

async function sbClear(table, filter) {
  const res = await fetch(SB_URL + '/' + table + '?' + filter, {
    method: 'DELETE',
    headers: sbHeaders({ 'Prefer': 'return=minimal' })
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || 'Clear failed: ' + table); }
}

// ── State ─────────────────────────────────────────────────────────────────────
const S = {
  staff:       [],
  assignments: [],
  leave:       [],    // [{ date, staffId, leaveType }]
  remarks:     {},    // { 'YYYY-MM-DD': 'text' }  — one event per day
  month:       new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  editMode:    false,
  dataLoaded:  false,
  dirty:       false,
  selectedDay: null
};

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  if (sessionStorage.getItem('edit_mode') === '1') {
    S.editMode = true;
  }

  window.addEventListener('beforeunload', e => {
    if (S.dirty && S.editMode) { e.preventDefault(); e.returnValue = ''; }
  });

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

// ── Load data from Supabase ───────────────────────────────────────────────────
async function loadPublicData() {
  try {
    const [staffData, assignData, leaveData, remarkData, settingsData] = await Promise.all([
      sbGet('staff'),
      sbGet('assignments'),
      sbGet('leave_days'),
      sbGet('remarks'),
      sbGet('settings')
    ]);

    S.staff       = staffData;
    S.assignments = assignData.map(a => ({ date: a.date, shift: a.shift, branch: a.branch, staffId: a.staff_id }));
    S.leave       = leaveData.map(l => ({ date: l.date, staffId: l.staff_id, leaveType: l.leave_type || 'Annual Leave' }));

    S.remarks = {};
    remarkData.forEach(r => { S.remarks[r.date] = r.text; });

    settingsData.forEach(s => {
      if (s.key === 'branches') {
        try { const b = JSON.parse(s.value); if (b.length) BRANCHES = b; } catch {}
      }
      if (s.key === 'editorPwHash' && s.value) {
        localStorage.setItem('edit_pw', s.value);
      }
    });

    S.dataLoaded = true;
    renderBranchLegend();
    renderCalendar();
  } catch (e) {
    S.dataLoaded = true;
    toast('Load error: ' + e.message, 'error');
  }
}

// ── Save to Supabase ──────────────────────────────────────────────────────────
async function saveData() {
  const btn = document.getElementById('saveBtn');
  btn.disabled = true; btn.textContent = '⏳ Saving…';
  try {
    await sbClear('assignments', 'date=gte.2000-01-01');
    await sbClear('leave_days',  'date=gte.2000-01-01');
    await sbClear('remarks',     'date=gte.2000-01-01');
    await sbClear('staff',       'id=not.is.null');

    if (S.staff.length) {
      await sbUpsert('staff', S.staff.map(s => ({ id: s.id, name: s.name })));
    }
    if (S.assignments.length) {
      await sbUpsert('assignments', S.assignments.map(a => ({
        date: a.date, shift: a.shift, branch: a.branch, staff_id: a.staffId
      })));
    }
    if (S.leave.length) {
      await sbUpsert('leave_days', S.leave.map(l => ({
        date: l.date, staff_id: l.staffId, leave_type: l.leaveType || 'Annual Leave'
      })));
    }

    const remarkRows = Object.entries(S.remarks)
      .filter(([, text]) => text && text.trim())
      .map(([date, text]) => ({ date, text }));
    if (remarkRows.length) await sbUpsert('remarks', remarkRows);

    const pwHash = localStorage.getItem('edit_pw') || '';
    const settingsRows = [{ key: 'branches', value: JSON.stringify(BRANCHES) }];
    if (pwHash) settingsRows.push({ key: 'editorPwHash', value: pwHash });
    await sbUpsert('settings', settingsRows);

    S.dirty = false;
    updateSaveBtn();
    toast('Saved!', 'success');
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save';
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────
async function hashPw(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw + 'sched-salt-v1'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function handleLockBtn() {
  if (S.editMode) { lockEdit(); return; }
  const hasPw = !!localStorage.getItem('edit_pw');
  if (!hasPw && S.dataLoaded) {
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
  const lockBtn = document.getElementById('lockBtn');
  const saveBtn = document.getElementById('saveBtn');
  const setBtn  = document.getElementById('settingsBtn');
  if (S.editMode) {
    lockBtn.textContent = '🔓 Lock';
    saveBtn.style.display = '';
    setBtn.style.display  = '';
  } else {
    lockBtn.textContent = '🔒 Unlock';
    saveBtn.style.display = 'none';
    setBtn.style.display  = 'none';
  }
  updateSaveBtn();
  renderBranchLegend();
}

function markDirty() {
  S.dirty = true;
  updateSaveBtn();
}

function updateSaveBtn() {
  const btn = document.getElementById('saveBtn');
  if (!btn) return;
  btn.textContent = S.dirty ? '💾 Save ●' : '💾 Save';
  btn.classList.toggle('dirty', S.dirty);
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
      ${S.editMode ? `<button class="branch-del-btn" onclick="removeBranch('${esc(b)}')" title="Remove branch">×</button>` : ''}
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

function removeBranch(name) {
  if (BRANCHES.length <= 1) { toast('Must keep at least one branch', 'error'); return; }
  if (!confirm(`Remove "${name}"? All its assignments will be deleted.`)) return;
  BRANCHES = BRANCHES.filter(b => b !== name);
  S.assignments = S.assignments.filter(a => a.branch !== name);
  markDirty();
  renderBranchLegend();
  renderCalendar();
  if (S.selectedDay) renderDayBody();
  toast('"' + name + '" removed — click Save to apply', 'success');
}

function confirmBranch() {
  const name = document.getElementById('branchNameInput').value.trim();
  if (!name) { hideBranchInput(); return; }
  if (BRANCHES.includes(name)) { toast('Branch already exists', 'error'); return; }
  BRANCHES.push(name);
  hideBranchInput();
  markDirty();
  renderBranchLegend();
  renderCalendar();
  toast('"' + name + '" added — click Save to keep it', 'success');
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function isoDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
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

    const holiday    = getHoliday(ds);
    const leaveToday = S.leave.filter(l => l.date === ds);
    const eventText  = S.remarks[ds] || '';

    const branchRows = BRANCHES.map((branch, bi) => {
      const amList = S.assignments.filter(a => a.date===ds && a.shift==='AM' && a.branch===branch);
      const pmList = S.assignments.filter(a => a.date===ds && a.shift==='PM' && a.branch===branch);
      if (!amList.length && !pmList.length) {
        return `<div class="cal-branch-row"><span class="b-dot" style="background:${branchColor(bi)}"></span></div>`;
      }
      const amChips = amList.map(a => {
        const nm = S.staff.find(s => s.id===a.staffId)?.name || a.staffId;
        return `<span class="cal-chip am" title="${esc(nm)}">${esc(nm)}</span>`;
      }).join('');
      const pmChips = pmList.map(a => {
        const nm = S.staff.find(s => s.id===a.staffId)?.name || a.staffId;
        return `<span class="cal-chip pm" title="${esc(nm)}">${esc(nm)}</span>`;
      }).join('');
      return `<div class="cal-branch-row">
        <span class="b-dot" style="background:${branchColor(bi)}"></span>
        <div class="cal-chips">${amChips}${pmChips}</div>
      </div>`;
    }).join('');

    const leaveCount = leaveToday.length
      ? `<span class="cal-leave-badge">🏖️ Off ${leaveToday.length}</span>` : '';
    const holidayLabel = holiday
      ? `<div class="cal-holiday-name">${esc(holiday.name)}${holiday.approx?' *':''}</div>` : '';
    const eventBadge = eventText
      ? `<div class="cal-event-badge">📝 ${esc(eventText)}</div>` : '';

    html += `
      <div class="cal-cell${isToday?' today':''}${isSun?' sunday':''}${holiday?' holiday':''}" onclick="openDay('${ds}')">
        <div class="cal-cell-top"><span class="cal-day-num">${day}</span>${leaveCount}</div>
        ${holidayLabel}
        ${eventBadge}
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

  const holiday   = getHoliday(ds);
  const leaveList = S.leave.filter(l => l.date === ds);
  const leaveIds  = new Set(leaveList.map(l => l.staffId));

  // ── Holiday banner ──
  const holidayBanner = holiday
    ? `<div class="day-holiday-banner">🎉 Public Holiday — ${esc(holiday.name)}${holiday.approx ? ' <span class="approx-note">(date approx.)</span>' : ''}</div>`
    : '';

  // ── Off / Leave section ──
  let leaveSection = '';
  if (leaveList.length || S.editMode) {
    const leaveChips = leaveList.map(l => {
      const st  = S.staff.find(s => s.id === l.staffId);
      const nm  = st ? st.name : l.staffId;
      const lt  = l.leaveType ? `<span class="leave-type-tag">${esc(l.leaveType)}</span>` : '';
      const rmv = S.editMode
        ? `<button class="chip-x" onclick="removeLeave('${ds}','${esc(l.staffId)}')">×</button>`
        : '';
      return `<span class="chip leave">${esc(nm)}${lt}${rmv}</span>`;
    }).join('');

    const leaveAvail = S.staff.filter(s => !leaveIds.has(s.id));
    const emptyMsg = !leaveList.length && !S.editMode ? '<span class="no-assign">None</span>' : '';

    const addForm = S.editMode ? `
      <div class="leave-add-form">
        <select class="leave-select" id="leaveStaffSel">
          <option value="">OFF</option>
          ${leaveAvail.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}
        </select>
        <select class="leave-select" id="leaveTypeSel">
          <option value="">Leave type…</option>
          ${LEAVE_TYPES.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" onclick="submitLeave('${ds}')">Mark Off</button>
      </div>` : '';

    leaveSection = `
      <div class="day-leave-section">
        <div class="day-leave-header">
          <span class="day-leave-label">🏖️ Off</span>
          <div class="day-leave-chips">${emptyMsg}${leaveChips}</div>
        </div>
        ${addForm}
      </div>`;
  }

  // ── Shift × Branch grid (no Remark column) ──
  const branchHdrs = BRANCHES.map((b, bi) => `
    <div class="day-col-hdr">
      <span class="b-dot" style="background:${branchColor(bi)}"></span>
      ${esc(b)}
    </div>`).join('');

  const shiftRows = SHIFTS.map(shift => {
    const cells = BRANCHES.map((branch, bi) => {
      const assigned    = S.assignments.filter(a => a.date===ds && a.shift===shift && a.branch===branch);
      const assignedIds = new Set(assigned.map(a => a.staffId));
      const available   = S.staff.filter(s => !assignedIds.has(s.id) && !leaveIds.has(s.id));

      const chips = assigned.map(a => {
        const st      = S.staff.find(s => s.id === a.staffId);
        const nm      = st ? st.name : a.staffId;
        const onLeave = leaveIds.has(a.staffId);
        const leaveEntry = onLeave ? S.leave.find(l => l.date===ds && l.staffId===a.staffId) : null;
        const rmv     = S.editMode
          ? `<button class="chip-x" onclick="removeAssign('${ds}','${shift}','${esc(branch)}','${esc(a.staffId)}')">×</button>`
          : '';
        return `<span class="chip ${shift.toLowerCase()}${onLeave ? ' on-leave' : ''}" title="${onLeave ? (leaveEntry?.leaveType || 'Off') : ''}">${esc(nm)}${onLeave ? ' 🏖️' : ''}${rmv}</span>`;
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

  // ── Event row (below PM, full width) ──
  const eventText = S.remarks[ds] || '';
  const eventRow = S.editMode
    ? `<div class="day-event-row">
         <div class="day-event-label">📌 Remark</div>
         <div class="day-event-cell">
           <textarea class="event-input" placeholder="Add remark…"
             oninput="updateRemark('${ds}',this.value)"
             onblur="renderCalendar()">${esc(eventText)}</textarea>
         </div>
       </div>`
    : (eventText
        ? `<div class="day-event-row">
             <div class="day-event-label">📌 Remark</div>
             <div class="day-event-cell"><span class="event-text">${esc(eventText)}</span></div>
           </div>`
        : '');

  body.innerHTML = holidayBanner + leaveSection + `
    <div class="day-grid" style="grid-template-columns:110px repeat(${BRANCHES.length},1fr)">
      <div class="day-col-hdr">Time</div>
      ${branchHdrs}
      ${shiftRows}
    </div>
    ${eventRow}`;
}

function togglePicker(id) {
  const target    = document.getElementById('pd-' + id);
  const wasHidden = target.classList.contains('hidden');
  document.querySelectorAll('.picker-dd').forEach(el => el.classList.add('hidden'));
  if (wasHidden) {
    const btn = document.getElementById('pw-' + id).querySelector('button');
    const r   = btn.getBoundingClientRect();
    target.style.position = 'fixed';
    target.style.top  = (r.bottom + 4) + 'px';
    target.style.left = r.left + 'px';
    target.style.width = '';
    target.classList.remove('hidden');
  }
}

function addAssign(date, shift, branch, staffId) {
  const conflict = S.assignments.find(a => a.date===date && a.shift===shift && a.staffId===staffId && a.branch!==branch);
  if (conflict) {
    const nm = S.staff.find(s => s.id===staffId)?.name || staffId;
    toast(nm + ' is already on ' + shift + ' at ' + conflict.branch, 'error');
    document.querySelectorAll('.picker-dd').forEach(el => el.classList.add('hidden'));
    return;
  }
  if (!S.assignments.some(a => a.date===date && a.shift===shift && a.branch===branch && a.staffId===staffId))
    S.assignments.push({ date, shift, branch, staffId });
  document.querySelectorAll('.picker-dd').forEach(el => el.classList.add('hidden'));
  markDirty();
  renderDayBody();
  renderCalendar();
}

function removeAssign(date, shift, branch, staffId) {
  S.assignments = S.assignments.filter(
    a => !(a.date===date && a.shift===shift && a.branch===branch && a.staffId===staffId)
  );
  markDirty();
  renderDayBody();
  renderCalendar();
}

function submitLeave(date) {
  const staffSel = document.getElementById('leaveStaffSel');
  const typeSel  = document.getElementById('leaveTypeSel');
  const staffId  = staffSel.value;
  const leaveType = typeSel.value;
  if (!staffId)   { toast('Select a staff member', 'error'); return; }
  if (!leaveType) { toast('Select a leave type', 'error'); return; }
  addLeave(date, staffId, leaveType);
}

function addLeave(date, staffId, leaveType) {
  S.leave = S.leave.filter(l => !(l.date === date && l.staffId === staffId));
  S.leave.push({ date, staffId, leaveType: leaveType || 'Annual Leave' });
  markDirty();
  renderDayBody();
  renderCalendar();
}

function removeLeave(date, staffId) {
  S.leave = S.leave.filter(l => !(l.date===date && l.staffId===staffId));
  markDirty();
  renderDayBody();
  renderCalendar();
}

function updateRemark(date, text) {
  S.remarks[date] = text;
  markDirty();
}

// ── Settings ──────────────────────────────────────────────────────────────────
function openSettings() {
  document.getElementById('settingsBody').innerHTML = `
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
        <input id="newStaffName" class="input" type="text" placeholder="Full name"
               onkeydown="if(event.key==='Enter')addStaff()">
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
      <span class="staff-name">${esc(s.name)}</span>
      <button class="btn btn-danger btn-sm" onclick="removeStaff('${esc(s.id)}')">Remove</button>
    </div>`).join('');
}

async function savePassword() {
  const pw  = document.getElementById('newPw').value;
  const pw2 = document.getElementById('confirmPw').value;
  if (!pw)        { toast('Enter a password', 'error'); return; }
  if (pw !== pw2) { toast('Passwords do not match', 'error'); return; }
  localStorage.setItem('edit_pw', await hashPw(pw));
  document.getElementById('newPw').value = '';
  document.getElementById('confirmPw').value = '';
  toast('Password set — click Save to apply for everyone', 'success');
}

function addStaff() {
  const name = document.getElementById('newStaffName').value.trim();
  if (!name) { toast('Enter a name', 'error'); return; }
  const maxId = S.staff.reduce((m, s) => Math.max(m, parseInt(s.id, 10) || 0), 0);
  const id = String(maxId + 1);
  S.staff.push({ id, name });
  document.getElementById('newStaffName').value = '';
  document.getElementById('staffList').innerHTML = staffListHTML();
  markDirty();
  toast(name + ' added', 'success');
}

function removeStaff(id) {
  const s = S.staff.find(x => x.id === id);
  S.staff       = S.staff.filter(x => x.id !== id);
  S.assignments = S.assignments.filter(a => a.staffId !== id);
  S.leave       = S.leave.filter(l => l.staffId !== id);
  document.getElementById('staffList').innerHTML = staffListHTML();
  markDirty();
  renderCalendar();
  if (s) toast(s.name + ' removed');
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
function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Start ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
