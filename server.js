import 'dotenv/config';
import express from 'express';
import { Pool } from 'pg';
import NodeCache from 'node-cache';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5 min cache

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---- Sanity check for public folder ----
console.log('Serving static from:', path.join(__dirname, 'public'));
console.log('Exists:', fs.existsSync(path.join(__dirname, 'public')));

// ---- DB pools ----
const performerPool = new Pool({
  connectionString: process.env.PERFORMER_NEON_KEY,
  max: 3,
  idleTimeoutMillis: 10000,
});

const scenePool = new Pool({
  connectionString: process.env.SCENE_NEON_KEY,
  max: 3,
  idleTimeoutMillis: 10000,
});

// ---- Helper: safe cast expression ----
// Turns '' / whitespace / junk into NULL so ::int / ::float won't throw.
function safeInt(col) {
  return `NULLIF(regexp_replace(${col}, '[^0-9-]', '', 'g'), '')::int`;
}
function safeFloat(col) {
  return `NULLIF(regexp_replace(${col}, '[^0-9.-]', '', 'g'), '')::numeric`;
}

// ---------- SEARCH PERFORMERS ----------
app.get('/api/performers', async (req, res) => {
  try {
    const {
      search = '',
      gender, cup_size, breast_type, ethnicity, country,
      hair_color, rating,
      minHeight, maxHeight, minYear, maxYear,
      minWhr, maxWhr, minScenes,
      page = 1, limit = 24,
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const cacheKey = `perf:${JSON.stringify(req.query)}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const params = [];
    const conditions = [];

    // Text search on name
    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(`p.name ILIKE $${params.length}`);
    }

    // Multi-value categorical filters (comma-separated allowed)
    const addInFilter = (col, value) => {
      if (!value) return;
      const vals = value.split(',').map(v => v.trim()).filter(Boolean);
      if (!vals.length) return;
      params.push(vals);
      conditions.push(`p.${col} = ANY($${params.length})`);
    };

    addInFilter('gender', gender);
    addInFilter('cup_size', cup_size);
    addInFilter('breast_type', breast_type);
    addInFilter('ethnicity', ethnicity);
    addInFilter('country', country);
    addInFilter('hair_color', hair_color);

    // Numeric filters — cast text columns safely
    if (minHeight) {
      params.push(parseInt(minHeight, 10));
      conditions.push(`${safeInt('p.height')} >= $${params.length}`);
    }
    if (maxHeight) {
      params.push(parseInt(maxHeight, 10));
      conditions.push(`${safeInt('p.height')} <= $${params.length}`);
    }
    if (minYear) {
      params.push(parseInt(minYear, 10));
      conditions.push(`${safeInt('p.career_start_year')} >= $${params.length}`);
    }
    if (maxYear) {
      params.push(parseInt(maxYear, 10));
      conditions.push(`${safeInt('p.career_start_year')} <= $${params.length}`);
    }
    if (minScenes) {
      params.push(parseInt(minScenes, 10));
      conditions.push(`${safeInt('p.scene_count')} >= $${params.length}`);
    }
    if (minWhr) {
      params.push(parseFloat(minWhr));
      conditions.push(
        `(${safeFloat('p.waist_size')} / NULLIF(${safeFloat('p.hip_size')}, 0)) >= $${params.length}`
      );
    }
    if (maxWhr) {
      params.push(parseFloat(maxWhr));
      conditions.push(
        `(${safeFloat('p.waist_size')} / NULLIF(${safeFloat('p.hip_size')}, 0)) <= $${params.length}`
      );
    }

    // Rating filter
    const ratingFilter = rating
      ? `AND COALESCE(r.rating, 'U') = ANY($${params.push(rating.split(',').map(s => s.trim()))})`
      : '';

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT p.id, p.name, p.images, p.gender,
             ${safeInt('p.scene_count')} AS scene_count,
             p.height, p.cup_size, p.breast_type, p.ethnicity,
             p.country, p.hair_color, p.waist_size, p.hip_size,
             p.career_start_year,
             COALESCE(r.rating, 'U') AS rating
      FROM all_performers p
      LEFT JOIN LATERAL (
        SELECT rating FROM performer_ratings
        WHERE performer_id = p.id
        ORDER BY updated_at DESC LIMIT 1
      ) r ON true
      ${whereSql} ${ratingFilter}
      ORDER BY ${safeInt('p.scene_count')} DESC NULLS LAST
      LIMIT $${params.push(parseInt(limit, 10))}
      OFFSET $${params.push(offset)};
    `;

    const { rows } = await performerPool.query(query, params);

    // Count query reuses same filters (drop the last two params: limit, offset)
    const countParams = params.slice(0, params.length - 2);
    const countSql = `
      SELECT COUNT(*)::int AS total FROM all_performers p
      LEFT JOIN LATERAL (
        SELECT rating FROM performer_ratings
        WHERE performer_id = p.id
        ORDER BY updated_at DESC LIMIT 1
      ) r ON true
      ${whereSql} ${ratingFilter};
    `;
    const { rows: countRows } = await performerPool.query(countSql, countParams);

    const result = {
      performers: rows.map(formatPerformer),
      total: countRows[0]?.total ?? 0,
      page: parseInt(page, 10),
      pages: Math.ceil((countRows[0]?.total ?? 0) / parseInt(limit, 10)),
    };

    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Performer search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- SINGLE PERFORMER ----------
app.get('/api/performers/:id', async (req, res) => {
  try {
    const cacheKey = `perf-id:${req.params.id}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await performerPool.query(
      `SELECT p.*, COALESCE(r.rating,'U') AS rating, r.updated_at AS rating_updated
       FROM all_performers p
       LEFT JOIN LATERAL (
         SELECT rating, updated_at FROM performer_ratings
         WHERE performer_id = p.id ORDER BY updated_at DESC LIMIT 1
       ) r ON true
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });

    const result = formatPerformer(rows[0]);
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Performer detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- SCENES FOR PERFORMER ----------
app.get('/api/performers/:name/scenes', async (req, res) => {
  try {
    const name = req.params.name;
    const page = parseInt(req.query.page || 1, 10);
    const limit = 24;
    const offset = (page - 1) * limit;
    const cacheKey = `scenes:${name}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await scenePool.query(
      `SELECT url, title, thumbnail, duration, studio, date, performer, performers_list
       FROM "Video_Scenes"
       WHERE performer = $1 OR performers_list ILIKE $2
       ORDER BY date ASC NULLS LAST
       LIMIT $3 OFFSET $4`,
      [name, `%${name}%`, limit, offset]
    );

    const { rows: countRows } = await scenePool.query(
      `SELECT COUNT(*)::int AS total FROM "Video_Scenes"
       WHERE performer = $1 OR performers_list ILIKE $2`,
      [name, `%${name}%`]
    );

    const result = {
      scenes: rows,
      total: countRows[0].total,
      page,
      pages: Math.ceil(countRows[0].total / limit),
    };
    cache.set(cacheKey, result);
    res.json(result);
  } catch (err) {
    console.error('Scenes error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/performers/:id/rating', async (req, res) => {
  try {
    const { rating } = req.body;
    const valid = ['S', 'A', 'B', 'C', 'D', 'F', 'U', 'L', 'N/A'];
    if (!valid.includes(rating)) {
      return res.status(400).json({ error: 'Invalid rating' });
    }
    const performerId = req.params.id;   // <-- keep as string (UUID)

    if (rating === 'N/A') {
      await performerPool.query(
        `DELETE FROM performer_ratings WHERE performer_id = $1`,
        [performerId]
      );
    } else {
      await performerPool.query(
        `INSERT INTO performer_ratings (performer_id, rating, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (performer_id)
         DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()`,
        [performerId, rating]
      );
    }

    cache.flushAll();
    res.json({ ok: true, rating });
  } catch (err) {
    console.error('Rating error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- FILTER OPTIONS (for dropdowns) ----------
app.get('/api/filters', async (_req, res) => {
  const cacheKey = 'filters';
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { rows } = await performerPool.query(`
      SELECT
        ARRAY(SELECT DISTINCT gender      FROM all_performers WHERE gender IS NOT NULL)      AS genders,
        ARRAY(SELECT DISTINCT cup_size    FROM all_performers WHERE cup_size IS NOT NULL)    AS cups,
        ARRAY(SELECT DISTINCT breast_type FROM all_performers WHERE breast_type IS NOT NULL) AS breasts,
        ARRAY(SELECT DISTINCT ethnicity   FROM all_performers WHERE ethnicity IS NOT NULL)   AS ethnicities,
        ARRAY(SELECT DISTINCT country     FROM all_performers WHERE country IS NOT NULL)     AS countries,
        ARRAY(SELECT DISTINCT hair_color  FROM all_performers WHERE hair_color IS NOT NULL)  AS hairs;
    `);
    cache.set(cacheKey, rows[0]);
    res.json(rows[0]);
  } catch (err) {
    console.error('Filters error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- HELPERS ----------
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}
function toInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function formatPerformer(p) {
  const heightCm = toNum(p.height);
  const totalInches = heightCm ? heightCm / 2.54 : null;
  const heightDisplay = totalInches
    ? `${Math.floor(totalInches / 12)}'${Math.round(totalInches % 12)}"`
    : null;

  const waist = toNum(p.waist_size);
  const hip = toNum(p.hip_size);
  const whr = waist && hip ? (waist / hip).toFixed(2) : null;

  return {
    id: p.id,
    name: p.name,
    images: p.images ? p.images.split(';').map(s => s.trim()).filter(Boolean) : [],
    gender: p.gender,
    scene_count: toInt(p.scene_count),
    height_cm: heightCm,
    height_display: heightDisplay,
    cup_size: p.cup_size,
    breast_type: p.breast_type,
    ethnicity: p.ethnicity,
    country: p.country,
    hair_color: p.hair_color,
    waist,
    hip,
    whr,
    career_start_year: toInt(p.career_start_year),
    rating: p.rating || 'U',
    rating_updated: p.rating_updated || null,
  };
}

// ---------- LISTEN ----------
const PORT = parseInt(process.env.PORT || '3000', 10);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});