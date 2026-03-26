/**
 * 課程更新大看板 — 數據抓取腳本
 *
 * 從 Circle Admin V2 API 抓取所有課程空間的最新更新，
 * 生成 public/data/courses.json 供前端使用。
 *
 * 用法：
 *   CIRCLE_V2_TOKEN=xxx node scripts/fetch-courses.js
 *
 * 或在 .env 中設置 CIRCLE_V2_TOKEN
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========== Configuration ==========
const API_BASE = 'https://app.circle.so/api/admin/v2';
const COMMUNITY_URL = 'https://member.pathunfold.com';

// Post-type spaces (not auto-discoverable, manually tracked)
// These are regular post spaces that contain course-like content
const KNOWN_POST_SPACES = [
  { id: 2453584, name: '迷你公開課' },
  { id: 2205110, name: '快速課程' },
];

// Spaces to EXCLUDE from auto-discovery (non-course spaces)
const EXCLUDED_SPACE_IDS = new Set([
  2175667,  // 電子報&站務
  2175665,  // 分享交流
  2175670,  // 活動
  2548212,  // 活動區
  2175909,  // 新人報到
  2183637,  // 尋求幫助
  2183353,  // Vibe Coding日記
  2183782,  // 直播存檔
  2230360,  // 成果提交
  2227323,  // 交作業
  2230363,  // 聊天室
  2230366,  // 論壇交流
  2232363,  // AI電波
  2236299,  // 線下Meetup
  2224210,  // 開始清單
  2368352,  // Program活動
  2368353,  // 星空小船
  2389795,  // 學習路線
  2392017,  // 用AI發電Podcast
  2483936,  // Build With Us: Mini Hackathon
  2453584,  // 迷你公開課 (handled as post space)
  2205110,  // 快速課程 (handled as post space)
]);

// How many days of history to fetch (set high to include all courses)
const LOOKBACK_DAYS = 3650;


// ========== API Helpers ==========
function getToken() {
  const token = process.env.CIRCLE_V2_TOKEN;
  if (!token) {
    console.error('❌ Missing CIRCLE_V2_TOKEN environment variable');
    process.exit(1);
  }
  return token;
}

function headers(token) {
  return {
    'Authorization': `Token ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

async function apiGet(endpoint, params, token) {
  const url = new URL(`${API_BASE}${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), { headers: headers(token) });
  if (!res.ok) {
    const text = await res.text();
    console.error(`  ⚠️ API error ${res.status} for ${endpoint}: ${text.slice(0, 200)}`);
    return null;
  }
  return res.json();
}

async function fetchAllPages(endpoint, params, token) {
  const allRecords = [];
  let page = 1;

  while (true) {
    const data = await apiGet(endpoint, { ...params, page, per_page: 100 }, token);
    if (!data) break;

    const records = data.records || [];
    allRecords.push(...records);

    if (!data.has_next_page) break;
    page++;

    // Safety limit
    if (page > 50) {
      console.warn(`  ⚠️ Hit page limit (50) for ${endpoint}`);
      break;
    }
  }

  return allRecords;
}

// ========== Space Data Fetchers ==========

/**
 * Fetch lessons from a course-type space.
 * Returns an array of { title, url, date, type, space_name }
 */
async function fetchCourseLessons(space, token, since) {
  console.log(`  📖 Fetching lessons from「${space.name}」(space ${space.id})...`);

  // First get sections for name mapping
  const sections = await fetchAllPages('/course_sections', { space_id: space.id }, token);
  const sectionMap = new Map();
  for (const s of sections) {
    sectionMap.set(s.id, s.name);
  }

  // Then get published lessons
  const lessons = await fetchAllPages(
    '/course_lessons',
    { space_id: space.id, status: 'published', sort: 'created_at_desc' },
    token
  );

  // Also try to get the space slug if we don't have it
  let spaceSlug = space.slug;
  if (!spaceSlug) {
    // Try to get from space details
    const spaceData = await apiGet(`/spaces/${space.id}`, {}, token);
    if (spaceData) {
      spaceSlug = spaceData.slug || spaceData.record?.slug;
    }
  }

  const courses = [];
  for (const lesson of lessons) {
    const createdAt = new Date(lesson.created_at);
    if (createdAt < since) continue;

    const sectionName = sectionMap.get(lesson.section_id);
    const title = lesson.name;

    // Build URL
    let url;
    if (spaceSlug) {
      url = `${COMMUNITY_URL}/c/${spaceSlug}/sections/${lesson.section_id}/lessons/${lesson.id}`;
    } else {
      url = `${COMMUNITY_URL}/c/${space.id}/sections/${lesson.section_id}/lessons/${lesson.id}`;
    }

    courses.push({
      title,
      url,
      date: lesson.created_at,
      type: 'lesson',
      space_name: space.name,
      space_id: space.id,
      section_name: sectionName || null,
    });
  }

  console.log(`    → ${courses.length} new lessons`);
  return courses;
}

