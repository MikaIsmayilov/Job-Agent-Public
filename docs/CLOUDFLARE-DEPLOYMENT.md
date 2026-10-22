# Optional: deploy your dashboard to Cloudflare

By default the dashboard runs on your computer (`pnpm dev`). Deploying it to
your own Cloudflare account adds phone and other-computer access and a cloud
mail check every 3 hours. It is optional and costs the Workers Paid plan
(about $5 a month; the Free plan's 10 ms CPU cap is too small for the page).

The cloud copy starts empty: jobs in your local database are not moved. The
easiest time to switch is right after `/onboard`, before your first big scrape.

## 1. Create the Worker and database

```bash
pnpm exec wrangler login
pnpm exec wrangler whoami                       # note your account id
pnpm exec wrangler d1 create job-agent-db       # note the database_id
```

Put both ids in `deploy.cloudflare.json` (`account_id`, and `database_id` under
`d1_databases`). Change `name` if you want a different Worker name (it becomes
`<name>.<your-subdomain>.workers.dev`; also change `--name` in
`scripts/push-mail-secrets.sh`). Tables are created automatically on first use.

## 2. Protect it with Cloudflare Access

The dashboard holds your resume and applications, so it must never be public.
The Worker refuses every request (503) until Access is configured.

1. Cloudflare dashboard → Zero Trust (the free plan is enough) → note your
   team domain, `<team>.cloudflareaccess.com`.
2. Access → Applications → Add → Self-hosted. Domain: your
   `<name>.<subdomain>.workers.dev` hostname, covering the whole site. Policy:
   Allow, include your own email only.
3. Copy the application's **AUD tag**.
4. Access → Service credentials → Service Tokens → create one for the scraper
   (it is shown once). Add a second policy to the application: Service Auth,
   include that token.
5. In `deploy.cloudflare.json` set `ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`)
   and `ACCESS_AUD`. Keep `REQUIRE_ACCESS` as `"true"`.
6. In `.env` add `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` from the
   service token. Never put them in config files or commands.

## 3. Secrets and deploy

```bash
# the same INGEST_TOKEN as in .env, typed or pasted at the prompt
pnpm exec wrangler secret put INGEST_TOKEN --name job-agent
# optional cloud mail check (needs GMAIL_* in .env)
bash scripts/push-mail-secrets.sh

pnpm test && bash scripts/prep-remote-deploy.sh && pnpm exec wrangler deploy --config dist/server/wrangler.json
```

`prep-remote-deploy.sh` checks that the built config matches
`deploy.cloudflare.json`, that Access is required, and that the token is not
embedded.

## 4. Point the scraper and skills at it

Set `server.base_url` in `scraper/config.yml` to your `https://…workers.dev`
URL. The scraper, the mail check and every skill then read and write the cloud
dashboard through `jobagent_scraper.api`, sending the Access service token. The
local mail schedule automatically stands down while the cloud mail cron is
healthy and takes over if it stops.

Open the URL in a browser and sign in with your email (one-time code).

## Going back to local

If you stop paying for Workers Paid: stop `pnpm dev`, run `pnpm db:pull` (copies
the cloud database over the local one, keeping the old file in
`.wrangler/backups/`; `bash scripts/pull-cloud-db.sh --check` only reports),
set `server.base_url` back to `http://localhost:3000`, and run `pnpm dev`. The
copy is one way.
