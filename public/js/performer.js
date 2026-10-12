// Modal rendering for performer detail
const RATINGS = ['S','A','B','C','D','F','U','L','N/A'];

function openModal() {
  document.getElementById('modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.body.style.overflow = '';
  document.getElementById('modalBody').innerHTML = '';
  if (location.hash.startsWith('#performer/')) {
    history.replaceState('', document.title, location.pathname + location.search);
  }
}

async function showPerformer(id, pushHistory = true) {
  const body = document.getElementById('modalBody');
  body.innerHTML = '<div class="loading">Loading...</div>';
  openModal();
  window.scrollTo(0, 0);

  if (pushHistory && location.hash !== `#performer/${id}`) {
    history.pushState({ performerId: id }, '', `#performer/${id}`);
  }

  try {
    const p = await API.getPerformer(id);
    body.innerHTML = renderPerformer(p);
    attachRatingHandlers(p);
    loadScenes(p.name, 1);
  } catch (err) {
    body.innerHTML = `<div class="empty">${err.message}</div>`;
  }
}

// Handle back/forward + initial load
window.addEventListener('popstate', () => {
  const m = location.hash.match(/^#performer\/(.+)$/);
  if (m) showPerformer(decodeURIComponent(m[1]), false);
  else closeModal();
});

// On page load, if URL has a performer hash, open it
window.addEventListener('DOMContentLoaded', () => {
  const m = location.hash.match(/^#performer\/(.+)$/);
  if (m) showPerformer(decodeURIComponent(m[1]), false);
});

function renderPerformer(p) {
  const imgs = p.images.length
    ? p.images.map(src => `<img src="${src}" loading="lazy" onerror="this.style.display='none'">`).join('')
    : '<div class="empty">No images</div>';

  const bio = [
    ['Height', p.height_display || (p.height_cm ? p.height_cm + ' cm' : '—')],
    ['Cup Size', p.cup_size || '—'],
    ['Breast Type', p.breast_type || '—'],
    ['Ethnicity', p.ethnicity || '—'],
    ['Country', p.country || '—'],
    ['Hair', p.hair_color || '—'],
    ['Waist', p.waist || '—'],
    ['Hip', p.hip || '—'],
    ['W:H Ratio', p.whr || '—'],
    ['Career Start', p.career_start_year || '—'],
    ['Scenes', p.scene_count ?? '—'],
  ].map(([l, v]) => `<div class="bio-item"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('');

  const ratingBtns = RATINGS.map(r =>
    `<button data-rating="${r}" class="${p.rating === r ? 'active' : ''}">${r}</button>`
  ).join('');

  return `
    <div class="performer-header">
      <div class="performer-gallery">${imgs}</div>
      <div class="performer-info">
        <h2>${p.name}</h2>
        <div class="bio-grid">${bio}</div>
        <div>
          <div class="section-title" style="margin-top:0">Rating</div>
          <div class="rating-picker" id="ratingPicker">${ratingBtns}</div>
        </div>
      </div>
    </div>
    <div class="section-title">Scenes</div>
    <div id="scenesContainer" class="scenes-list"></div>
    <div id="scenesPagination" class="pagination"></div>
  `;
}

function attachRatingHandlers(p) {
  const picker = document.getElementById('ratingPicker');
  picker.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-rating]');
    if (!btn) return;
    const rating = btn.dataset.rating;
    try {
      await API.setRating(p.id, rating);
      picker.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      p.rating = rating;
      // Refresh card in results grid without full refetch
      const card = document.querySelector(`.card[data-id="${p.id}"]`);
      if (card) {
        const badge = card.querySelector('.rating-badge');
        if (badge) {
          badge.className = `rating-badge rating-${rating}`;
          badge.textContent = rating;
        }
      }
    } catch (err) {
      alert(err.message);
    }
  });
}

async function loadScenes(name, page) {
  const c = document.getElementById('scenesContainer');
  const pag = document.getElementById('scenesPagination');
  c.innerHTML = '<div class="loading" style="grid-column:1/-1">Loading scenes...</div>';
  pag.innerHTML = '';

  try {
    const data = await API.getScenes(name, page);
    if (!data.scenes.length) {
      c.innerHTML = '<div class="empty" style="grid-column:1/-1">No scenes found.</div>';
      return;
    }
    c.innerHTML = data.scenes.map(s => `
      <a class="scene-card" href="${s.url}" target="_blank" rel="noopener">
        <div class="scene-thumb-wrap">
          <img class="scene-thumb" src="${s.thumbnail || ''}" loading="lazy"
               onerror="this.style.visibility='hidden'">
          ${s.duration ? `<span class="scene-duration">${escapeHtml(s.duration)}</span>` : ''}
        </div>
        <div class="scene-body">
          <div class="scene-title" title="${escapeHtml(s.title || 'Untitled')}">${escapeHtml(s.title || 'Untitled')}</div>
          <div class="scene-info">
            ${s.studio ? `<span>${escapeHtml(s.studio)}</span>` : ''}
            ${s.date ? `<span>${formatDate(s.date)}</span>` : ''}
          </div>
        </div>
      </a>
    `).join('');
    renderScenesPagination(name, data.page, data.pages);
  } catch (err) {
    c.innerHTML = `<div class="empty" style="grid-column:1/-1">${err.message}</div>`;
  }
}

function renderScenesPagination(name, current, total) {
  const pag = document.getElementById('scenesPagination');
  if (total <= 1) return;
  const frag = document.createDocumentFragment();
  const mk = (label, page, active = false, disabled = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (active) b.classList.add('active');
    if (disabled) b.disabled = true;
    else b.onclick = () => loadScenes(name, page);
    return b;
  };
  frag.appendChild(mk('« Prev', current - 1, false, current === 1));
  const start = Math.max(1, current - 2);
  const end = Math.min(total, current + 2);
  for (let i = start; i <= end; i++) frag.appendChild(mk(i, i, i === current));
  frag.appendChild(mk('Next »', current + 1, false, current === total));
  pag.innerHTML = '';
  pag.appendChild(frag);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function formatDate(d) {
  const dt = new Date(d);
  return isNaN(dt) ? d : dt.toLocaleDateString();
}