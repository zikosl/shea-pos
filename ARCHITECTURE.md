# Shea POS architecture

Shea POS is an offline-first Electron application. Local SQLite is the operational source of truth while a register is running; the Shea server remains authoritative for identity, shared catalog governance, online orders, and synchronized records.

## Boundaries

- `electron/domain`: pure business rules with no Electron, network, or database imports.
- `electron/sync.ts`: application orchestration for activation, push, pull, retries, and offline lease renewal.
- `electron/database.ts`: SQLite adapter, transactions, migrations, materialized local catalog, and durable outbox.
- `electron/graphql.ts`: remote GraphQL transport adapter.
- `electron/printer.ts`: native Electron printer adapter.
- `electron/session.ts`: OS-backed encrypted credential adapter.
- `electron/ipc.ts` and `electron/preload.ts`: validated delivery boundary. The renderer receives no Node.js access.
- `src`: presentation layer. It calls the typed preload contract only.

## Non-negotiable invariants

1. Checkout, sale lines, stock movements, and outbox insertion commit in one SQLite transaction.
2. A completed local sale is immutable; corrections become explicit future return/void operations.
3. Every outbound mutation is idempotent. Sale numbers and partner/local proposal IDs are stable keys.
4. Tracked products cannot sell below zero. Unlimited products do not create stock movements.
5. A register cannot transact after its signed-in offline lease expires until server synchronization renews it.
6. Category and product-type records are server governed. Local additions are proposals until approved or merged.
7. Device keys cannot be transferred between partners and revoked devices cannot reactivate themselves.
8. Refresh tokens are encrypted by the operating system and never exposed to renderer code.

## Sync protocol

The outbox is pushed oldest-first. Successful idempotent writes are marked synced; failures use bounded retry backoff. A successful pull replaces only server-owned catalog projections, preserves local sales and movements, updates proposal decisions and online orders, and renews the seven-day offline lease.

## Local operations

Numbered transactional migrations are recorded in `schema_migrations`. The local domains include catalog projections, vendor products, immutable sale and profit snapshots, cash sessions, stock movements, online orders, catalog proposals, and the durable synchronization outbox.

Inventory combines grouped product editing, catalog activation, and movement auditing. Revenue, cost, gross profit, partner fees, and net profit are snapshotted during checkout so historical reports are stable when prices or fees later change.

## Localization and branding

English and Arabic share one translation layer, switch document direction for RTL, and use IBM Plex Sans Arabic. Theme, primary color, store logo, receipt footer, and printer choice are persisted locally. Server and device details are intentionally hidden from normal sign-in and remain infrastructure settings.

## Release strategy

Windows x64 is the first supported production target because receipt and invoice printer drivers are managed by Windows. Releases use signed NSIS installers. Database migrations are additive and run automatically before the application window opens.
