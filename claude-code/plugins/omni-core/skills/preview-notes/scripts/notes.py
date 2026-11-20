#!/usr/bin/env python3
"""Keeps private/index.html, the project's accumulating visual reference.

Run from the project. The file is <git top level>/private/index.html (the
current folder outside git), or the one given with --file (before or after
the command); its backups and past editions sit next to it, in
.index-backup/ and history/.

  notes.py init [<slug> "<title>"]      create the skeleton if there is no file
  notes.py toc                          the current edition and its sections
  notes.py backup                       copy the file to .index-backup/ (newest 15 kept)
  notes.py template <id> "<title>"      print a contents line and a section to paste
  notes.py edition <slug> "<title>"     move the current edition to history/, start a new one
  notes.py history [<word>]             list past editions (those mentioning <word>)
  notes.py history --sync               rewrite the "지난 판" list from history/
  notes.py check [--allow-remove] [--against <file>]
                                        structure, unclosed tags, contents, links, outside
                                        resources, values that must not be there, changes
                                        since the last backup (or <file>)

Standard library only. Exit status 1 when check finds a problem.
"""
import argparse
import datetime
import hashlib
import html
import re
import shutil
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    KST = ZoneInfo("Asia/Seoul")
except Exception:  # no tz database: fixed +09:00
    KST = datetime.timezone(datetime.timedelta(hours=9))

SKILL_DIR = Path(__file__).resolve().parent.parent
SKELETON = SKILL_DIR / "assets" / "skeleton.html"
BACKUPS_KEPT = 15
STATUS = {"current": ("현재", "ok"), "stale": ("낡음", "warn"), "removed": ("지움", "bad")}
TOC = ("<!-- toc:start -->", "<!-- toc:end -->")
SECTIONS = ("<!-- sections:start -->", "<!-- sections:end -->")
HISTORY = ("<!-- history:start -->", "<!-- history:end -->")
SLUG = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")


def git_root() -> Path:
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
        return Path(top)
    except Exception:
        return Path.cwd()


# The project (its commit is the "기준"); the file and the folders next to it
# are set from --file in main().
ROOT = git_root()
INDEX = ROOT / "private" / "index.html"
BACKUP_DIR = INDEX.parent / ".index-backup"
HISTORY_DIR = INDEX.parent / "history"


def use_file(path) -> None:
    global INDEX, BACKUP_DIR, HISTORY_DIR
    INDEX = Path(path).expanduser().resolve() if path else ROOT / "private" / "index.html"
    BACKUP_DIR = INDEX.parent / ".index-backup"
    HISTORY_DIR = INDEX.parent / "history"


def shown(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def now() -> datetime.datetime:
    return datetime.datetime.now(KST)


def stamp() -> str:
    return now().strftime("%Y%m%d-%H%M%S")


def today() -> str:
    return now().strftime("%Y-%m-%d")


def basis() -> tuple[str, bool]:
    """The project's current commit (short) and whether there are uncommitted changes."""
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip())
        return sha, dirty
    except Exception:
        return "none", False


