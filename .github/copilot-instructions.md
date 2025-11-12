## Quick orientation

- Project is API-first. The backend lives in `NodeBackend/server`. The server entry is `NodeBackend/server/index.ts` and routes are defined in `NodeBackend/server/routes.ts`.
- Local development uses `tsx` to run TypeScript directly (no build). Start dev server from the repo root:
  - `npm run install` (installs `NodeBackend` deps)
  - `npm run dev` (runs `NodeBackend` dev via `tsx server/index.ts`)

## Big-picture architecture (short)

- Multi-tenant WhatsApp sessions are managed by `MultiUserWhatsAppService` (`server/services/MultiUserWhatsAppService.ts`). It keeps in-memory session state and persistent auth files under `auth/` per user.
- Message handling and persistence is via `MessageService` (`server/services/MessageService.ts`) and storage abstractions in `server/storage/` (e.g. `DatabaseStorage.ts`).
- File uploads use multer (memory storage) and either `FileService` (local temp) or `PersistentFileService` (DB-backed) depending on `DATABASE_URL`.
- Real-time UI updates are pushed over WebSocket on path `/ws` (see `registerRoutes` in `routes.ts`). Key events: `user-qr-code`, `user-status-update`, `user-authenticated`, `user-disconnected`, `user-message-sent`, `user-message-update`.

## Important workflows & commands

- Dev run (from repo root):
  - `npm run install` then `npm run dev` (these CD into `NodeBackend` and run scripts there).
- Production: `npm run build` then `npm start` (root scripts delegate to `NodeBackend`). Note: `NodeBackend` uses `start: "cross-env NODE_ENV=production tsx server/index.ts"` (no transpile step).
- Database: use `npm run db:push`, `npm run db:seed`, `npm run db:init` from `NodeBackend` (configured in `NodeBackend/package.json`). Uses `drizzle-kit` and `scripts/*.ts`.

## Environment and runtime flags to watch

- NODE_ENV (production|development)
- PORT (defaults to 3001)
- SERVE_UI=true + NODE_ENV=development to enable Vite UI (`server/vite-dev.ts`) — otherwise API-only mode.
- DATABASE_URL toggles persistent file storage vs ephemeral (`PersistentFileService` vs `FileService`).
- MAX_FILE_SIZE, WHATSAPP_MAX_SESSIONS_PER_USER, WHATSAPP_MAX_GLOBAL_SESSIONS, SESSION_CLEANUP_INTERVAL, WHATSAPP_QR_TIMEOUT — these are used extensively inside services.

## Project-specific patterns and gotchas

- API-first, many legacy endpoints are intentionally left as deprecated; new multi-user routes live under `/api/users/:userId/whatsapp/*` (see `routes.ts`). When modifying endpoints prefer the new per-user API.
- Auth persistence: `MultiUserWhatsAppService` uses per-user `auth/<userId>` directories created by `useMultiFileAuthState`. Don't delete these unless you intend to force re-pairing.
- Rate-limiting and reconnection: the service has in-code rate-limiting and exponential backoff logic. Creating sessions too frequently triggers errors — prefer calling `createUserSession(userId)` and listening for `user-qr-code` events rather than re-creating sessions quickly.
- File handling: uploads are stored in memory and saved to either local temp or persistent storage then cleaned up after send (see `routes.ts` POST `/api/send-report` which schedules deletion after 5 minutes).

## Integration points and examples

- WebSocket server: `ws` mounted at `/ws`. Example event to listen for: `user-qr-code` which delivers `{ sessionId, userId, qrCode, rawQR }`.
- Example: to ask the server to start pairing for user `u123` call `POST /api/users/u123/whatsapp/connect`. The server will emit `user-qr-code` over `/ws` when ready.
- Shared runtime schema: `shared/schema.ts` holds Zod schemas used by routes (imported as `@shared/schema`); use these when adding endpoints to keep validation consistent.

## Where to look for authoritative code

- Service wiring: `NodeBackend/server/routes.ts` (HTTP + WebSocket + event wiring).
- Core session logic: `NodeBackend/server/services/MultiUserWhatsAppService.ts`.
- Message persistence: `NodeBackend/server/services/MessageService.ts` and `NodeBackend/server/storage/DatabaseStorage.ts`.
- Utility helpers and guards: `NodeBackend/server/utils.ts` and `NodeBackend/server/storage/index`.

If anything here is unclear or you'd like the instructions tailored to a specific agent role (code authoring, bug fixing, or test writing), tell me which focus and I'll iterate.
