---
name: diagram
description: Keeps private/index.html, the user's accumulating visual reference, as one HTML page per topic with past editions in private/history/. Use whenever something is easier to grasp as a picture than as prose (a flow across several files or steps, branching rules, state changes, before and after a change, comparisons, dates and deadlines, worked number examples), when the user asks for a picture, diagram, table, chart, or 「그림」, 「다이어그램」, 「표로」, 「한눈에」, 「이해가 안 돼」, at the start of work on a topic (check the page and its past editions first), after changing code a section depicts, and when work moves to an unrelated topic.
---

# Diagram (private/index.html)

## What the file is

- `private/index.html` is the **current edition** of the user's visual reference, open in a browser or the tool's HTML preview. An edition is a set of sections about one concept, reached from the contents at the top.
- When work moves to an unrelated concept, the current edition moves to `private/history/` and a new one replaces it. The new edition's header lists past editions.
- What prose forces the reader to redraw in their head (flows across files, branching conditions, state changes, before and after) is drawn here once and reused in later sessions.
- So **never overwrite carelessly.** Within an edition, add a section or change only that section; a new edition keeps the old one whole in `history/`.
- `private/` stays out of version control. If it is not ignored, add it to `.git/info/exclude`. Do not commit or publish it.

## When to use it

**The user asks**: a picture, diagram, table, chart, preview, "I don't get it", "explain the workflow".

**Draw without being asked** when an answer hits one of these, alongside the prose answer:
- A flow crosses **three or more** files, screens, or servers (screen → API → service → table).
- **Two or more branching conditions** combine.
- A judgment needs **before → after** side by side (goal definition, plan, result of a fix).
- **Three or more things are compared** on the same fields.
- **Dates, deadlines, or order** are the point.
- A rule only shows with **real numbers** (discounts, fees).

**Do not draw** answers of a line or two, what a list reads well as, or when the user wants prose only.

**At the start of work** on a topic, check the contents (`toc`) and past editions (`history <word>`). If a section on the same topic exists, read it before researching again, and run "Is it stale?" below first.

**After changing code**: if a changed file is in a section's evidence, update the section. A drawing that disagrees with the code is worse than none.

## Keep it light

Drawing must not outgrow the work. A section needs a few key files as evidence; no screenshots, screen checks, or extra test scripts. One `check` is the whole verification.

## Same edition or a new one?

Before drawing a new topic, look at the current edition with `toc`.

- **Add to the current edition** when the feature, screen, ticket, or task is the same, the evidence files overlap, or a reader of this edition would read on (a follow-up, a sub-part, the result of a fix, the next step).
- **Start a new edition** for an **unrelated concept** that shares no feature, evidence file, or task with any section. Example: from an order payment flow to a notification settings screen.
- When unsure: would someone opening this edition ask "why is this here?" Then it is a new edition.

`edition <slug> "<title>"` moves the current edition to `private/history/<timestamp>-<slug>.html` (with a backup first), lays down a new skeleton, and syncs the past-editions list. Then add the first section with `template`.

- Files in `history/` are records: never edit them. When an old topic returns, find it with `history <word>`, run "Is it stale?", and carry the section into the current edition (or a new one) and update it there.
- `private/.index-backup/` holds automatic backups (newest 15) against mistakes; `history/` holds editions (never deleted). They are different.

## Order of work

Tool: `python3 <this skill's folder>/scripts/notes.py <command>`, run from the project root. `--file <path>` works on another file; its backups and editions sit next to it. The skeleton is `assets/skeleton.html`.

1. `toc`: the current edition and its sections. Update a section on the same topic instead of adding one. For an unrelated concept, start with `edition`.
2. `backup`: once before editing.
3. Gather evidence: open the files and confirm `file:line`. Never draw from memory or the conversation. Mark facts and guesses apart.
4. For a new section, `template <id> "<title>"` prints a contents line and a section frame. Put the contents line first under `<!-- toc:start -->` and the section first under `<!-- sections:start -->` (newest on top). For an updated section, move it to the top and refresh `data-updated`, `data-basis`, and its meta line.
5. Change **only that section and its contents line**. Never rewrite the whole file: other sections get changed or lost by accident.
6. `check`: structure, unclosed tags, contents match, past-edition links, outside resources, values that must not be there, and which sections were added, changed, or removed since the last backup (`check --against <file>` compares with another file). Expect no problems and only the changes you meant.

## Section shape

```html
<section id="user-create-flow" data-updated="2026-11-20" data-basis="a1b2c3d" data-status="current">
  <h2>Creating a user — the request's path and where it is stored</h2>
  <p class="meta">Updated 2026-11-20 · basis a1b2c3d (+ uncommitted changes) · current</p>
  <p class="verdict">One line: the question this drawing answers, and the answer</p>
  … drawing …
  <h3>Evidence</h3>
  <ul class="files"><li><span class="mono">src/api/users.py:12</span> — rejects an empty name</li></ul>
</section>
```

- `id` is lowercase-hyphenated and stays the same for the same topic. Status is `current`, `stale` (not re-checked), or `removed` (a deleted feature, kept as a record); the contents pill matches it (`pill st-current`, `pill st-stale`, `pill st-removed`).
- Group inside a section with `<div class="block">`; never nest sections.
- Parts (usage in the comment at the top of the skeleton's `<style>`): `.lane` (vertical flow, "who" on the left, boxes `.node`, joins `.down`), `.flow` (short horizontal flow, joins `.arrow`), `.branch` (two branches, conditions `.if`), `.two` (side by side, before and after), `table` (wrap wide ones in `.scroll`), `pre` (request and response shapes), `.pill`, `.verdict`, `.note-fact` / `.note-guess`. Use inline SVG for anything else.
- Color carries meaning only: green `.ok` normal or stored, orange `.warn` caution or guess, red `.bad` blocked, red dashed `.none` missing, blue `.ext` outside system. The skeleton handles light and dark.
- Load no outside scripts, fonts, or images: the page must render offline.
- Plain words, short, in the user's language. No circled numbers or internal codes.

## Is it stale?

Before relying on a section, check whether its evidence changed after its basis commit:

```bash
git log --oneline <data-basis>..HEAD -- <evidence files>; git status --short -- <evidence files>
```

- Both empty: use it as is.
- Otherwise open the changes and update the section. If you cannot now, set `data-status="stale"` and its pill to stale.
- For a deleted feature, keep the section as `removed` with the date and reason in its summary line. Delete it only after asking the user (`check --allow-remove`).

## In the answer

- The prose answer stands alone; the user should not need the file for the conclusion. Include a short text sketch of the flow.
- End with one line: `Drawing: private/index.html → "<section title>" (added / updated / unchanged / new edition — past edition history/<file>)`.
- Do not write the same thing at length twice: the answer has the conclusion and key flow, the file the full drawing and evidence.

## Never put in

- Real names, account names, contact details, emails, keys, tokens, connection details, account numbers, real company or customer data. Use made-up or public values.
- Personal tasks unrelated to the work.
- Review each "value that must not be there" warning from `check`: remove it, or confirm the value is harmless.

## First use

- With no file, `init [<slug> "<title>"]` creates the skeleton.
- An old single-page file without contents or section markers counts as a past edition: move it with `edition` and start a new one.
- If `check` warns that the past-editions list is missing, copy that part of `assets/skeleton.html` (`<details class="toc history">`) below the contents and run `history --sync`.
