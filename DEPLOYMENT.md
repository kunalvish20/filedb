# Deploying to Vercel

## Easiest first-time database setup

This application uses MongoDB. Supabase provides PostgreSQL and requires a
database-layer migration before it can replace MongoDB here.

1. Open the [MongoDB Atlas integration in Vercel](https://vercel.com/marketplace/mongodbatlas/atlas)
   and click **Install**.
2. Select the **Free** cluster tier and the **Free ($0)** installation plan.
   Set the database name to `spilofila`, choose a region, and create the cluster.
3. When the resource becomes **Available**, connect it to the Vercel project
   serving your site's actual domain. If you have several projects imported
   from this repository, connecting one does not configure the others.
4. In that project's **Settings → Environment Variables**, confirm that the
   integration added `MONGODB_URI` for **Production** (and Preview if used).
   The integration creates the URI for you; do not paste it into source code.
5. Redeploy the latest `main` deployment. Environment changes take effect on
   the new deployment.
6. Open `/api/health`. A working connection returns `{"status":"ready"}`.
   Then open `/filaments/new`, enter a name, vendor, material, and cost, and save.
   The new filament should appear in the Filaments list.

The integration provisions database access and network settings automatically.
See the [official integration instructions](https://www.mongodb.com/docs/atlas/reference/partner-integrations/vercel/).

## Connecting an existing MongoDB Atlas database

1. Import `kunalvish20/filedb`, select the `main` branch, and leave the root
   directory at the repository root. Use the **Next.js** framework preset.
2. Add `MONGODB_URI` in **Settings → Environment Variables** for Production
   and Preview. Use a MongoDB Atlas connection string with a database name
   and a database user that can read and write that database. Allow the
   deployment to reach Atlas in the cluster's Network Access settings.
   `.env.local` stays on your computer and is never uploaded by Git.
3. Deploy the latest commit on `main`. Redeploying the old `f087d5c` deployment
   rebuilds that old source and does not include the installation fix.

The committed `vercel.json` supplies the install and build commands. Keep
Output Directory at its framework default. Node.js 24 is supported and is
selected by the package's engine range on Vercel. The install uses the lockfile,
includes the tools needed to build CSS, and skips downloads of Electron and
test-only MongoDB binaries. The desktop NFC driver is optional, so a missing
native PC/SC library cannot fail the web installation. React peer-dependency
warnings from Swagger's older transitive packages are non-fatal.

After deploying, open `/`, `/dashboard`, `/settings/ui`, and `/api/openapi`.
`/api/filaments` should return a JSON array when the database is connected.
Check Runtime Logs for database authentication or network access errors.

## Access and environment variables

This is a single-user application with no browser sign-in. Protect a hosted
instance with authenticated access, such as Vercel Deployment Protection
covering its production domains, before connecting private inventory data.
The existing `SPILOFILA_API_KEY` / `FILAMENTDB_API_KEY` gate is for API clients:
setting it blocks the browser UI's API requests because the UI does not send
that key. Leave those variables unset when using the browser interface behind
deployment-level authentication.

AI keys (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) are optional.
Store them in Vercel Environment Variables when using the AI extraction API.
Never prefix database credentials or AI keys with `NEXT_PUBLIC_`.

## Hosting limits

- USB NFC readers, local label printers, embedded MongoDB, and desktop sync
  require the Electron application. The hosted browser app uses Atlas.
- The live NFC scan relay uses a process-local event bus. Use the desktop or
  a persistent Node.js server for this integration; it cannot reliably relay
  events between separate Vercel function instances.
- Vercel Functions have a 4.5 MB request/response payload limit. Large snapshot
  restores and exports need a local/Docker instance or an object-storage upload
  flow; increasing Next.js's proxy limit does not raise Vercel's limit.

References: [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json),
[Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions),
[function limits](https://vercel.com/docs/functions/limitations).
