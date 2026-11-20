#!/usr/bin/env python3
"""Keeps private/index.html, the project's accumulating visual reference.

Run from the project (the root is the git top level, else the current folder):

  notes.py init [<slug> "<title>"]      create the skeleton if there is no file
  notes.py toc                          the current edition and its sections
  notes.py backup                       copy the file to private/.index-backup/ (newest 15 kept)
  notes.py template <id> "<title>"      print a contents line and a section to paste
  notes.py edition <slug> "<title>"     move the current edition to private/history/, start a new one
  notes.py history [<word>]             list past editions (those mentioning <word>)
  notes.py history --sync               rewrite the "지난 판" list from private/history/
  notes.py check [--allow-remove]       structure, contents, links, outside resources,
                                        values that must not be there, changes since the last backup

Standard library only. Exit status 1 when check finds a problem.
"""
import datetime
import hashlib
import html
import re
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    KST = ZoneInfo("Asia/Seoul")
except Exception:  # no tz database: fixed +09:00
    KST = datetime.timezone(datetime.timedelta(hours=9))

BACKUPS_KEPT = 15
STATUS = {"current": ("현재", "ok"), "stale": ("낡음", "warn"), "removed": ("지움", "bad")}
TOC = ("<!-- toc:start -->", "<!-- toc:end -->")
SECTIONS = ("<!-- sections:start -->", "<!-- sections:end -->")
HISTORY = ("<!-- history:start -->", "<!-- history:end -->")


def root() -> Path:
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True).stdout.strip()
        return Path(top)
    except Exception:
        return Path.cwd()


ROOT = root()
PRIVATE = ROOT / "private"
INDEX = PRIVATE / "index.html"
BACKUP_DIR = PRIVATE / ".index-backup"
HISTORY_DIR = PRIVATE / "history"


def now() -> datetime.datetime:
    return datetime.datetime.now(KST)


def stamp() -> str:
    return now().strftime("%Y%m%d-%H%M%S")


def today() -> str:
    return now().strftime("%Y-%m-%d")


def basis() -> tuple[str, bool]:
    """The current commit (short) and whether there are uncommitted changes."""
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip())
        return sha, dirty
    except Exception:
        return "none", False


def between(text: str, marks: tuple[str, str]):
    a, b = text.find(marks[0]), text.find(marks[1])
    if a == -1 or b == -1 or b < a:
        return None
    return text[a + len(marks[0]):b]


def replace_between(text: str, marks: tuple[str, str], inner: str) -> str:
    a, b = text.find(marks[0]), text.find(marks[1])
    return text[:a + len(marks[0])] + inner + text[b:]


def edition_of(text: str) -> tuple[str, str]:
    m = re.search(r'<meta name="edition" content="([^"]*)"', text)
    t = re.search(r"<h1[^>]*>(.*?)</h1>", text, re.S)
    return (m.group(1) if m else ""), (strip(t.group(1)) if t else "")