/**
 * Fetch posts from a post-type space.
 * Returns an array of { title, url, date, type, space_name }
 */
async function fetchSpacePosts(space, token, since) {
  console.log(`  📰 Fetching posts from「${space.name}」(space ${space.id})...`);

  const data = await apiGet('/posts', {
    space_id: space.id,
    per_page: 50,
    status: 'published',
  }, token);

  if (!data) return [];

  const posts = data.records || [];
  const courses = [];

  for (const post of posts) {
    const createdAt = new Date(post.created_at);
    if (createdAt < since) continue;

    const spaceSlug = post.space_slug || space.slug;
    const url = spaceSlug
      ? `${COMMUNITY_URL}/c/${spaceSlug}/${post.slug}`
      : `${COMMUNITY_URL}/c/${space.id}/${post.slug}`;

    courses.push({
      title: post.name,
      url,
      date: post.created_at,
      type: 'post',
      space_name: space.name,
      space_id: space.id,
    });
  }

  console.log(`    → ${courses.length} new posts`);
  return courses;
}

// ========== Dynamic Space Discovery ==========

/**
 * Fetch all spaces from Circle API and filter for course-type spaces.
 * This auto-discovers new course spaces that are created after deployment.
 */
async function discoverCourseSpaces(token) {
  console.log('🔎 Auto-discovering course spaces...');
  const allSpaces = await fetchAllPages('/spaces', {}, token);
  
  const courseSpaces = [];
  for (const space of allSpaces) {
    // Skip excluded spaces
    if (EXCLUDED_SPACE_IDS.has(space.id)) continue;
    
    // Include spaces that are course-type (have lessons)
    // Circle API returns space_type or we can check if it has course features
    const spaceType = space.space_type || space.type;
    if (spaceType === 'course') {
      courseSpaces.push({
        id: space.id,
        name: space.name,
        type: 'course',
        slug: space.slug || null,
      });
    }
  }
  
  // Add known post-type spaces
  const postSpaces = KNOWN_POST_SPACES.map(s => ({
    ...s,
    type: 'posts',
    slug: null,
  }));
  
  const all = [...courseSpaces, ...postSpaces];
  console.log(`  → Found ${courseSpaces.length} course spaces + ${postSpaces.length} post spaces = ${all.length} total\n`);
  
  for (const s of courseSpaces) {
    console.log(`    📖 [course] ${s.name} (${s.id})`);
  }
  for (const s of postSpaces) {
    console.log(`    📰 [posts]  ${s.name} (${s.id})`);
  }
  console.log('');
  
  return all;
}

// ========== Main ==========
async function main() {
  console.log('🚀 課程更新大看板 — 數據抓取');
  console.log(`📅 ${new Date().toISOString()}\n`);

  const token = getToken();
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  console.log(`🔍 搜索範圍: 近 ${LOOKBACK_DAYS} 天 (since ${since.toISOString().split('T')[0]})\n`);

  // Dynamically discover course spaces
  const spaces = await discoverCourseSpaces(token);

  const allCourses = [];

  for (const space of spaces) {
    try {
      let items;
      if (space.type === 'course') {
        items = await fetchCourseLessons(space, token, since);
      } else {
        items = await fetchSpacePosts(space, token, since);
      }
      allCourses.push(...items);
    } catch (err) {
      console.error(`  ❌ Error fetching「${space.name}」: ${err.message}`);
    }
  }

  // Sort by date descending
  allCourses.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Build output
  const output = {
    updated_at: new Date().toISOString(),
    lookback_days: LOOKBACK_DAYS,
    total: allCourses.length,
    spaces_monitored: spaces.length,
    courses: allCourses,
  };

  // Write to public/data/courses.json
  const outDir = path.join(__dirname, '..', 'public', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'courses.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✅ 完成！共 ${allCourses.length} 個課程更新已保存到 ${outPath}`);

  // Print summary by space
  const bySpace = {};
  for (const c of allCourses) {
    bySpace[c.space_name] = (bySpace[c.space_name] || 0) + 1;
  }
  console.log('\n📊 各空間更新數量:');
  for (const [name, count] of Object.entries(bySpace).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`);
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

