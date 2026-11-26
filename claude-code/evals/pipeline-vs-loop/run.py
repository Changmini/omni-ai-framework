#!/usr/bin/env python3
"""Runs eval tasks of the pipeline-vs-loop eval under each setup (arm) and grades them.

Arms (same model, same plugin, same task prompt):
  A  the omni-pipeline lead (`--agent omni-pipeline:lead`): SPEC, then the
     implementer and reviewer subagents
  B  one loop: the plugin's skills, the Agent tool disallowed
  C  one loop, with only the final check handed to the reviewer subagent

Each run copies fixture/ into a fresh git repository under --out, runs
`claude -p` there, then grades what ended up on main (falling back to the
newest other worktree when main has no change) with the task's hidden tests
and the fixture's own tests. Results: <out>/summary.json and a table on stdout.

Every run spends API tokens; --budget caps each run (claude --max-budget-usd).
Standard library only.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent.parent / "plugins" / "omni-pipeline"

COMMON = (
    "\n\n사람에게 질문하지 말고 끝까지 진행해. 정해지지 않은 것은 가정을 SPEC"
    "(docs/specs/<작업 이름>.md)에 적고 진행해. 끝나면 최종 결과를 지금 브랜치(main)에 커밋해 둬."
)
ARMS = {
    "A": {
        "args": ["--agent", "omni-pipeline:lead"],
        "note": "",
    },
    "B": {
        "args": ["--disallowedTools", "Agent"],
        "note": "\n혼자 처리해: SPEC을 쓰고, 직접 구현하고, SPEC 기준으로 직접 검토해 고친 뒤 끝내.",
    },
    "C": {
        "args": [],
        "note": "\nSPEC을 쓰고 직접 구현해. 마지막 검증만 omni-pipeline:reviewer 서브에이전트에게 SPEC과 diff를 주고 맡기고, 보고된 차이를 고친 뒤 끝내.",
    },
}
TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "Skill", "TodoWrite"]
# Set when this script is started from inside a Claude Code session: they tie
# the child claude to that session or run its subagents in the background,
# unlike a claude started by hand (names as seen in a cloud session on
# Claude Code 2.1.332).
PARENT_SESSION_VARS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_CHILD_SESSION",
                       "CLAUDE_CODE_CHILD_NOTES_DIR", "CLAUDE_AUTO_BACKGROUND_TASKS", "CLAUDE_CODE_BG_TASKS_REPORT_RUNNING"]


def git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True).stdout.strip()


def new_repo(run_dir):
    repo = run_dir / "repo"
    shutil.copytree(HERE / "fixture", repo)
    for args in (["init", "-q", "-b", "main"], ["add", "-A"],
                 ["-c", "user.name=eval", "-c", "user.email=eval@example.com", "commit", "-q", "-m", "start"]):
        subprocess.run(["git", "-C", str(repo), *args], check=True)
    return repo, git(repo, "rev-parse", "HEAD")


def changed(tree, start):
    """Whether `tree` (a worktree) differs from `start`, committed or not."""
    return bool(git(tree, "diff", "--name-only", start)) or bool(git(tree, "status", "--porcelain"))


def result_tree(repo, start):
    """The tree to grade: main when it changed, else the newest changed worktree."""
    if changed(repo, start):
        return repo, "main"
    trees = [line.split(" ", 1)[1] for line in git(repo, "worktree", "list", "--porcelain").splitlines()
             if line.startswith("worktree ")]
    others = [Path(t) for t in trees if Path(t) != repo and changed(Path(t), start)]
    if not others:
        return repo, "main (변경 없음)"
    newest = max(others, key=lambda t: int(git(t, "log", "-1", "--format=%ct") or 0))
    return newest, f"worktree {newest.name} (main에 반영 안 됨)"


def grade(tree, task_dir):
    """Hidden tests and the tree's own tests, run in a copy so nothing leaks back."""
    work = tree.parent / f"grade-{tree.name}"
    shutil.rmtree(work, ignore_errors=True)
    shutil.copytree(tree, work, ignore=shutil.ignore_patterns(".git"))
    shutil.copy(task_dir / "hidden_test.py", work / "hidden_test.py")
    out = subprocess.run([sys.executable, "-c", GRADER], cwd=work, capture_output=True, text=True, timeout=300)
    try:
        return json.loads(out.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        return {"error": (out.stderr or out.stdout)[-2000:]}


# Run in the graded copy: each hidden test's outcome, and the copy's own tests.
GRADER = r"""
import json, sys, unittest
sys.path.insert(0, ".")
def outcomes(suite):
    res = {}
    class R(unittest.TextTestResult):
        def addSuccess(self, t): res[t.id()] = "pass"
        def addFailure(self, t, e): res[t.id()] = "fail"
        def addError(self, t, e): res[t.id()] = "error"
    unittest.TextTestRunner(stream=open("/dev/null", "w"), resultclass=R).run(suite)
    return res
loader = unittest.TestLoader()
try:
    hidden = outcomes(loader.loadTestsFromName("hidden_test"))
except Exception as e:
    hidden = {"import": "error: %s" % e}
own_suite = loader.discover(".", pattern="test*.py")
own = outcomes(own_suite)
print(json.dumps({"hidden": {k.split(".")[-1]: v for k, v in hidden.items()},
                  "own_total": len(own), "own_failed": sum(v != "pass" for v in own.values())}))
"""


def stream_stats(path):
    """Cost, time, turns, tokens and subagent calls from claude's stream-json output.

    A session can end more than once: when a subagent ran in the background,
    claude prints a result, picks up the subagent's report and goes on, then
    prints another. Each result's duration and turns cover its own stretch,
    so they are summed; total_cost_usd and modelUsage are running totals over
    every model (subagents included), so the last result's are kept (seen on
    Claude Code 2.1.332).
    """
    stats = {"subagents": {}, "duration_s": 0, "turns": 0, "results": 0}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "assistant":
            for c in (ev.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") in ("Agent", "Task"):
                    kind = (c.get("input") or {}).get("subagent_type") or "?"
                    stats["subagents"][kind] = stats["subagents"].get(kind, 0) + 1
        elif ev.get("type") == "result":
            models = (ev.get("modelUsage") or {}).values()
            total = lambda key: sum(m.get(key) or 0 for m in models)  # noqa: E731
            stats.update({
                "result": ev.get("subtype"),
                "is_error": ev.get("is_error"),
                "cost_usd": round(ev.get("total_cost_usd") or 0, 4),
                "input_tokens": total("inputTokens"),
                "cache_read_tokens": total("cacheReadInputTokens"),
                "cache_write_tokens": total("cacheCreationInputTokens"),
                "output_tokens": total("outputTokens"),
            })
            stats["duration_s"] += round((ev.get("duration_ms") or 0) / 1000)
            stats["turns"] += ev.get("num_turns") or 0
            stats["results"] += 1
    return stats


def run_one(task, arm, n, args, out):
    run_dir = out / f"{task}-{arm}-{n}"
    run_dir.mkdir(parents=True)
    repo, start = new_repo(run_dir)
    prompt = (HERE / "tasks" / task / "prompt.md").read_text(encoding="utf-8") + COMMON + ARMS[arm]["note"]
    tools = TOOLS + ([] if arm == "B" else ["Agent"])
    cmd = ["claude", "-p", "--output-format", "stream-json", "--verbose", "--model", args.model,
           "--plugin-dir", str(PLUGIN), "--permission-mode", "acceptEdits", "--add-dir", str(run_dir),
           "--max-budget-usd", str(args.budget), *ARMS[arm]["args"], "--allowedTools", *tools, "--", prompt]
    t0 = time.time()
    with open(run_dir / "stream.jsonl", "w", encoding="utf-8") as so, open(run_dir / "stderr.txt", "w") as se:
        try:
            env = {k: v for k, v in os.environ.items() if k not in PARENT_SESSION_VARS}
            subprocess.run(cmd, cwd=repo, env=env, stdin=subprocess.DEVNULL, stdout=so, stderr=se, timeout=args.timeout)
            timed_out = False
        except subprocess.TimeoutExpired:
            timed_out = True
    row = {"task": task, "arm": arm, "n": n, "wall_s": round(time.time() - t0), "timed_out": timed_out}
    row.update(stream_stats(run_dir / "stream.jsonl"))
    tree, where = result_tree(repo, start)
    row["graded"] = where
    row.update(grade(tree, HERE / "tasks" / task))
    hidden = row.get("hidden") or {}
    row["hidden_passed"] = sum(v == "pass" for v in hidden.values())
    row["hidden_total"] = len(hidden)
    (run_dir / "row.json").write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
    return row


def table(rows):
    head = "| 작업 | 구성 | 회 | 숨긴 시험 | 기존 시험 실패 | 비용($) | 시간(s) | 턴 | 서브에이전트 | 채점한 곳 |"
    lines = [head, "|" + "---|" * 10]
    for r in rows:
        subs = ", ".join(f"{k}×{v}" for k, v in r.get("subagents", {}).items()) or "—"
        lines.append(f"| {r['task']} | {r['arm']} | {r['n']} | {r['hidden_passed']}/{r['hidden_total']} | {r.get('own_failed', '?')} "
                     f"| {r.get('cost_usd', '?')} | {r['wall_s']} | {r.get('turns', '?')} | {subs} | {r['graded']} |")
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--tasks", default="soft-delete", help="comma-separated task names, or all")
    p.add_argument("--arms", default="A,B,C")
    p.add_argument("--repeat", type=int, default=1)
    p.add_argument("--model", default="sonnet")
    p.add_argument("--budget", type=float, default=3.0, help="USD cap per run")
    p.add_argument("--timeout", type=int, default=1800, help="seconds per run")
    p.add_argument("--out", type=Path, required=True, help="a new folder for this run's files")
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    rows = []
    tasks = (sorted(d.name for d in (HERE / "tasks").iterdir() if d.is_dir()) if args.tasks == "all"
             else args.tasks.split(","))
    for task in tasks:
        for n in range(1, args.repeat + 1):
            for arm in args.arms.split(","):
                print(f"running {task} arm {arm} #{n}", file=sys.stderr, flush=True)
                rows.append(run_one(task, arm, n, args, args.out))
                (args.out / "summary.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(table(rows))


if __name__ == "__main__":
    main()
