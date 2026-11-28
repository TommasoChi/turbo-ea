# Browser e2e in an isolated stack

`docker-e2e.sh` runs the Playwright suite (`frontend/e2e/`) against a Turbo EA stack built from the
working tree, in its own compose project, with a throwaway database seeded with the demo data. It
exists for specs that write data (the Initiative pages, `pml-financials`), which must never run
against your own instance. The CI job (`Frontend E2E`) does not use it: CI runs the read-mostly
suite against `vite preview` and a backend on `:8000` (`make e2e`).

## Run it

```bash
scripts/e2e/docker-e2e.sh up                       # build the five images, start the stack (about 5 to 10 minutes cold)
scripts/e2e/docker-e2e.sh test                     # the PPM set: initiative-card-page, ppm-overview, ppm-plan-budget, pml-financials
scripts/e2e/docker-e2e.sh test e2e/login.spec.ts   # any other args replace the default set
scripts/e2e/docker-e2e.sh down                     # remove the stack and its volumes
scripts/e2e/docker-e2e.sh all                      # up + test + down (down runs even if the tests fail)
make e2e-stack                                     # the same as `all`; ARGS="e2e/x.spec.ts" picks specs
```

After a change to the frontend or backend, run `up` again (the images rebuild from the tree and the
changed containers are recreated), then `test`. The report is `frontend/playwright-report/`, traces and
screenshots of failures are in `frontend/test-results/` (both git-ignored).

## What it isolates

| What | Value |
|------|-------|
| Compose project | `tea-e2e` (`docker compose -p tea-e2e` only) |
| Images | `turboea-e2e-{db,backend,frontend,nginx,mcp-server}:local`, built with `docker build --target` |
| Ports | `127.0.0.1:18930` (HTTP), `127.0.0.1:18444` (TLS); `E2E_HOST_PORT` / `E2E_TLS_PORT` override, validated (below) |
| Secrets, `SEED_DEMO=true` | `e2e.env`, passed with `--env-file`; the repository `.env` is never read |
| Allowed origins, public and MCP URLs | derived from `E2E_HOST_PORT` by the script, so a port override stays consistent |
| Environment | compose runs under `env -u` for every variable the compose files interpolate (derived by grep) and `COMPOSE_*`, so an exported `SMTP_*`, `AI_PROVIDER_URL`, `NVD_API_KEY`, `TURBO_EA_PROXY_AUTH_*` or `TURBO_EA_TAG` never reaches the stack: compose prefers an exported variable to `--env-file` |
| Test runner | `mcr.microsoft.com/playwright:v1.63.0-noble` pinned by digest (`PW_PINNED_IMAGE`), npm pinned to `11.19.0` (`NPM_PINNED`), `frontend/` mounted, `node_modules` in the volume `tea-e2e-nm` |

## Guards

- **Ports**: `E2E_HOST_PORT` and `E2E_TLS_PORT` must be numbers from 1024 to 65535, differ from each
  other and not be one of `8920 8930 5433 9443 9444 18920 18443 8000 8001 4173`. The script exits
  before any docker or curl call. `test` also requires the `tea-e2e` nginx container to publish
  exactly `127.0.0.1:<port>`; a port that merely answers `/api/health` is refused.
- **Specs** (`isDisposableTarget`, `frontend/scripts/disposable-target.ts`, called by
  `requireDisposableStack()`): a base URL on port 8920, 8930 or 18920 is always refused, flag or not;
  any other `E2E_BASE_URL` needs `E2E_PML_DISPOSABLE=1`; with `E2E_BASE_URL` unset the suite runs
  only under `CI` (the CI job: `vite preview` and a throwaway seeded database) or with the flag.
  `pml-financials.spec.ts` uses the same guard.
- **Pins**: bumping `@playwright/test` makes the script stop until `PW_PINNED_VERSION`,
  `PW_PINNED_IMAGE` (`docker image inspect --format '{{index .RepoDigests 0}}' <tag>` after a pull)
  and `NPM_PINNED` (`npx -y npm@11 --version` inside the image) are updated. `E2E_PW_IMAGE` still
  overrides the image and prints a warning.

It does not touch your instance (`turbo-ea-aruba-*`, `:8920`), the VAPT stack (`:8930`), the test
database (`:5433`) or the docs stack (`tea-docs`, `:18920`). The demo admin is `admin@turboea.demo`
(public password), which is why the ports are bound to loopback.

## Add a spec

1. Put `<name>.spec.ts` in `frontend/e2e/`; import `test` and `expect` from `./fixtures` (the coverage
   `page` fixture and the `demo` lookups live there), labels through `t("ns:key")` from `./i18n`.
2. Create what the test needs through the API with `Scratch` (`ppm-support.ts`: an Initiative with
   budgets, costs, reports and risks, a Provider card, a throwaway user) and `dispose()` it in a
   `finally` or `afterAll`. A test that writes calls `requireDisposableStack()` first.
3. Every wait is a web-first assertion or `expect.poll`, never a sleep; scope row assertions to their
   own table or region. Run it alone: `scripts/e2e/docker-e2e.sh test e2e/<name>.spec.ts`.
4. To run it by default, add it to `DEFAULT_SPECS` in `docker-e2e.sh`.

The Initiative pages feature owes at least 10 tests per page: `initiative-card-page.spec.ts` (the card
page), `ppm-overview.spec.ts` (the PPM Overview), `ppm-plan-budget.spec.ts` (the Plan Budget table).
Keep each at 10 or more when you change that page.

## Troubleshooting

- **`the stack is not up`**: run `up` first; `test` needs the `tea-e2e` nginx container publishing the port, and `/api/health` answering.
- **A first test times out on a cold start**: the specs warm the page in `beforeAll` (`warmUp`); a
  cold first load took 25 s against 5 to 10 s afterwards.
- **A donut's centre total or legend cannot be read from the DOM**: ECharts draws it in a canvas.
  `installChartTextProbe` records every string the canvas draws; read it with `lastNumberDrawn` and
  click a legend entry with `clickChartText`.
- **`npm ci` fails with "not in sync"**: the lockfile is written by npm 11, which the script
  installs with `npx npm@11`; remove the volume (`docker volume rm tea-e2e-nm`) to force a clean install.
- **Leftovers**: `docker ps -a --filter name=tea-e2e` must be empty after `down`. `docker volume ls
  --filter name=tea-e2e` lists the volumes (`down -v` removes the compose ones; `tea-e2e-nm` is the npm cache).
