#!/usr/bin/env python3
"""
每周课程更新帖 — 自动从 courses.json 读取过去 7 天的新课程，
生成 Tiptap 格式内容并在 Circle 创建草稿/已发布帖子。

环境变量:
  CIRCLE_V2_TOKEN  — Circle Admin V2 API Token
  AUTO_PUBLISH     — 设为 "true" 则自动发布，否则创建草稿（默认草稿）

用法:
  python scripts/weekly-update.py           # 创建草稿
  AUTO_PUBLISH=true python scripts/weekly-update.py  # 直接发布
"""

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# ========== Configuration ==========
SPACE_ID = 2175667           # 電子報&站務
TOPIC_ID = 308475            # 新課上線
API_BASE = "https://app.circle.so/api/admin/v2"
CATALOG_URL = "https://member.pathunfold.com/c/00e3ef/"

MINI_SPACE = "迷你公開課"
QUICK_LESSON_SPACE = "即學即用（快速課程）"
QUICK_SPACE = "快速課程"


def api_request(method, endpoint, token, data=None):
    """Make a Circle Admin V2 API request."""
    url = f"{API_BASE}{endpoint}"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "CourseUpdateBot/1.0",
    }
    body = json.dumps(data).encode("utf-8") if data else None
    req = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        print(f"❌ API error {e.code}: {e.read().decode()[:300]}")
        sys.exit(1)


