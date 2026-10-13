# Skill and role checklist

Sources: Agent Skills specification (agentskills.io, github.com/agentskills/agentskills) and its best-practices guide.

## Skill frontmatter
- [ ] Frontmatter starts on line 1 between `---` lines and is valid YAML
- [ ] Only standard fields: `name`, `description`, optional `license`, `compatibility`, `metadata`, `allowed-tools`
- [ ] `name`: 1–64 characters, `a-z`, `0-9`, `-`; no leading, trailing, or double hyphen; equals the folder name
- [ ] `name` contains no vendor or product names; uses a gerund (`writing-documents`)
- [ ] `description`: 1–1024 characters, third person, says what it does and when to use it, key trigger words first
- [ ] Framework extensions go in `metadata` with the `omni.` prefix: `omni.invocation: manual`, `omni.arguments: "[...]"`

## Skill body
- [ ] Under 500 lines; detail moved to `references/`, templates to `assets/`, code to `scripts/`
- [ ] Links are relative to the skill folder and one level deep
- [ ] Adds only what an agent would not know; no tutorials
- [ ] One default approach with an escape hatch, not a menu of options
- [ ] Multi-step work has a copyable checklist and a validate → fix → repeat loop
- [ ] No names of specific AI tools, tool APIs, models, or vendor environment variables
- [ ] Every capability that some environments lack (sub-agents, question tools, hooks) has a written fallback
- [ ] No time-sensitive statements; forward slashes in paths

## Scripts
- [ ] Non-interactive; `--help` documents usage; errors say what to do next
- [ ] Output is structured (JSON or delimited) when another step parses it
- [ ] Dependencies are listed in the skill or in `compatibility`

## Role files
- [ ] Frontmatter: `name` (equals file name), `description` (what + when), `access` (`read-only` or `read-write`)
- [ ] Body is self-contained: inputs it expects, steps, exact output format
- [ ] States that the role cannot see the caller's conversation and must not ask the end user questions

## Evaluation
- [ ] `evals/evals.json` with at least 3 prompts, one of which should not trigger the skill
- [ ] Compared with and without the skill, on more than one agent or model when possible
