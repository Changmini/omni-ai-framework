# Skill checklist

Sources: platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices and code.claude.com/docs/en/skills

## Frontmatter
- [ ] Frontmatter starts on line 1, between `---` markers, valid YAML
- [ ] `name`: ≤ 64 chars, lowercase letters, digits, hyphens only; no XML tags; does not contain `anthropic` or `claude`
- [ ] `name` uses a consistent pattern (gerund preferred: `processing-pdfs`); avoid vague names (`helper`, `utils`)
- [ ] `description`: non-empty, ≤ 1,024 chars, no XML tags, written in third person
- [ ] `description` states what it does AND when to use it, key use case first
- [ ] `disable-model-invocation: true` for workflows with side effects

## Body
- [ ] SKILL.md body under 500 lines
- [ ] Only context Claude doesn't already have; no tutorials
- [ ] One default approach, with an escape hatch, instead of many options
- [ ] Consistent terminology
- [ ] Multi-step work has a copyable checklist and a validate → fix → repeat loop
- [ ] Reference files linked directly from SKILL.md (one level deep); files over 100 lines start with a table of contents
- [ ] No time-sensitive statements
- [ ] Forward slashes in all paths

## Scripts
- [ ] Clear whether Claude should run a script or read it
- [ ] Scripts handle errors themselves; constants are explained
- [ ] Required packages are listed

## Testing
- [ ] At least three representative requests tried, with and without the skill
