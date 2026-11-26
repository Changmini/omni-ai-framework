#!/usr/bin/env python3
"""Checks that each task's hidden tests are fair: they fail on fixture/ as it
is, and they all pass (with the fixture's own tests) once the task's
reference/ files are laid over it. Run after adding or changing a task.
Spends no API tokens.

  python3 check_tasks.py            # every task
  python3 check_tasks.py soft-delete
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from run import GRADER, HERE


def grade(tree, task_dir):
    shutil.copy(task_dir / "hidden_test.py", tree / "hidden_test.py")
    out = subprocess.run([sys.executable, "-c", GRADER], cwd=tree, capture_output=True, text=True, timeout=300)
    return json.loads(out.stdout.strip().splitlines()[-1])


def check(task_dir):
    with tempfile.TemporaryDirectory() as tmp:
        start = Path(tmp) / "start"
        shutil.copytree(HERE / "fixture", start)
        before = grade(start, task_dir)
        ref = Path(tmp) / "ref"
        shutil.copytree(HERE / "fixture", ref)
        shutil.copytree(task_dir / "reference", ref, dirs_exist_ok=True)
        after = grade(ref, task_dir)
    passed = lambda g: sum(v == "pass" for v in g["hidden"].values())  # noqa: E731
    total = len(after["hidden"])
    ok = passed(after) == total and after["own_failed"] == 0 and passed(before) < total
    print(f"{'ok  ' if ok else 'FAIL'} {task_dir.name}: start {passed(before)}/{total}, "
          f"reference {passed(after)}/{total}, own tests failed {after['own_failed']}")
    if not ok:
        print("     ", {k: v for k, v in after["hidden"].items() if v != "pass"})
    return ok


def main():
    names = sys.argv[1:] or sorted(p.name for p in (HERE / "tasks").iterdir() if p.is_dir())
    results = [check(HERE / "tasks" / n) for n in names]
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
