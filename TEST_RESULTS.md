# Browser Acceptance Test Results

Date: 2026-08-10
Target: `http://127.0.0.1:3000`
Browser engine: Installed Google Chrome, headless mode via Chrome DevTools Protocol
Server mode: `npm run dev`
Database: local Postgres container, seeded via `npm run db:seed`
Redis: local Redis container, worker boot confirmed in server logs

## Setup Findings
- `docker compose up -d db redis` succeeded.
- `npm run db:migrate` is interactive and refused to run in this automation context.
- For automated acceptance, `npx prisma migrate deploy` is the correct command.
- This existing local DB had previously been created via `prisma db push`, so it required one-time local baselining: `npx prisma migrate resolve --applied 20260810220000_init`.
- `npm run dev` initially exposed an ESM startup bug in `queue.admin.controller.ts`; that was fixed by replacing CommonJS `require()` with ESM import.

## Browser Checks Executed
| # | Check | Result |
|---|-------|--------|
| 1 | `/health` returns success envelope and DB up | PASS |
| 2 | `/` renders seeded CMS home content | PASS |
| 3 | `/pages/welcome` renders JSON content blocks | PASS |
| 4 | `/projects` renders Alpha/Beta/Gamma seed projects | PASS |
| 5 | `/projects/seed-project-alpha` renders project tasks | PASS |
| 6 | `/admin` redirects logged-out user to login | PASS |
| 7 | Login form has unique email/password/submit controls | PASS |
| 8 | Invalid login shows authentication error | PASS |
| 9 | Valid admin login reaches dashboard | PASS |
| 10 | `/admin/user` renders seeded users | PASS |
| 11 | `/admin/page` renders seeded CMS page | PASS |
| 12 | `/admin/organizations` renders the corrected Organizations admin page | PASS |
| 13 | `/admin/settings` renders grouped settings page | PASS |
| 14 | `/admin/logs/diagnostics` renders diagnostics/system health | PASS |
| 15 | Authenticated `/api/users` returns success envelope and data | PASS |
| 16 | Unknown route renders handled 404 page | PASS |
| 17 | Logout clears admin session and returns to login | PASS |

## Evidence
The reusable browser acceptance script is `tests/acceptance/browser-acceptance-test.mjs`.
It exits non-zero on any failed check. Latest run: all 17 checks passed. Raw JSON saved during this run to `C:\tmp\mvc-browser-acceptance-latest.json`.

## Notes
- The Codex in-app browser blocked localhost/127.0.0.1 with `ERR_BLOCKED_BY_CLIENT`, so the browser run used installed Chrome headless instead.
- The API user count was 6 in this local database because prior development/browser-test users already existed. The pass condition checks the envelope and array shape, not an exact seed-only count.


## Upload Smoke Test
A reusable upload check lives at `tests/acceptance/upload-smoke-test.mjs`. Latest run passed: login, upload, media-library render, DB metadata, admin delete cleanup, and soft-delete verification.




## Organizations Route Spelling
The browser acceptance script now checks `/admin/organizations` and asserts the corrected spelling is rendered without the old spelling variant.


