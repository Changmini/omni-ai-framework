# Prints the user's own status line command (statusLine.command), if any, for
# the app's status line to run after reporting plan usage. Same precedence as
# Claude Code: local, then project, then user settings; the files to check
# are passed in that order. Prints nothing when there is none.
import json
import sys

for f in sys.argv[1:]:
    try:
        with open(f, encoding='utf-8') as fh:
            s = json.load(fh).get('statusLine')
    except Exception:
        continue
    if not isinstance(s, dict):
        continue
    cmd = s.get('command')
    if s.get('type', 'command') == 'command' and isinstance(cmd, str) and cmd.strip():
        sys.stdout.write(cmd)
        break
