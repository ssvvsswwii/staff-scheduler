const BRANCHES    = ['Rimba Point', 'Healthy Holm Kiulap', 'Hua Ho Manggis'];
const BCOLORS     = ['bcolor-0', 'bcolor-1', 'bcolor-2'];
const PERIOD_DAYS = 14;

let staff       = [];
let assignments = [];
let periodStart = null;

// ── Load data from static JSON files (served by GitHub Pages) ─────────────────
async function loadData() {
  try {
    const bust = `?v=${Date.now()}`;
    const [sr, scr] = await Promise.all([
      fetch(`./data/staff.json${bust}`, { cache: 'no-cache' }),
      fetch(`./data/schedule.json${bust}`, { cache: 'no-cache' })
    ]);
    if (!sr.ok || !scr.ok) throw new Error('files not found');
    staff = await sr.json();
    const sched = await scr.json();
    assignments = sched.assignments || [];
    periodStart = sched.periodStart || null;
    renderPeriodRange();
  } catch {
    document.getElementById('results').innerHTML =
      '<p class="no-result"><span class="icon">⚠️</span>Schedule not available yet. Check back later.</p>';
  }
}

function renderPeriodRange() {
  if (!periodStart) return;
  const start = new Date(periodStart + 'T00:00:00');
  const end   = new Date(start);
  end.setDate(start.getDate() + PERIOD_DAYS - 1);
  const fmt = d => d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById('periodRange').textContent = `${fmt(start)} – ${fmt(end)}`;
}

// ── Render results for a search query ─────────────────────────────────────────
function render(query) {
  const box = document.getElementById('results');
  const q   = query.trim().toLowerCase();

  if (!q) {
    box.innerHTML = '<p class="no-result"><span class="icon">🔍</span>Type your name above to see your shifts.</p>';
    return;
  }

  const matches = staff.filter(s =>
    s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)
  );

  if (!matches.length) {
    box.innerHTML = '<p class="no-result"><span class="icon">🤔</span>No staff found. Check the spelling or contact your admin.</p>';
    return;
  }

  const ids = new Set(matches.map(s => s.id));
  const relevant = assignments
    .filter(a => ids.has(a.staffId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));

  if (!relevant.length) {
    box.innerHTML = '<p class="no-result"><span class="icon">📭</span>No shifts assigned in this period yet.</p>';
    return;
  }

  // Group by date
  const byDate = {};
  relevant.forEach(a => { (byDate[a.date] = byDate[a.date] || []).push(a); });

  let html = '';
  Object.keys(byDate).sort().forEach(date => {
    const d = new Date(date + 'T00:00:00');
    const label = d.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long' });
    html += `<div class="day-group"><div class="day-label">${label}</div>`;
    byDate[date].forEach(a => {
      const s    = staff.find(x => x.id === a.staffId);
      const bi   = BRANCHES.indexOf(a.branch);
      const bcls = BCOLORS[bi] ?? BCOLORS[0];
      html += `
        <div class="shift-card">
          <div class="branch-dot ${bcls}"></div>
          <div class="card-info">
            <div class="card-name">${esc(s ? s.name : a.staffId)}</div>
            <div class="card-branch">${esc(a.branch)}</div>
          </div>
          <span class="shift-badge ${a.shift.toLowerCase()}">${a.shift}</span>
        </div>`;
    });
    html += '</div>';
  });

  box.innerHTML = html;
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  const input = document.getElementById('searchInput');
  input.addEventListener('input', e => render(e.target.value));
  input.focus();
});
