/**
 * 課程更新通知腳本
 *
 * 對比新舊 courses.json，如果有新課程，
 * 自動在 Circle 置頂帖下發一條評論，觸發空間 badge 通知。
 *
 * 用法：
 *   CIRCLE_V1_TOKEN=xxx node scripts/notify-update.js
 *
 * 環境變量：
 *   CIRCLE_V1_TOKEN — Circle Admin V1 API token
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========== Configuration ==========
const COMMUNITY_ID = 44706; // 用AI发电
const POST_ID = 31030549;   // 置頂帖「課程更新看板」
const API_BASE = 'https://app.circle.so/api/v1';

const COURSES_PATH = path.join(__dirname, '..', 'public', 'data', 'courses.json');

// ========== Main ==========
async function main() {
  console.log('🔔 課程更新通知檢查...\n');

  const token = process.env.CIRCLE_V1_TOKEN;
  if (!token) {
    console.error('❌ Missing CIRCLE_V1_TOKEN');
    process.exit(1);
  }

  // Load current (newly fetched) courses
  if (!fs.existsSync(COURSES_PATH)) {
    console.log('⚠️ No courses.json found, skipping notification.');
    return;
  }
  const current = JSON.parse(fs.readFileSync(COURSES_PATH, 'utf-8'));

  // Load previous courses from git (before the new fetch)
  let previous;
  try {
    const prevContent = execSync(
      `git show HEAD:public/data/courses.json`,
      { encoding: 'utf-8', cwd: path.join(__dirname, '..') }
    );
    previous = JSON.parse(prevContent);
  } catch {
    console.log('ℹ️ No previous courses.json in git, this is the first run. Skipping notification.');
    return;
  }

  // Find new courses by comparing titles + dates (unique key)
  const prevKeys = new Set(
    (previous.courses || []).map(c => `${c.title}|||${c.date}|||${c.space_name}`)
  );

  const newCourses = (current.courses || []).filter(
    c => !prevKeys.has(`${c.title}|||${c.date}|||${c.space_name}`)
  );

  if (newCourses.length === 0) {
    console.log('✅ 沒有新課程，不需要通知。');
    return;
  }

  console.log(`🆕 發現 ${newCourses.length} 個新課程更新！\n`);

  // Build comment body
  const lines = newCourses.slice(0, 10).map(c => {
    const section = c.section_name ? ` › ${c.section_name}` : '';
    return `• ${c.space_name}${section}：${c.title}`;
  });

  let body = `🆕 ${newCourses.length} 個新課程更新\n\n${lines.join('\n')}`;

  if (newCourses.length > 10) {
    body += `\n\n…還有 ${newCourses.length - 10} 個更新，查看看板了解更多`;
  }

  console.log('📝 評論內容：');
  console.log(body);
  console.log('');

  // Post comment via Circle V1 API
  const res = await fetch(`${API_BASE}/comments`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      community_id: COMMUNITY_ID,
      post_id: POST_ID,
      body: body,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ Comment API error ${res.status}: ${text.slice(0, 300)}`);
    process.exit(1);
  }

  const result = await res.json();
  console.log(`✅ 評論已發布！Comment ID: ${result.id}`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
