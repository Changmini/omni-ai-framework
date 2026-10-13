# omni-ai-framework

여러 프로젝트에 같은 AI 작업 규칙·지식·안전장치를 적용하기 위한 프레임워크입니다.

| 폴더 | 성격 | 상태 |
| --- | --- | --- |
| [`universal/`](universal/) | **도구·모델 중립** 프레임워크. 루트 `AGENTS.md`가 스킬·서브 에이전트 역할·문서 디자인으로 안내하고, git hooks가 강제 | 1단계 구현 완료 → [사용 안내](universal/README.md) · [설계](universal/docs/DESIGN.md) |
| [`claude-code/`](claude-code/) | **Claude Code 전용** 플러그인 마켓플레이스 + 프로젝트 템플릿 | 동작함 (`claude plugin validate --strict` 통과) |

`universal/`이 기준이고, `claude-code/`는 그 설계 중 Claude Code 어댑터의 참조 구현입니다.

저장소 루트에는 특정 도구 전용 파일이 없습니다. Claude Code를 쓰려면 저장소를 clone한 뒤 `claude-code/` 폴더를 마켓플레이스로 등록하세요.

```bash
git clone https://github.com/changmini/omni-ai-framework ~/omni-ai-framework
claude plugin marketplace add ~/omni-ai-framework/claude-code
```

자세한 사용법은 [claude-code/README.md](claude-code/README.md#설치-claude-code-폴더를-마켓플레이스로-등록)를 보세요.

## 라이선스

MIT
