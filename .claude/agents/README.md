# Subagents

One file per area of rules, loaded only when that area is being worked on. `CLAUDE.md` stays short
and points here; the detail lives in the agent, so a session that touches only the frontend never
pays for the database rules and the other way round.

| Agent | Use it for |
| --- | --- |
| [db-schema-reviewer](db-schema-reviewer.md) | Any change to `schema.prisma`, a migration, a Prisma read or write, or raw SQL. Reviews against the database rules: links are ids with keys, text is only a copy, reads resolve through the relation, migrations rehearsed on a copy. |
| [frontend-ui-reviewer](frontend-ui-reviewer.md) | Any change that adds or edits UI under `frontend/src`. Reviews against Rules 1 and 2 and the frontend layers: an existing component is reused and raw markup is never typed for something that exists, a missing one is created once in the right folder, everything is usable at ~360px, pages compose and services call. Carries the component inventory so the README's Rule 1 table need not be read. |
| [ux-heuristics-reviewer](ux-heuristics-reviewer.md) | Any change that adds or reshapes a screen, flow, dialog or form under `frontend/src`. Reviews against Rule 6: Nielsen's 10 heuristics, Shneiderman's 8 golden rules and Gerhardt-Powals' cognitive principles, the interaction and perception laws (Hick, Fitts, Miller, Jakob, Gestalt), and content, accessibility and experience (WCAG 2.1 AA, content design, Norman, Tognazzini, Peak-End, Fogg, Cialdini), and the house SAGE checklist (first-time user, trust, cognitive load) scored per screen, mapped to the app's own components — status and feedback (`FloatingNotice`, `Loader`, `useSubmitOnce`), leaving and undoing (`Dialog`, `useUnsavedGuard`), error prevention (`ConfirmDialog`), plain wording, only the needed fields, known values filled in. Component reuse and ~360px layout stay with `frontend-ui-reviewer`. |
| [backend-api-reviewer](backend-api-reviewer.md) | Any change under `backend/src`: a route, controller, service, middleware, worker or env var. Reviews against the backend rules: every router mounts `protect` and a permission guard and nothing else decides access, branch reach names its permission, `dataScope` narrows the module, controllers validate and answer JSON with the right status, an existing service is reused, no id from the request is trusted, no secret is written down, a test covers it. Schema and migrations stay with `db-schema-reviewer`. |
| [security-reviewer](security-reviewer.md) | Any change touching authentication, a token, a public or tokenized route, a webhook, raw SQL, an upload or download, mail or SMS, an outbound HTTP call, a secret or env var, CORS or headers, a dependency, or rendering of user text. Looks for injection, weak or long-lived tokens, unauthenticated webhooks, unbounded uploads, SSRF, secrets in code or logs, XSS, mass assignment, missing rate limits, vulnerable dependencies. Access by permission stays with `backend-api-reviewer`. For a whole branch, `/security-review` in Claude Code does the same at branch scope. |
| [token-optimizer](token-optimizer.md) | Any change to `CLAUDE.md`, a README, a `docs/project-state/` file, an agent file, or the changelog's how-to. Reports what each rule file costs a session to read, whether a rule is written once in the right place, whether a large file is shaped to be read by section, and that the changelog keeps only current work. Advises; nothing is enforced. |

## Adding one

1. Copy the frontmatter shape of an existing file: `name`, `description` (when to use it - this is
   what the main agent reads to decide), `tools` (read-only for a reviewer), `model`.
2. Write the rules as numbered sections, each rule one line where possible, with the file that
   implements it named so the agent can check rather than guess.
3. End with "What to report": the exact shape of the answer, so the main session gets findings and
   not a re-telling of the diff.
4. Add a row to the table above and one line under the matching rule in `CLAUDE.md`.
5. Run `scripts/doc-sizes.sh` to see what the file and `CLAUDE.md` now cost a session. An agent
   file that has grown to cover two concerns splits by area, so each is loaded only when needed.

When a rule grows past a paragraph in `CLAUDE.md`, or a README section becomes a checklist that
only one kind of change needs, that is the moment to make it an agent file: the rule then costs
nothing to the sessions that never need it. Candidate: a `migration-author` that turns a schema
edit into a rehearsed migration.