def strip(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def sections_of(text: str) -> list[dict]:
    """Top-level sections between the section markers, in order."""
    inner = between(text, SECTIONS)
    if inner is None:
        return []
    out = []
    for m in re.finditer(r"<section\b([^>]*)>(.*?)</section>", inner, re.S):
        attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        body = m.group(2)
        h2 = re.search(r"<h2[^>]*>(.*?)</h2>", body, re.S)
        out.append({
            "id": attrs.get("id", ""), "attrs": attrs, "body": body,
            "title": strip(h2.group(1)) if h2 else "",
            "hash": hashlib.sha1(m.group(0).encode()).hexdigest(),
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


def newest_first(p: Path):
    # By the time written (two in one second get "-2": the name alone would sort them wrong).
    return (-p.stat().st_mtime_ns, p.name)


def history_files() -> list[Path]:
    if not HISTORY_DIR.is_dir():
        return []
    return sorted(HISTORY_DIR.glob("*.html"), key=newest_first)


def history_title(p: Path) -> str:
    _, title = edition_of(p.read_text(encoding="utf-8", errors="replace"))
    return title or p.stem


def history_list_html() -> str:
    items = [f'\n      <li><a href="history/{html.escape(p.name)}">{html.escape(history_title(p))}</a> <span class="when">{p.name[:8]}</span></li>' for p in history_files()]
    if not items:
        return '\n      <li class="none">아직 없음</li>\n    '
    return "".join(items) + "\n    "


SKELETON = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="edition" content="{slug}">
<title>{title}</title>
<style>
  :root {{ --bg:#0f1117; --card:#171a23; --line:#2a2f3d; --text:#e2e5ec; --muted:#8a91a3; --accent:#d97757;
          --ok:#4fc08d; --warn:#e6b450; --bad:#f0616d; --ext:#6ea8fe; }}
  html, body {{ margin:0; min-height:100vh; background:var(--bg); color:var(--text); font:14px/1.6 system-ui, sans-serif; }}
  main {{ max-width:1100px; margin:0 auto; padding:24px; }}
  h1 {{ font-size:20px; margin:0 0 4px; }} h2 {{ font-size:17px; margin:0 0 4px; }} h3 {{ font-size:14px; margin:16px 0 6px; color:var(--muted); }}
  a {{ color:var(--ext); }}
  .sub, .meta, .when {{ color:var(--muted); font-size:12px; }}
  .toc {{ background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 16px; margin:12px 0; }}
  .toc ol, .toc ul {{ margin:6px 0; padding-left:20px; }} .toc li.none {{ color:var(--muted); list-style:none; margin-left:-20px; }}
  .toc.history summary {{ cursor:pointer; color:var(--muted); }}
  section {{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:16px 0; }}
  section[data-status="stale"] {{ border-color:var(--warn); }} section[data-status="removed"] {{ opacity:.7; border-style:dashed; }}
  .verdict {{ border-left:3px solid var(--accent); background:#1d212c; padding:8px 12px; border-radius:6px; margin:8px 0 12px; }}
  .block {{ margin:12px 0; }}
  .pill {{ display:inline-block; font-size:11px; padding:0 8px; border-radius:999px; border:1px solid currentColor; }}
  .ok {{ color:var(--ok); }} .warn {{ color:var(--warn); }} .bad {{ color:var(--bad); }} .ext {{ color:var(--ext); }}
  .mono, pre {{ font-family:ui-monospace, "Cascadia Code", Consolas, monospace; font-size:12.5px; }}
  pre {{ background:#11141b; border:1px solid var(--line); border-radius:8px; padding:10px 12px; overflow:auto; }}
  table {{ border-collapse:collapse; width:100%; font-size:13px; }} th, td {{ border:1px solid var(--line); padding:6px 8px; text-align:left; vertical-align:top; }} th {{ color:var(--muted); font-weight:600; }}
  /* .lane: <div class="lane"><div class="step"><span class="who">화면</span><div>무엇을</div></div>…</div> */
  .lane .step {{ display:grid; grid-template-columns:6.5em 1fr; gap:10px; }}
  .lane .who {{ text-align:right; color:var(--muted); font-size:12px; padding-top:6px; }}
  .lane .step > div {{ border-left:2px solid var(--line); padding:6px 0 6px 12px; }}
  /* .flow: <div class="flow"><span>화면</span><span>API</span>…</div> */
  .flow {{ display:flex; flex-wrap:wrap; align-items:center; gap:6px; }}
  .flow > * {{ background:#1d212c; border:1px solid var(--line); border-radius:8px; padding:4px 10px; }}
  .flow > *:not(:last-child)::after {{ content:"→"; margin-left:10px; color:var(--muted); }}
  .branch, .two {{ display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; }}
  .branch > div, .two > div {{ background:#1d212c; border:1px solid var(--line); border-radius:8px; padding:10px 12px; }}
  .branch .if {{ font-size:12px; color:var(--warn); margin-bottom:4px; }}
  .files {{ margin:0; padding-left:18px; }}
  svg {{ max-width:100%; height:auto; }}
</style>
</head>
<body>
<main>
  <h1>{title}</h1>
  <p class="sub">작업 참고 그림 · 판 시작 {date} · 최근 것이 위</p>
  <nav class="toc" aria-label="목차">
    <ol>
    {toc_start}
    {toc_end}
    </ol>
  </nav>
  <details class="toc history">
    <summary>지난 판</summary>
    <ul>{history_start}{history}{history_end}</ul>
  </details>
  {sections_start}
  {sections_end}
</main>
</body>
</html>
"""


def skeleton(slug: str, title: str) -> str:
    return SKELETON.format(
        slug=html.escape(slug), title=html.escape(title), date=today(),
        toc_start=TOC[0], toc_end=TOC[1], sections_start=SECTIONS[0], sections_end=SECTIONS[1],
        history_start=HISTORY[0], history_end=HISTORY[1], history=history_list_html(),
    )


def write_index(text: str) -> None:
    PRIVATE.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(text, encoding="utf-8")


def do_backup(quiet=False) -> Path | None:
    if not INDEX.exists():
        return None
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    dest = BACKUP_DIR / f"{stamp()}.html"
    n = 2
    while dest.exists():
        dest = BACKUP_DIR / f"{stamp()}-{n}.html"
        n += 1
    shutil.copyfile(INDEX, dest)  # its own time: backups are ordered by it
    for old in sorted(BACKUP_DIR.glob("*.html"), key=newest_first)[BACKUPS_KEPT:]:
        old.unlink()
    if not quiet:
        print(f"백업: {dest.relative_to(ROOT)}")
    return dest


def cmd_init(args):
    if INDEX.exists():
        print(f"이미 있음: {INDEX.relative_to(ROOT)} (toc 로 보세요)")
        return 0
    slug = args[0] if args else "start"
    title = args[1] if len(args) > 1 else "작업 참고 그림"
    write_index(skeleton(slug, title))
    print(f"만듦: {INDEX.relative_to(ROOT)} (판 {slug})")
    return 0


def cmd_toc(_args):
    if not INDEX.exists():
        print("private/index.html 없음 — init 으로 만드세요")
        return 0
    text = INDEX.read_text(encoding="utf-8")
    slug, title = edition_of(text)
    if between(text, TOC) is None or between(text, SECTIONS) is None:
        print("옛 꼴(목차·절 표시 없음) — edition 으로 history/ 에 옮기고 새 판을 여세요")
        return 0
    print(f"지금 판: {title or '(제목 없음)'} [{slug or '-'}]")
    secs = sections_of(text)
    for s in secs:
        a = s["attrs"]
        print(f"  #{s['id']}  {s['title']}  · {STATUS.get(a.get('data-status', ''), ('?', ''))[0]} · 고침 {a.get('data-updated', '?')} · 기준 {a.get('data-basis', '?')}")
    if not secs:
        print("  (절 없음)")
    hist = history_files()
    print(f"지난 판 {len(hist)}개" + (f" — 최근: {hist[0].name}" if hist else ""))
    return 0


def cmd_backup(_args):
    if not do_backup():
        print("private/index.html 없음")
    return 0


def cmd_template(args):
    if len(args) < 2 or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", args[0]):
        print('사용: template <id: 영문 소문자-하이픈> "<제목>"', file=sys.stderr)
        return 2
    sid, title = args[0], html.escape(args[1])
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


def unique(path: Path) -> Path:
    n = 2
    out = path
    while out.exists():
        out = path.with_name(f"{path.stem}-{n}{path.suffix}")
        n += 1
    return out


def cmd_edition(args):
    if len(args) < 2 or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", args[0]):
        print('사용: edition <판 slug: 영문 소문자-하이픈> "<판 제목>"', file=sys.stderr)
        return 2
    slug, title = args[0], args[1]
    if INDEX.exists():
        do_backup()
        old = INDEX.read_text(encoding="utf-8")
        old_slug, _ = edition_of(old)
        if between(old, TOC) is None:
            old_slug = old_slug or "legacy"
        HISTORY_DIR.mkdir(parents=True, exist_ok=True)
        dest = unique(HISTORY_DIR / f"{stamp()}-{old_slug or 'edition'}.html")
        shutil.move(str(INDEX), dest)
        # The past edition's own "지난 판" links point to history/…; from inside history/ they are siblings.
        moved = dest.read_text(encoding="utf-8")
        moved = re.sub(r'href="history/', 'href="', moved)
        dest.write_text(moved, encoding="utf-8")
        print(f"지난 판으로 옮김: {dest.relative_to(ROOT)}")
    write_index(skeleton(slug, title))
    print(f"새 판: {title} [{slug}] — template 으로 첫 절을 넣으세요")
    return 0


def cmd_history(args):
    if args and args[0] == "--sync":
        if not INDEX.exists():
            print("private/index.html 없음")
            return 1
        text = INDEX.read_text(encoding="utf-8")
        if between(text, HISTORY) is None:
            print("지금 판에 「지난 판」 목록 표시가 없습니다 — 뼈대의 <details class=\"toc history\"> 부분을 목차 아래에 넣은 뒤 다시 하세요")
            return 1
        write_index(replace_between(text, HISTORY, history_list_html()))
        print(f"「지난 판」 목록을 history/ 와 맞춤 ({len(history_files())}개)")
        return 0
    word = args[0].lower() if args else None
    found = 0
    for p in history_files():
        text = p.read_text(encoding="utf-8", errors="replace")
        secs = sections_of(text)
        if word:
            hits = [s for s in secs if word in strip(s["body"]).lower() or word in s["title"].lower() or word in s["id"]]
            if not hits and word not in strip(text).lower():
                continue
        else:
            hits = secs
        found += 1
        print(f"{p.relative_to(ROOT)} — {history_title(p)}")
        for s in hits:
            print(f"    #{s['id']}  {s['title']}  (기준 {s['attrs'].get('data-basis', '?')})")
    if not found:
        print("지난 판 없음" if not word else f"「{args[0]}」이 나오는 지난 판 없음")
    return 0


SENSITIVE = [
    ("이메일", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("전화번호", re.compile(r"\b01[016789]-?\d{3,4}-?\d{4}\b")),
    ("API 키·토큰", re.compile(r"\b(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})")),
    ("긴 숫자(계좌·식별자?)", re.compile(r"\b\d{3,6}-\d{2,6}-\d{4,8}\b|\b\d{12,}\b")),
    ("접속 정보", re.compile(r"(password|passwd|secret|token)\s*[:=]\s*\S+", re.I)),
]
PLACEHOLDER_MAIL = re.compile(r"@(example\.(com|org|net)|sample\.\w+)$", re.I)


def cmd_check(args):
    allow_remove = "--allow-remove" in args
    if not INDEX.exists():
        print("private/index.html 없음 — init 으로 만드세요")
        return 1
    text = INDEX.read_text(encoding="utf-8")
    problems, notes = [], []
    for marks, what in ((TOC, "목차"), (SECTIONS, "절"), (HISTORY, "지난 판 목록")):
        if between(text, marks) is None:
            (notes if marks is HISTORY else problems).append(f"{what} 표시({marks[0]} … {marks[1]})가 없음")
    slug, title = edition_of(text)
    if not slug:
        problems.append('판 표시(<meta name="edition" …>)가 없음')
    secs = sections_of(text)
    toc = toc_of(text)
    ids = [s["id"] for s in secs]
    for dup in {i for i in ids if ids.count(i) > 1}:
        problems.append(f"같은 id 의 절이 둘 이상: #{dup}")
    inner = between(text, SECTIONS) or ""
    if inner.count("<section") != len(secs) or any("<section" in s["body"] for s in secs):
        problems.append("절 안에 절이 있거나 닫히지 않은 절이 있음 (묶음은 <div class=\"block\">)")
    for s in secs:
        a, sid = s["attrs"], s["id"]
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", sid or ""):
            problems.append(f"절 id 꼴이 아님(영문 소문자-하이픈): '{sid}'")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.get("data-updated", "")):
            problems.append(f"#{sid}: data-updated 가 YYYY-MM-DD 가 아님")
        if not a.get("data-basis"):
            problems.append(f"#{sid}: data-basis(기준 커밋)가 없음")
        if a.get("data-status") not in STATUS:
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
    for label, rx in SENSITIVE:
        for m in rx.finditer(plain):
            v = m.group(0)
            if label == "이메일" and PLACEHOLDER_MAIL.search(v):
                continue
            notes.append(f"넣으면 안 되는 값 꼴? [{label}] {v[:40]} — 지어낸·공개된 값인지 확인")
    # Changes since the last backup.
    last = sorted(BACKUP_DIR.glob("*.html"), key=newest_first)[:1] if BACKUP_DIR.is_dir() else []
    if last:
        prev = last[0].read_text(encoding="utf-8", errors="replace")
        prev_slug, _ = edition_of(prev)
        before = {s["id"]: s["hash"] for s in sections_of(prev)}
        now_ = {s["id"]: s["hash"] for s in secs}
        added = [i for i in now_ if i not in before]
        changed = [i for i in now_ if i in before and before[i] != now_[i]]
        removed = [i for i in before if i not in now_]
        print(f"마지막 백업({last[0].name}) 대비 — 더한 절: {', '.join(added) or '없음'} / 고친 절: {', '.join(changed) or '없음'} / 없어진 절: {', '.join(removed) or '없음'}")
        if removed and prev_slug and prev_slug != slug:
            kept = [i for i in removed if any(f'id="{i}"' in p.read_text(encoding="utf-8", errors="replace") for p in history_files())]
            lost = [i for i in removed if i not in kept]
            if lost:
                problems.append(f"판을 바꿨는데 지난 판 절이 history/ 에 없음: {', '.join(lost)}")
            else:
                print(f"판이 바뀜({prev_slug} → {slug}): 지난 판 절 {len(kept)}개가 history/ 에 있음")
        elif removed and not allow_remove:
            problems.append(f"같은 판에서 절이 없어짐: {', '.join(removed)} — 의도했다면 사용자에게 물은 뒤 check --allow-remove (지운 기능이면 data-status=\"removed\" 로 남기기)")
    else:
        print("백업 없음 — 고치기 전에 backup 을 먼저")
    for n in notes:
        print(f"  확인: {n}")
    for p in problems:
        print(f"  문제: {p}")
    print(f"문제 {len(problems)}개, 확인할 것 {len(notes)}개 · 절 {len(secs)}개 · 판 {title or '-'} [{slug or '-'}]")
    return 1 if problems else 0


COMMANDS = {"init": cmd_init, "toc": cmd_toc, "backup": cmd_backup, "template": cmd_template,
            "edition": cmd_edition, "history": cmd_history, "check": cmd_check}


def main(argv):
    if not argv or argv[0] not in COMMANDS:
        print(__doc__)
        return 2
    return COMMANDS[argv[0]](argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
