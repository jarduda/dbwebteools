# TableSpace — DbWebTools

A responsive MariaDB record-management workspace with a separate **ASP.NET Core 9 API** and **React 19 + TypeScript + Vite frontend**.

## Features

- Discover existing MariaDB tables without modifying their schema; browse, search, sort, and paginate records.
- Create, update, and delete with parameterized values, schema-validated identifiers, composite primary keys, and optimistic concurrency checks.
- Users, administrator/member roles, disable accounts, reset passwords, and revoke active sessions on account changes.
- Multiple database connections with encrypted passwords, connection testing, verified TLS by default.
- Deny-by-default per-user, per-table read/create/update/delete permissions enforced by the API.
- Visual editing layouts: field labels, sections, order, control types, hidden/read-only fields.
- Configurable related-table lookups: searchable selection dialogs, friendly labels, and key-only storage.
- Recent record-change activity without recording sensitive field values.
- Responsive interface, keyboard-accessible dialogs, loading states, inline errors, and deletion confirmation.

## Quick start

Install .NET SDK 9 and Node.js 22.12+ (or Node 24).

```bash
cp .env.example .env
# Edit .env locally and set a unique BOOTSTRAP_PASSWORD (14+ characters).
# For localhost HTTP testing ONLY, set APP_ENVIRONMENT=Development.
docker compose up --build
```

Open **http://localhost:8080** for local development. Sign in as `admin` with your configured bootstrap password. Add a connection in **Administration → Connections**; choose the database server hostname reachable from the API container (not `localhost` unless the DB runs in that container). Then browse records or configure users, table access, and editor layouts.

For production, keep `APP_ENVIRONMENT=Production` and terminate HTTPS at a trusted reverse proxy in front of the loopback-bound web port. Production authentication cookies require HTTPS. Do not publish the API directly to the Internet. Back up the `app-data` volume, including encryption keys, and restrict access to it. Bootstrap settings are only used when there are no users; remove the bootstrap password after provisioning.

### Development without Docker

Supply `Bootstrap__Password` through your local environment or .NET user-secrets; do not commit it.

```bash
# Terminal 1 (after setting the bootstrap password locally)
ASPNETCORE_ENVIRONMENT=Development dotnet run --project backend/DbWeb.Api --no-launch-profile --urls http://localhost:5188
# Terminal 2
cd frontend
npm ci
npm run dev
```

Open the Vite URL. Vite proxies `/api` to port 5188, so browser API access stays same-origin. There is intentionally no permissive CORS policy.

## Related-table lookups

1. Open **Administration → Editor layouts**, select the connection and source table, and change the relation column's control to **lookup**.
2. In its relation configuration, select the **Related table**, **Stored key**, **Display value**, and optional **Additional search columns**. Save the layout.
3. In the record editor, click **Choose…** to open the record-selection window. Search matches the key, display column, and selected extra columns. Select a row to populate the relation; only its key is saved to MariaDB.

For example, configure `orders.customer_id` to look up `customers.id`, display `customers.name`, and search `customers.email`. The grid and editor show the customer's name; the editor also shows the stored key for disambiguation. Existing relations resolve automatically. Cancel leaves the original selection intact; **Clear** stores NULL for nullable columns. Results are paginated and searchable, and large integer keys retain their exact precision.

Lookups target tables in the **same configured database connection** and require a non-null **single-column primary or unique key** with a compatible source type. Composite-key lookups and multi-column relation mappings are not supported. Existing composite-key CRUD is unchanged. Configuration is stored in existing layout JSON; no application-data migration is required.

Users need **read permission on both source and related tables** to search or resolve related values, plus the usual source create/update permission to save. Without target read access, the grid retains the source key but never exposes related values. Invalid or missing selections are rejected by the API. Layouts do not create or alter database foreign-key constraints: keep actual foreign keys for transactional referential integrity, including changes made outside this application. Search treats `%` and `_` literally; it never executes user SQL.

## Build and test

```bash
./scripts/build.sh
# Windows:
./scripts/build.ps1
```

The scripts restore locked dependencies, build with warnings as errors, run backend and frontend tests, and publish independent artifacts into `artifacts/api` and `artifacts/web`.

To exercise real MariaDB CRUD locally, set `MARIADB_TEST_CONNECTION` to a connection string for a **disposable test database**, then run the script. The integration tests create and drop only randomly named test tables. CI always requires and runs this test against a MariaDB service. Without this environment variable, local runs do not exercise the database integration scenario.

## Architecture

```text
frontend/                React/TypeScript SPA, editor, administration, nginx image
backend/DbWeb.Api/        HTTP API, authentication/authorization, application metadata
  Models.cs              EF Core SQLite application metadata (never target data)
  DatabaseService.cs     MariaDB schema inspection and transactional record operations
  Program.cs             Composition root and authenticated endpoint mappings
tests/DbWeb.Tests/        HTTP security tests and real MariaDB integration test
scripts/                 Bash and PowerShell build entrypoints
.github/workflows/       PR validation, release artifacts, container publication
```

Authentication uses PBKDF2 password hashing through ASP.NET Core PasswordHasher, HTTP-only SameSite cookies, antiforgery tokens on all API mutations (including login), and login rate limiting. Passwords for target databases use ASP.NET Core Data Protection. Only administrators may configure target hosts; deploy with network egress restricted to intended database servers. Use dedicated least-privilege database accounts with only the required SELECT/INSERT/UPDATE/DELETE privileges.

Table names and column identifiers are validated against `information_schema` and safely quoted. Values are parameters. Updates/deletes require the full primary key and a record version checked inside a transaction with `SELECT ... FOR UPDATE`. Tables without primary keys are read-only; views are not exposed. Large integer and decimal values are transported as strings to preserve precision; binary values use base64. Defaulted fields omitted from create requests retain their database default.

Layouts are presentation settings, **not column-level security**. Table grants protect all columns in a table. MariaDB transactional tables (InnoDB) are required for reliable concurrency guarantees. Foreign keys and database constraints are enforced by MariaDB; schema editing and file attachments are outside this release. Application metadata currently uses a single SQLite instance; scale the application as a single replica and use migrations before evolving its schema. The activity log and target database are separate stores, not a distributed atomic audit ledger.

## CI/CD and contributing

Every pull request runs release builds, backend authorization/CSRF tests, frontend editor tests, and real MariaDB CRUD/concurrency validation. Successful builds upload separate deployment artifacts. Every PR also validates both container builds. A version tag (`v*`) validates first, then builds and publishes commit-SHA-tagged API/web images to GitHub Container Registry. No external production deployment target is assumed.

Use feature branches and pull requests for subsequent changes; never commit credentials or application data. Configure branch protection to require the `validate` job before merging.