def load_courses():
    """Load courses.json from the public/data directory."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(script_dir, "..", "public", "data", "courses.json")
    with open(path) as f:
        return json.load(f)


def filter_courses(all_courses, since):
    """Filter and categorize courses from the past 7 days."""
    mini, quick_lesson, quick, core_new = [], [], [], []

    for c in all_courses:
        created = datetime.fromisoformat(c["date"].replace("Z", "+00:00"))
        if created < since:
            continue
        if c["space_name"] == MINI_SPACE:
            mini.append(c)
        elif c["space_name"] == QUICK_LESSON_SPACE:
            quick_lesson.append(c)
        elif c["space_name"] == QUICK_SPACE:
            quick.append(c)
        elif c["type"] == "lesson":
            core_new.append(c)

    # Core courses: distinguish new sections vs new lessons
    section_groups = defaultdict(list)
    for c in core_new:
        key = (c["space_name"], c.get("section_name", ""))
        section_groups[key].append(c)

    # Check if sections are entirely new
    all_section_lessons = defaultdict(list)
    for c in all_courses:
        if c["type"] == "lesson" and c["space_name"] not in [
            MINI_SPACE, QUICK_LESSON_SPACE, QUICK_SPACE
        ]:
            key = (c["space_name"], c.get("section_name", ""))
            all_section_lessons[key].append(c)

    core_sections, core_lessons = [], []
    for (space, section), new_lessons in section_groups.items():
        all_in_section = all_section_lessons.get((space, section), [])
        all_recent = all(
            datetime.fromisoformat(l["date"].replace("Z", "+00:00")) >= since
            for l in all_in_section
        )
        if all_recent and section:
            first_url = new_lessons[0]["url"]
            section_url = "/".join(first_url.split("/")[:-2])
            core_sections.append({
                "title": f"{space}｜{section}",
                "url": section_url,
                "date": min(l["date"] for l in new_lessons),
                "lesson_count": len(new_lessons),
            })
        else:
            core_lessons.extend(new_lessons)

    return {
        "mini": mini,
        "quick_lesson": quick_lesson,
        "quick": quick,
        "core_sections": core_sections,
        "core_lessons": core_lessons,
    }


def build_tiptap_content(data):
    """Build Tiptap JSON content for the post."""
    content = []

    # 迷你公開課
    if data["mini"]:
        content.append({"type": "heading", "attrs": {"level": 3},
            "content": [{"type": "text", "text": "📺 迷你公開課"}]})
        content.append({"type": "bulletList", "content": [
            {"type": "listItem", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": item["title"].strip(),
                 "marks": [{"type": "link", "attrs": {"href": item["url"], "target": "_blank"}}]},
                {"type": "text", "text": f"（{item['date'][:10]}）"},
            ]}]} for item in data["mini"]
        ]})

    # 即學即用
    if data["quick_lesson"]:
        content.append({"type": "heading", "attrs": {"level": 3},
            "content": [{"type": "text", "text": "⚡ 即學即用 Lesson 更新"}]})
        items = []
        for item in data["quick_lesson"]:
            sec = item.get("section_name", "")
            title = f"{sec}｜{item['title']}" if sec else item["title"]
            items.append({"type": "listItem", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": title.strip(),
                 "marks": [{"type": "link", "attrs": {"href": item["url"], "target": "_blank"}}]},
                {"type": "text", "text": f"（{item['date'][:10]}）"},
            ]}]})
        content.append({"type": "bulletList", "content": items})

    # 快速課程
    if data["quick"]:
        content.append({"type": "heading", "attrs": {"level": 3},
            "content": [{"type": "text", "text": "🚀 快速課程"}]})
        content.append({"type": "bulletList", "content": [
            {"type": "listItem", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": item["title"].replace("「用AI發電」", "").strip(),
                 "marks": [{"type": "link", "attrs": {"href": item["url"], "target": "_blank"}}]},
                {"type": "text", "text": f"（{item['date'][:10]}）"},
            ]}]} for item in data["quick"]
        ]})

    # 核心课程
    has_core = data["core_sections"] or data["core_lessons"]
    if has_core:
        content.append({"type": "heading", "attrs": {"level": 3},
            "content": [{"type": "text", "text": "🎓 核心课程"}]})
        core_items = []

        for sec in data["core_sections"]:
            label = f"🆕 {sec['title']}（{sec['lesson_count']} 節課）"
            core_items.append({"type": "listItem", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": label,
                 "marks": [{"type": "link", "attrs": {"href": sec["url"], "target": "_blank"}}]},
                {"type": "text", "text": f"（{sec['date'][:10]}）"},
            ]}]})

        for item in data["core_lessons"]:
            space = item.get("space_name", "")
            title = f"{space}｜{item['title']}" if space else item["title"]
            core_items.append({"type": "listItem", "content": [{"type": "paragraph", "content": [
                {"type": "text", "text": title.strip(),
                 "marks": [{"type": "link", "attrs": {"href": item["url"], "target": "_blank"}}]},
                {"type": "text", "text": f"（{item['date'][:10]}）"},
            ]}]})

        content.append({"type": "bulletList", "content": core_items})

    # Footer
    all_empty = not any([data["mini"], data["quick_lesson"], data["quick"], has_core])

    if all_empty:
        content.append({"type": "paragraph",
            "content": [{"type": "text", "text": "本周暂无新课程更新，敬请期待下周内容！"}]})
    else:
        content.append({"type": "paragraph",
            "content": [{"type": "text", "text": "👉 以上是本周的新課程更新，快來觀看學習，不要錯過哦！"}]})

    content.append({"type": "paragraph", "content": []})
    content.append({"type": "paragraph", "content": [
        {"type": "text", "text": "📚 "},
        {"type": "text", "text": "查看社群全部課程目錄",
         "marks": [{"type": "link", "attrs": {"href": CATALOG_URL, "target": "_blank"}},
                   {"type": "bold"}]},
    ]})

    return content


def main():
    print("🚀 每周课程更新帖")
    print(f"📅 {datetime.now(timezone.utc).isoformat()}\n")

    token = os.environ.get("CIRCLE_V2_TOKEN")
    if not token:
        print("❌ Missing CIRCLE_V2_TOKEN environment variable")
        sys.exit(1)

    auto_publish = os.environ.get("AUTO_PUBLISH", "").lower() == "true"

    # Load and filter
    data = load_courses()
    since = datetime.now(timezone.utc) - timedelta(days=7)
    print(f"🔍 搜索范围: {since.strftime('%Y-%m-%d')} 至今")
    print(f"📊 courses.json 最后更新: {data['updated_at']}\n")

    result = filter_courses(data["courses"], since)

    # Stats
    total = sum(len(v) for v in result.values())
    print(f"📺 迷你公開課: {len(result['mini'])} 個")
    print(f"⚡ 即學即用: {len(result['quick_lesson'])} 個")
    print(f"🚀 快速課程: {len(result['quick'])} 個")
    print(f"🎓 核心课程 (新 Section): {len(result['core_sections'])} 個")
    print(f"🎓 核心课程 (新 Lesson): {len(result['core_lessons'])} 個")
    print(f"\n📚 总计: {total} 個课程更新\n")

    if total == 0:
        print("ℹ️ 本周无新课程更新，跳过发帖。")
        return

    # Build content
    content = build_tiptap_content(result)
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=6)).strftime("%Y-%m-%d")
    end = now.strftime("%Y-%m-%d")

    status = "published" if auto_publish else "draft"

    payload = {
        "space_id": SPACE_ID,
        "name": f"📢 本周课程更新（{start} ~ {end}）",
        "status": status,
        "tiptap_body": {"body": {"type": "doc", "content": content}},
        "topics": [TOPIC_ID],
        "is_comments_enabled": True,
        "is_liking_enabled": True,
        "skip_notifications": False,
    }

    print(f"📤 创建帖子（{status}）...")
    resp = api_request("POST", "/posts", token, payload)
    post = resp.get("post", resp)
    post_id = post.get("id")

    print(f"✅ 帖子创建成功！Post ID: {post_id}")
    print(f"📋 链接: https://member.pathunfold.com/c/2175667/posts/{post_id}")

    # Set output for GitHub Actions
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            f.write(f"post_id={post_id}\n")
            f.write(f"total_courses={total}\n")
            f.write(f"status={status}\n")


if __name__ == "__main__":
    main()
