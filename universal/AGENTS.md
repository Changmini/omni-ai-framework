# AGENTS — universal

The tool- and model-neutral AI framework. `core/` is what `tools/omni.py` copies into a project (its `core/AGENTS.md` is the installed entry point, not these rules); `docs/` holds the design and standards; `adapters/` holds tool-specific output. Usage: [README.md](README.md).

This folder is one self-contained sub-project of the omni-ai-framework repository: it can be taken and used alone. The general sections below are the same in every sub-project's `AGENTS.md`; change them in all of them together. When this folder is used alone, keep the repository's MIT `LICENSE` with it.

Think and work in English. Reply in Korean.

## Repo text (absolute)

Covers code, identifiers, log/error messages, comments, docs, examples, commit messages.

- Write for a reader who has only the repo: what it is, its contract, how to run and maintain it, and the reason behind each value, exclusion, or exception.
- Say what that reader needs once and briefly; link instead of repeating.
- Never address the requester or session: no requests, no accounts of changes, nothing that needs the conversation or an earlier version to make sense. History belongs in VCS; change explanations in the reply or PR.
- English, imperative or neutral third person, except the Korean text listed under "Language".

## Code and commits

- Design first: list the cases, weigh likelihood against cost, and cover what is worth it with one structure, no narrower or wider.
- Ask before guessing on ambiguity or conflicts that change the design; decide minor ones and state them.
- Judge each question fresh; drop an earlier recommendation once it proves wrong.
- On factual corrections, agree only if the reasoning holds; otherwise explain. On user decisions (naming, structure, scope), raise concerns once, then follow.
- Do only what the task needs: no unrequested refactors, renames, reformatting, or optimizations; suggest them in the reply.
- Leave touched code production-ready in repo conventions, without debug leftovers.
- Follow standards as written; never bend them to suit tools.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/), imperative subject. Body only if needed: `-` bullets, ≤72 chars each, no prose, no restating the subject.

## Existing solutions first

- Before writing a function, check in order: standard library, declared dependencies, an established library not yet declared (propose it per Security), then custom code.
- Don't add a dependency for what a few clear lines of stdlib code handle; do use one for tricky domains (dates, URLs, parsing, networking, concurrency, crypto).
- Write custom code only when no option meets a stated requirement, checked against their docs. Keep it minimal and comment the requirement and options checked.
- Count speed only when measured on that path; fewer lines count for nothing.
- Question any requirement only custom code meets; drop it if no use case needs it.

## Evidence

- External facts (APIs, versions, licenses, security) need a checked primary source; repo facts need the code itself. Mark the rest unverified or inferred.
- If a source is unreachable, say so and mark claims that depend on it unverified.
- Never invent URLs, domains, package names, or schemas, even as placeholders; omit them without a source.
- Check APIs, signatures, CLI flags, and config keys against the docs for the version in use.
- Read existing code and docs first; contradict them only with new evidence.

## Other projects' code (absolute)

- License compliance comes first.
- Consult only projects the user has approved, via public docs and APIs. Refuse any whose license or terms conflict with this project's license (MIT, `LICENSE` at the repository root).
- Reading, copying, translating, or paraphrasing their code, structure, names, or text needs the user's explicit approval, even under a compatible license.
- No clean-room work without the user's explicit approval.
- Each direct dependency's license must be compatible with this project's license; meet its notice, attribution, and LICENSE/NOTICE terms.

## Security

- No secrets or hardcoded sensitive values anywhere, tests and examples included; use env vars, secret stores, untracked config, or fakes.
- Vet each dependency added directly to the project: use only established projects with a known maintainer, release history, wide use, and active maintenance.
- Check each for recent security incidents, such as vulnerability reports or supply-chain compromises.
- Before downloading, propose each new dependency and wait for the user's approval: name, maintainer, first release, need, alternatives, security incidents found.
- Compare candidates only from docs, registry, and repo pages; never download or trial them.
- Confirm the exact name and publisher on the official registry to rule out typosquatting.
- Pin by version, commit, or checksum; commit lockfiles.
- Direct downloads (outside package managers): verify signature, then checksum, when published. If missing, tell the user and get approval; if verification fails, stop.

## Verification

- Define expected behavior before implementing.
- Run relevant tests and checks after changes; add tests for changed behavior and regressions.
- Never weaken tests or remove assertions to make them pass.
- Never claim something ran or passed unless it did.
- Report what changed, what was verified, and what remains untested or failing, separate from suggestions.

## Compatibility

- Keep public interfaces and documented behavior unless the task requires a change; flag breaking changes before implementing.
- Account for existing data, migrations, and rollback.
- Never silently discard, overwrite, or transform user data.

## Legal compliance (absolute)

- Every action, including data collection, use of copyrighted works, third-party services, development, and debugging, must comply with applicable laws, regulations, and terms of service of every relevant country.
- Act only where it is clearly lawful and permitted; if legality or terms are unclear, stop and ask the user.
- Never bypass access restrictions.
- Never state conclusions on questions that need legal interpretation; flag them as such.

## Personal data (absolute)

No personal data anywhere — files, examples, tests, screenshots or commit messages: no real names, account or OS user names, home paths, emails, phone numbers, account ids, company project names, issue keys or business details. Use generic placeholders (`user`, `/home/user/sample-app`, `PROJ-123`). Screenshots must be taken in a clean sample environment. In this repository, `python3 .github/scripts/check-personal-data.py` (run from the repository root) checks text files in CI but cannot read images.

## Language

Korean, for the Korean readers they serve: README files, `docs/` pages, and skill documents already written in Korean. Everything else in "Repo text" (code, identifiers, comments, log/error messages, commit messages) is English.

## This project

- `core/` is copied verbatim into projects: never name a specific AI tool, tool API, or model there (`omni.py validate` enforces it). Tool-specific output belongs in `adapters/<tool>/`.
- After adding or editing a skill or role in `core/`, run `python3 tools/omni.py index core`.
- Mark every claim about a tool's behavior as verified (with an official source link) or unverified, as in `docs/STANDARDS.md`.

### Commands

Run from this folder:

- Validate and test: `python3 tools/omni.py validate core && tools/tests/run.sh`
- Before committing, from the repository root: `python3 .github/scripts/check-personal-data.py`
