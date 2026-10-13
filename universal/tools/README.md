# tools/

| 파일 | 내용 |
| --- | --- |
| `omni.py` | `init` · `update` · `index` · `validate` (Python 3.9+ 표준 라이브러리만 사용) |
| `tests/run.sh` | 정책 25건 + CLI 11건 회귀 테스트 |

사용법은 [../README.md](../README.md#사용법)를 보세요. `python3 omni.py --help`로 명령 목록을 볼 수 있습니다.

🔜 2단계: `sync [--check]`(어댑터 실행), `omni.json`/`omni.lock`. 4단계: `eval`.
