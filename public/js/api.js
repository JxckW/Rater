const API = {
  async getPerformers(params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) {
        qs.append(k, Array.isArray(v) ? v.join(',') : v);
      }
    }
    const r = await fetch(`/api/performers?${qs}`);
    if (!r.ok) throw new Error('Failed to load performers');
    return r.json();
  },
  async getPerformer(id) {
    const r = await fetch(`/api/performers/${id}`);
    if (!r.ok) throw new Error('Performer not found');
    return r.json();
  },
  async getScenes(name, page = 1) {
    const r = await fetch(`/api/performers/${encodeURIComponent(name)}/scenes?page=${page}`);
    if (!r.ok) throw new Error('Failed to load scenes');
    return r.json();
  },
  async setRating(id, rating) {
    const r = await fetch(`/api/performers/${id}/rating`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    });
    if (!r.ok) throw new Error('Failed to save rating');
    return r.json();
  },
  async getFilters() {
    const r = await fetch('/api/filters');
    if (!r.ok) throw new Error('Failed to load filters');
    return r.json();
  },
};