/**
 * DTOs mirroring the spilofila REST API surface the scanner uses.
 *
 * Hand-maintained for Phase 1. These can later be generated from
 * `public/openapi.json` (e.g. openapi-typescript) so the client can't drift
 * from the server — see docs/mobile-app-plan.md §7. Kept deliberately partial:
 * only the fields the app reads/writes are typed; `[k: string]: unknown` keeps
 * the rest of each document accessible without over-specifying.
 */
export {};
