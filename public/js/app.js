const state = {
  search: '',
  filters: {},
  page: 1,
};

// Filter elements to watch
const FILTER_IDS = [
  'f_gender','f_cup_size','f_breast_type','f_ethnicity',
  'f_country','f_hair_color','f_rating','f_minHeight','f_maxHeight',
  'f_minYear','f_maxYear','f_minWhr','f_maxWhr','f_minScenes',
];

// Debounce for search input
function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Load filter dropdown options once
async function initFilters() {
  try {
    const opts = await API.getFilters();
    populateMulti('f_gender', opts.genders);
    populateMulti('f_cup_size', opts.cups);
    populateMulti('f_breast_type', opts.breasts);
    populateMulti('f_ethnicity', opts.ethnicities);
    populateMulti('f_country', opts.countries);
    populateMulti('f_hair_color', opts.hairs);
  } catch (e) { console.warn('Filters failed to load', e); }
}

function populateMulti(id, values) {
  const el = document.getElementById(id);
  if (!el || !values) return;
  el.innerHTML = values
    .filter(v => v != null && v !== '')
    .sort()
    .map(v => `<option value="${escapeAttr(v)}">${escapeAttr(v)}</option>`)
    .join('');
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function readFilters() {
  const f = {};
  const get = id => document.getElementById(id).value.trim();
  const multi = id => Array.from(document.getElementById(id).selectedOptions).map(o => o.value);

  const gender = multi('f_gender'); if (gender.length) f.gender = gender;
  const cup = multi('f_cup_size'); if (cup.length) f.cup_size = cup;
  const breast = multi('f_breast_type'); if (breast.length) f.breast_type = breast;
  const eth = multi('f_ethnicity'); if (eth.length) f.ethnicity = eth;
  const country = multi('f_country'); if (country.length) f.country = country;
  const hair = multi('f_hair_color'); if (hair.length) f.hair_color = hair;
  const rating = multi('f_rating'); if (rating.length) f.rating = rating;

  const numFields = ['minHeight','maxHeight','minYear','maxYear','minWhr','maxWhr','minScenes'];
  for (const k of numFields) {
    const v = get('f_' + k);
    if (v !== '') f[k] = v;
  }
  return f;
}

function renderCard(p) {
  const img = p.images[0] || '';
  return `
    <div class="card" data-id="${p.id}">
      ${img ? `<img class="card-img" src="${img}" loading="lazy" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22/>'">` : `<div class="card-img"></div>`}
      <span class="rating-badge rating-${p.rating}">${p.rating}</span>
      <div class="card-body">
        <div class="card-name">${escapeHtml(p.name)}</div>
        <div class="card-meta">
          <span>${escapeHtml(p.country || '')}</span>
          <span>${p.scene_count ?? 0} scenes</span>
        </div>
      </div>
    </div>
  `;
}

async function loadResults() {
  const results = document.getElementById('results');
  results.innerHTML = '<div class="loading">Loading...</div>';
  try {
    const data = await API.getPerformers({
      search: state.search,
      page: state.page,
      limit: 24,
      ...state.filters,
    });
    if (!data.performers.length) {
      results.innerHTML = '<div class="empty" style="grid-column:1/-1">No performers found.</div>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }
    results.innerHTML = data.performers.map(renderCard).join('');
    renderPagination(data.page, data.pages);
  } catch (err) {
    results.innerHTML = `<div class="empty" style="grid-column:1/-1">${err.message}</div>`;
  }
}

function renderPagination(current, total) {
  const pag = document.getElementById('pagination');
  if (total <= 1) { pag.innerHTML = ''; return; }
  const frag = document.createDocumentFragment();
  const mk = (label, page, active = false, disabled = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (active) b.classList.add('active');
    if (disabled) b.disabled = true;
    else b.onclick = () => { state.page = page; loadResults(); window.scrollTo({top:0,behavior:'smooth'}); };
    return b;
  };
  frag.appendChild(mk('«', current - 1, false, current === 1));
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  for (let i = start; i <= end; i++) frag.appendChild(mk(i, i, i === current));
  if (end < total - 1) frag.appendChild(mk('…', 0, false, true));
  if (end < total) frag.appendChild(mk(total, total, false, false));
  frag.appendChild(mk('»', current + 1, false, current === total));
  pag.innerHTML = '';
  pag.appendChild(frag);
}

// Event wiring
function init() {
  initFilters();

  const searchEl = document.getElementById('search');
  searchEl.addEventListener('input', debounce(() => {
    state.search = searchEl.value;
    state.page = 1;
    loadResults();
  }, 350));

  document.getElementById('toggleFilters').addEventListener('click', () => {
    document.getElementById('filters').classList.toggle('hidden');
  });

  // Any filter change triggers reload
  FILTER_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      state.filters = readFilters();
      state.page = 1;
      loadResults();
    });
  });

  document.getElementById('clearFilters').addEventListener('click', () => {
    FILTER_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        if (el.multiple) Array.from(el.options).forEach(o => o.selected = false);
        else el.value = '';
      }
    });
    state.filters = {};
    state.page = 1;
    loadResults();
  });

  // Card click -> modal
  document.getElementById('results').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) showPerformer(card.dataset.id);
  });

  // Modal close handlers
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  loadResults();
}

document.addEventListener('DOMContentLoaded', init);