def read(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace")


def between(text: str, marks: tuple[str, str]):
    a, b = text.find(marks[0]), text.find(marks[1])
    if a == -1 or b == -1 or b < a:
        return None
    return text[a + len(marks[0]):b]


def replace_between(text: str, marks: tuple[str, str], inner: str) -> str:
    a, b = text.find(marks[0]), text.find(marks[1])
    return text[:a + len(marks[0])] + inner + text[b:]


def strip(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def edition_of(text: str) -> tuple[str, str]:
    """(slug, title). An old file without the edition mark: its <h1> or <title>."""
    m = re.search(r'<meta name="edition" content="([^"]*)"', text)
    t = re.search(r"<h1[^>]*>(.*?)</h1>", text, re.S) or re.search(r"<title[^>]*>(.*?)</title>", text, re.S)
    return (m.group(1) if m else ""), (strip(t.group(1)) if t else "")


def section_hash(block: str) -> str:
    # Whitespace does not count: re-indenting a section is not a change.
    return hashlib.sha1(re.sub(r"\s+", " ", block).strip().encode()).hexdigest()


def sections_of(text: str) -> list[dict]:
    """Top-level sections between the section markers (the whole file for an old one), in order."""
    inner = between(text, SECTIONS)
    if inner is None:
        inner = text
    out = []
    for m in re.finditer(r"<section\b([^>]*)>(.*?)</section>", inner, re.S):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        body = m.group(2)
        h2 = re.search(r"<h2[^>]*>(.*?)</h2>", body, re.S)
        out.append({
            "id": attrs.get("id", ""), "attrs": attrs, "body": body,
            "title": strip(h2.group(1)) if h2 else "", "hash": section_hash(m.group(0)),
        })
    return out


def toc_of(text: str) -> list[dict]:
    inner = between(text, TOC)
    if inner is None:
        return []
    out = []
    for m in re.finditer(r'<li\b[^>]*data-id="([^"]*)"[^>]*>(.*?)</li>', inner, re.S):
        pill = re.search(r'class="pill (\w+)"', m.group(2))
        out.append({"id": m.group(1), "pill": pill.group(1) if pill else ""})
    return out


class Balance(HTMLParser):
    """Block tags opened and closed in order; what is left open or closed twice."""
    TAGS = {"section", "div", "table", "pre", "ul", "ol", "nav", "main", "header", "details", "svg"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.errors = [], []

    def handle_starttag(self, tag, attrs):
        if tag in self.TAGS:
            self.stack.append((tag, self.getpos()[0]))

    def handle_endtag(self, tag):
        if tag not in self.TAGS:
            return
        line = self.getpos()[0]
        if not any(t == tag for t, _ in self.stack):
            self.errors.append(f"{line}줄: 열지 않은 </{tag}>")
            return
        while self.stack:
            t, at = self.stack.pop()
            if t == tag:
                break
            self.errors.append(f"{at}줄: <{t}> 가 닫히지 않은 채 {line}줄 </{tag}>")

    def result(self) -> list[str]:
        return self.errors + [f"{at}줄: <{t}> 가 닫히지 않음" for t, at in self.stack]


def unbalanced(text: str) -> list[str]:
    b = Balance()
    b.feed(text)
    b.close()
    return b.result()


def newest_first(p: Path):
    # By the time written (two in one second get "-2": the name alone would sort them wrong).
    return (-p.stat().st_mtime_ns, p.name)


def history_files() -> list[Path]:
    if not HISTORY_DIR.is_dir():
        return []
    return sorted(HISTORY_DIR.glob("*.html"), key=newest_first)


def when_of(p: Path) -> str:
    m = re.match(r"(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})", p.name)
    return f"{m[1]}-{m[2]}-{m[3]} {m[4]}:{m[5]}" if m else ""


def history_list_html() -> str:
    items = []
    for p in history_files():
        text = read(p)
        _, title = edition_of(text)
        names = [s["title"] or s["id"] for s in sections_of(text)]
        more = f" 외 {len(names) - 5}개" if len(names) > 5 else ""
        secs = f' <span class="meta">— {html.escape(" · ".join(names[:5]))}{more}</span>' if names else ""
        items.append(f'\n      <li><a href="history/{html.escape(p.name)}">{html.escape(title or p.stem)}</a> <span class="when">{when_of(p)}</span>{secs}</li>')
    if not items:
        return '\n      <li class="none">아직 없음</li>\n    '
    return "".join(items) + "\n    "


def skeleton(slug: str, title: str) -> str:
    out = SKELETON.read_text(encoding="utf-8")
    for k, v in (("__SLUG__", html.escape(slug)), ("__TITLE__", html.escape(title)),
                 ("__DATE__", today()), ("__HISTORY__", history_list_html())):
        out = out.replace(k, v)
    return out


def write_index(text: str) -> None:
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(text, encoding="utf-8")


def unique(path: Path) -> Path:
    n = 2
    out = path
    while out.exists():
        out = path.with_name(f"{path.stem}-{n}{path.suffix}")
        n += 1
    return out


def do_backup(quiet=False) -> Path | None:
    if not INDEX.exists():
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    dest = unique(BACKUP_DIR / f"{stamp()}.html")
    shutil.copyfile(INDEX, dest)  # its own time: backups are ordered by it
    for old in sorted(BACKUP_DIR.glob("*.html"), key=newest_first)[BACKUPS_KEPT:]:
        old.unlink()
    if not quiet:
        print(f"백업: {shown(dest)}")
    return dest


def no_file() -> int:
    print(f"{shown(INDEX)} 없음 — init 으로 만드세요")
    return 1


def cmd_init(a):
    if INDEX.exists():
        print(f"이미 있음: {shown(INDEX)} (toc 로 보세요)")
        return 0
    slug, title = a.slug or "start", a.title or "작업 참고 그림"
    if not SLUG.fullmatch(slug):
        print("판 slug 는 영문 소문자-하이픈", file=sys.stderr)
        return 2
    write_index(skeleton(slug, title))
    print(f"만듦: {shown(INDEX)} (판 {slug})")
    return 0


def cmd_toc(_a):
    if not INDEX.exists():
        return no_file()
    text = read(INDEX)
    slug, title = edition_of(text)
    size = f"{INDEX.stat().st_size / 1024:.1f}KB"
    if between(text, TOC) is None or between(text, SECTIONS) is None:
        print(f"옛 꼴(목차·절 표시 없음) · {title or '(제목 없음)'} · {size} — edition 으로 history/ 에 옮기고 새 판을 여세요")
        return 0
    secs = sections_of(text)
    counts = " · ".join(f"{label} {n}" for k, (label, _) in STATUS.items()
                        if (n := sum(s["attrs"].get("data-status") == k for s in secs)))
    print(f"지금 판: {title or '(제목 없음)'} [{slug or '-'}] · 절 {len(secs)}개{' (' + counts + ')' if counts else ''} · {size}")
    for s in secs:
        a = s["attrs"]
        print(f"  #{s['id']}  {s['title']}  · {STATUS.get(a.get('data-status', ''), ('?', ''))[0]} · 고침 {a.get('data-updated', '?')} · 기준 {a.get('data-basis', '?')}")
    if not secs:
        print("  (절 없음)")
    hist = history_files()
    print(f"지난 판 {len(hist)}개" + (f" — 최근: {hist[0].name}" if hist else ""))
    return 0


def cmd_backup(_a):
    return 0 if do_backup() else no_file()


def cmd_template(a):
    if not SLUG.fullmatch(a.id):
        print('사용: template <id: 영문 소문자-하이픈> "<제목>"', file=sys.stderr)
        return 2
    sid, title = a.id, html.escape(a.title)
    sha, dirty = basis()
    d = today()
    more = "(+ 커밋 안 한 변경 있음)" if dirty else ""
    print("== 목차 한 줄 (<!-- toc:start --> 바로 아래, 맨 위에) ==")
    print(f'<li data-id="{sid}"><a href="#{sid}">{title}</a> <span class="pill ok">현재</span> <span class="when">{d}</span></li>')
    print("\n== 절 (<!-- sections:start --> 바로 아래, 맨 위에) ==")
    print(f"""<section id="{sid}" data-updated="{d}" data-basis="{sha}" data-status="current">
  <h2>{title}</h2>
  <p class="meta">고침 {d} · 기준 커밋 {sha}{more} · 상태 현재</p>
  <p class="verdict">한 줄 요약 — 이 그림이 답하는 질문과 그 답</p>
  <div class="block">
    <!-- 그림: .lane / .flow / .branch / .two / table / pre / 인라인 SVG -->
  </div>
  <h3>근거</h3>
  <ul class="files"><li><span class="mono">경로:줄</span> — 무엇의 근거인지</li></ul>
</section>""")
    return 0


def cmd_edition(a):
    if not SLUG.fullmatch(a.slug):
        print('사용: edition <판 slug: 영문 소문자-하이픈> "<판 제목>"', file=sys.stderr)
        return 2
    if INDEX.exists():
        do_backup()
        old = read(INDEX)
        old_slug, _ = edition_of(old)
        if between(old, TOC) is None:
            old_slug = old_slug or "legacy"
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        dest = unique(HISTORY_DIR / f"{stamp()}-{old_slug or 'edition'}.html")
        shutil.move(str(INDEX), dest)
        # The past edition's own "지난 판" links point to history/…; from inside history/ they are siblings.
        dest.write_text(re.sub(r'href="history/', 'href="', read(dest)), encoding="utf-8")
        print(f"지난 판으로 옮김: {shown(dest)}")
    write_index(skeleton(a.slug, a.title))
    print(f"새 판: {a.title} [{a.slug}] — template 으로 첫 절을 넣으세요")
    return 0


def cmd_history(a):
    if a.word == "--sync" or a.sync:
        if not INDEX.exists():
            return no_file()
        text = read(INDEX)
        if between(text, HISTORY) is None:
            print("지금 판에 「지난 판」 목록 표시가 없습니다 — 뼈대(assets/skeleton.html)의 <details class=\"toc history\"> 부분을 목차 아래에 넣은 뒤 다시 하세요")
            return 1
        write_index(replace_between(text, HISTORY, history_list_html()))
        print(f"「지난 판」 목록을 history/ 와 맞춤 ({len(history_files())}개)")
        return 0
    word = a.word.lower() if a.word else None
    found = 0
    for p in history_files():
        text = read(p)
        secs = sections_of(text)
        if word:
            hits = [s for s in secs if word in strip(s["body"]).lower() or word in s["title"].lower() or word in s["id"]]
            if not hits and word not in strip(text).lower():
                continue
        else:
            hits = secs
        found += 1
        _, title = edition_of(text)
        print(f"{shown(p)} — {title or p.stem} ({when_of(p) or '?'})")
        for s in hits:
            print(f"    #{s['id']}  {s['title']}  (기준 {s['attrs'].get('data-basis', '?')})")
    if not found:
        print("지난 판 없음" if not word else f"「{a.word}」이 나오는 지난 판 없음")
    return 0


def mixed_key(v: str) -> bool:
    # A long run of letters and digits that looks generated: upper and lower case and at least 4 digits.
    return sum(c.isdigit() for c in v) >= 4 and any(c.isupper() for c in v) and any(c.islower() for c in v)


SENSITIVE = [
    ("이메일", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), None),
    ("전화번호", re.compile(r"\b01[016789]-?\d{3,4}-?\d{4}\b"), None),
    ("API 키·토큰", re.compile(r"\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})"), None),
    ("Bearer 토큰", re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*", re.I), None),
    ("긴 16진수(키?)", re.compile(r"\b[0-9a-fA-F]{32,}\b"), lambda v: len(v) != 40),  # 40: a git commit id
    ("키 같은 문자열", re.compile(r"(?<![\w/+=-])[A-Za-z0-9+/_-]{32,}={0,2}(?![\w/+=-])"), mixed_key),
    ("긴 숫자(계좌·식별자?)", re.compile(r"\b\d{3,6}-\d{2,6}-\d{4,8}\b|\b\d{12,}\b"), None),
    ("접속 정보", re.compile(r"(password|passwd|secret|token)\s*[:=]\s*\S+", re.I), None),
]
PLACEHOLDER_MAIL = re.compile(r"@(example\.(com|org|net)|sample\.\w+)$", re.I)


def compare(prev_text: str, label: str, text: str, slug: str, secs: list[dict], allow_remove: bool, problems: list[str]) -> None:
    """Sections added, changed and gone since `prev_text`; on an edition change, whether the
    previous edition's sections are in history/ unchanged."""
    prev_slug, _ = edition_of(prev_text)
    prev = sections_of(prev_text)
    before = {s["id"]: s["hash"] for s in prev}
    now_ = {s["id"]: s["hash"] for s in secs}
    added = [i for i in now_ if i not in before]
    changed = [i for i in now_ if i in before and before[i] != now_[i]]
    removed = [i for i in before if i not in now_]
    print(f"{label} 대비 — 더한 절: {', '.join(added) or '없음'} / 고친 절: {', '.join(changed) or '없음'} / 없어진 절: {', '.join(removed) or '없음'}")
    if prev_slug != slug:  # an old file without the mark counts as another edition
        kept = {}  # hash -> past edition file
        ids = set()
        for p in history_files():
            for s in sections_of(read(p)):
                kept.setdefault(s["hash"], p.name)
                ids.add(s["id"])
        moved = [s["id"] for s in prev if s["hash"] in kept]
        stayed = [s["id"] for s in prev if s["hash"] not in kept and s["id"] in now_]
        lost = [s["id"] for s in prev if s["hash"] not in kept and s["id"] not in now_]
        print(f"판이 바뀜({prev_slug} → {slug}): history/ 에 그대로 {len(moved)}개 · 이번 판에 남음 {len(stayed)}개 · 잃음 {len(lost)}개")
        if lost and not allow_remove:
            changed_ = [i for i in lost if i in ids]
            gone = [i for i in lost if i not in ids]
            if gone:
                problems.append(f"판을 바꿨는데 지난 판 절이 history/ 에도 이번 판에도 없음: {', '.join(gone)}")
            if changed_:
                problems.append(f"판을 바꿨는데 history/ 의 절이 지난 판과 내용이 다름: {', '.join(changed_)}")
    elif removed and not allow_remove:
        problems.append(f"같은 판에서 절이 없어짐: {', '.join(removed)} — 의도했다면 사용자에게 물은 뒤 check --allow-remove (지운 기능이면 data-status=\"removed\" 로 남기기)")


def cmd_check(a):
    if not INDEX.exists():
        return no_file()
    text = read(INDEX)
    problems, notes = [], []
    for marks, what in ((TOC, "목차"), (SECTIONS, "절"), (HISTORY, "지난 판 목록")):
        if between(text, marks) is None:
            (notes if marks is HISTORY else problems).append(f"{what} 표시({marks[0]} … {marks[1]})가 없음")
    problems += [f"태그 짝: {e}" for e in unbalanced(text)]
    slug, title = edition_of(text)
    if not re.search(r'<meta name="edition" content="[^"]+"', text):
        problems.append('판 표시(<meta name="edition" …>)가 없음')
    secs = sections_of(text)
    toc = toc_of(text)
    ids = [s["id"] for s in secs]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        problems.append(f"같은 id 의 절이 둘 이상: #{dup}")
    inner = between(text, SECTIONS) or ""
    if inner.count("<section") != len(secs) or any("<section" in s["body"] for s in secs):
        problems.append("절 안에 절이 있거나 닫히지 않은 절이 있음 (묶음은 <div class=\"block\">)")
    for s in secs:
        at, sid = s["attrs"], s["id"]
        if not SLUG.fullmatch(sid or ""):
            problems.append(f"절 id 꼴이 아님(영문 소문자-하이픈): '{sid}'")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", at.get("data-updated", "")):
            problems.append(f"#{sid}: data-updated 가 YYYY-MM-DD 가 아님")
        if not at.get("data-basis"):
            problems.append(f"#{sid}: data-basis(기준 커밋)가 없음")
        if at.get("data-status") not in STATUS:
            problems.append(f"#{sid}: data-status 는 current / stale / removed 중 하나")
        if not s["title"]:
            problems.append(f"#{sid}: <h2> 제목이 없음")
        if 'class="verdict"' not in s["body"]:
            notes.append(f"#{sid}: 한 줄 요약(.verdict)이 없음")
        if "근거" not in s["body"]:
            notes.append(f"#{sid}: 「근거」 목록이 없음")
    toc_ids = [t["id"] for t in toc]
    for i in sorted(set(ids) - set(toc_ids)):
        problems.append(f"목차에 없는 절: #{i}")
    for i in sorted(set(toc_ids) - set(ids)):
        problems.append(f"절이 없는 목차 줄: #{i}")
    if [i for i in toc_ids if i in ids] != [i for i in ids if i in toc_ids]:
        notes.append("목차 순서가 절 순서와 다름 (최근 것이 위)")
    for t in toc:
        s = next((x for x in secs if x["id"] == t["id"]), None)
        if s and STATUS.get(s["attrs"].get("data-status", ""), ("", ""))[1] != t["pill"]:
            notes.append(f"#{t['id']}: 목차 딱지가 절 상태와 다름 (현재=ok, 낡음=warn, 지움=bad)")
    hist_inner = between(text, HISTORY)
    if hist_inner is not None:
        linked = re.findall(r'href="history/([^"]+)"', hist_inner)
        for name in linked:
            if not (HISTORY_DIR / name).exists():
                problems.append(f"지난 판 링크가 가리키는 파일이 없음: history/{name}")
        missing = [p.name for p in history_files() if p.name not in linked]
        if missing:
            notes.append(f"「지난 판」 목록에 없는 history/ 파일 {len(missing)}개 — history --sync")
    for m in re.finditer(r'(?:\bsrc\s*=\s*["\']\s*(?:https?:)?//|<link\b[^>]*href\s*=\s*["\']\s*(?:https?:)?//|url\(\s*["\']?\s*(?:https?:)?//|@import\s+["\']?(?:url\()?\s*["\']?(?:https?:)?//)', text, re.I):
        line = text.count("\n", 0, m.start()) + 1
        problems.append(f"바깥 자원을 불러옴 ({line}줄) — 미리보기는 네트워크 없이 그려져야 함")
    plain = strip(text)
    seen = set()
    for label, rx, keep in SENSITIVE:
        for m in rx.finditer(plain):
            v = m.group(0)
            if (label == "이메일" and PLACEHOLDER_MAIL.search(v)) or (keep and not keep(v)) or v in seen:
                continue
            seen.add(v)
            notes.append(f"넣으면 안 되는 값 꼴? [{label}] {v[:40]} — 지어낸·공개된 값인지 확인")
    if a.against:
        other = Path(a.against).expanduser()
        if not other.is_file():
            problems.append(f"--against 파일이 없음: {a.against}")
        else:
            compare(read(other), other.name, text, slug, secs, a.allow_remove, problems)
    else:
        last = sorted(BACKUP_DIR.glob("*.html"), key=newest_first)[:1] if BACKUP_DIR.is_dir() else []
        if last:
            compare(read(last[0]), f"마지막 백업({last[0].name})", text, slug, secs, a.allow_remove, problems)
        else:
            print("백업 없음 — 고치기 전에 backup 을 먼저")
    for n in notes:
        print(f"  확인: {n}")
    for p in problems:
        print(f"  문제: {p}")
    print(f"문제 {len(problems)}개, 확인할 것 {len(notes)}개 · 절 {len(secs)}개 · 판 {title or '-'} [{slug or '-'}]")
    return 1 if problems else 0


def parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    # SUPPRESS: given after the command it does not overwrite one given before.
    common.add_argument("--file", default=argparse.SUPPRESS, help="private/index.html 대신 쓸 파일")
    ap = argparse.ArgumentParser(prog="notes.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, parents=[common])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init", parents=[common]); p.add_argument("slug", nargs="?"); p.add_argument("title", nargs="?"); p.set_defaults(fn=cmd_init)
    sub.add_parser("toc", parents=[common]).set_defaults(fn=cmd_toc)
    sub.add_parser("backup", parents=[common]).set_defaults(fn=cmd_backup)
    p = sub.add_parser("template", parents=[common]); p.add_argument("id"); p.add_argument("title"); p.set_defaults(fn=cmd_template)
    p = sub.add_parser("edition", parents=[common]); p.add_argument("slug"); p.add_argument("title"); p.set_defaults(fn=cmd_edition)
    p = sub.add_parser("history", parents=[common]); p.add_argument("word", nargs="?"); p.add_argument("--sync", action="store_true"); p.set_defaults(fn=cmd_history)
    p = sub.add_parser("check", parents=[common]); p.add_argument("--allow-remove", action="store_true"); p.add_argument("--against"); p.set_defaults(fn=cmd_check)
    return ap


def main(argv) -> int:
    a = parser().parse_args(argv)
    use_file(getattr(a, "file", None))
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
