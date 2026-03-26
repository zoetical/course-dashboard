/**
 * 課程更新看板 — 前端邏輯
 * - 載入 /data/courses.json
 * - 渲染課程卡片
 * - 時間篩選 + 搜索
 */

const DATA_URL = './data/courses.json';

// ========== State ==========
let allCourses = [];
let filterDays = 'all';
let searchQuery = '';

// ========== DOM Refs ==========
const grid = document.getElementById('courses-grid');
const loadingState = document.getElementById('loading-state');
const emptyState = document.getElementById('empty-state');
const statTotal = document.getElementById('stat-total');
const statCourses = document.getElementById('stat-courses');
const statUpdated = document.getElementById('stat-updated');
const searchInput = document.getElementById('search-input');

// ========== Data Loading ==========
async function loadCourses() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allCourses = data.courses || [];

    // Update stats
    statTotal.textContent = allCourses.length;
    const uniqueSpaces = new Set(allCourses.map(c => c.space_name));
    statCourses.textContent = uniqueSpaces.size;
    statUpdated.textContent = data.updated_at
      ? formatRelativeTime(data.updated_at)
      : '—';

    loadingState.style.display = 'none';
    renderCourses();
  } catch (err) {
    console.error('Failed to load courses:', err);
    loadingState.innerHTML = `
      <div class="empty-icon">⚠️</div>
      <p>載入失敗，請稍後重試</p>
    `;
  }
}

// ========== Rendering ==========
function renderCourses() {
  const filtered = getFilteredCourses();

  if (filtered.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  grid.innerHTML = filtered.map((course, i) => {
    const isNew = isWithinDays(course.date, 3);
    const typeClass = course.type === 'lesson' ? 'card-type--lesson' : 'card-type--post';
    const typeLabel = course.type === 'lesson' ? 'Lesson' : 'Post';
    const delay = Math.min(i * 0.04, 0.6);

    return `
      <a href="${escapeHtml(course.url)}"
         target="_blank"
         rel="noopener"
         class="course-card"
         style="animation-delay: ${delay}s"
         title="${escapeHtml(course.title)}">
        <div class="card-header">
          <span class="card-space-tag">${escapeHtml(course.space_name)}</span>
          ${isNew ? '<span class="card-new-badge">NEW</span>' : ''}
        </div>
        <div class="card-title">${escapeHtml(course.title)}</div>
        <div class="card-meta">
          <span class="card-date">${formatDate(course.date)}</span>
          <span class="card-type ${typeClass}">${typeLabel}</span>
        </div>
        <span class="card-arrow" aria-hidden="true">→</span>
      </a>
    `;
  }).join('');
}

function getFilteredCourses() {
  let courses = [...allCourses];

  // Time filter
  if (filterDays !== 'all') {
    const days = parseInt(filterDays);
    courses = courses.filter(c => isWithinDays(c.date, days));
  }

  // Search filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    courses = courses.filter(c =>
      c.title.toLowerCase().includes(q) ||
      c.space_name.toLowerCase().includes(q)
    );
  }

  // Sort by date descending
  courses.sort((a, b) => new Date(b.date) - new Date(a.date));

  return courses;
}

// ========== Event Listeners ==========
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterDays = btn.dataset.filter;
    renderCourses();
  });
});

searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderCourses();
});

// ========== Helpers ==========
function isWithinDays(dateStr, days) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / (1000 * 60 * 60 * 24);
  return diff <= days;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function formatRelativeTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '剛剛';
  if (diffMins < 60) return `${diffMins} 分鐘前`;
  if (diffHours < 24) return `${diffHours} 小時前`;
  if (diffDays < 7) return `${diffDays} 天前`;
  return formatDate(dateStr);
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ========== Init ==========
loadCourses();
