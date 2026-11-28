#!/usr/bin/env bash
#
# Run the browser e2e suite (frontend/e2e, Playwright) against an isolated Turbo EA stack.
#
# Usage (from anywhere inside the repository, in Git Bash / bash):
#   scripts/e2e/docker-e2e.sh up              build this tree's images and start the stack (demo data)
#   scripts/e2e/docker-e2e.sh test [ARGS...]  run Playwright in a container; no ARGS = the PPM set
#                                             (initiative-card-page, ppm-overview, ppm-plan-budget,
#                                             pml-financials); ARGS replace it, e.g. `test e2e/login.spec.ts`
#   scripts/e2e/docker-e2e.sh down            remove the stack and its volumes
#   scripts/e2e/docker-e2e.sh all [ARGS...]   up + test + down (down runs even when the tests fail)
#
# What it isolates: its own compose project (tea-e2e), images turboea-e2e-*:local built from the
# working tree, a throwaway database seeded with the demo data (SEED_DEMO=true), and values from
# e2e.env: the repository .env is never read. It touches no container of your own instance
# (turbo-ea-aruba-*, 8920), the VAPT stack (8930), the test database (5433) or the docs stack
# (tea-docs, 18920).
# Ports, bound to loopback only (the demo admin password is public): 127.0.0.1:18930 (HTTP) and
# 127.0.0.1:18444 (TLS). Override with E2E_HOST_PORT / E2E_TLS_PORT.
# The tests run in the official Playwright image (pinned to the @playwright/test version) with
# frontend/ mounted; node_modules lives in the named volume tea-e2e-nm. E2E_PML_DISPOSABLE=1 lets
# the specs write into the throwaway stack (and nowhere else). Reports land in
# frontend/playwright-report and frontend/test-results (git-ignored).
# Cleanup: `down` (the script's `all` mode does it itself); `docker volume rm tea-e2e-nm` also
# drops the npm cache volume.
set -euo pipefail

export MSYS_NO_PATHCONV=1
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
HOST_REPO="$(cd "$REPO" && (pwd -W 2>/dev/null || pwd))"

PROJECT="tea-e2e"
HOST_PORT_E2E="${E2E_HOST_PORT:-18930}"
TLS_PORT_E2E="${E2E_TLS_PORT:-18444}"
PW_VERSION="$(grep -A1 '"node_modules/@playwright/test"' "$REPO/frontend/package-lock.json" | sed -n 's/.*"version": "\([^"]*\)".*/\1/p')"
PW_IMAGE="${E2E_PW_IMAGE:-mcr.microsoft.com/playwright:v${PW_VERSION}-noble}"
DEFAULT_SPECS=(e2e/initiative-card-page.spec.ts e2e/ppm-overview.spec.ts e2e/ppm-plan-budget.spec.ts e2e/pml-financials.spec.ts)

usage() { sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-1}"; }
[ $# -ge 1 ] || usage
MODE="$1"
shift

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running"; exit 1; }
[ -n "$PW_VERSION" ] || { echo "could not read the @playwright/test version from package-lock.json"; exit 1; }

stack() {
    HOST_PORT="127.0.0.1:$HOST_PORT_E2E" TLS_HOST_PORT="127.0.0.1:$TLS_PORT_E2E" \
        docker compose -p "$PROJECT" --env-file "$HOST_REPO/scripts/e2e/e2e.env" \
        -f "$HOST_REPO/docker-compose.yml" -f "$HOST_REPO/scripts/e2e/docker-compose.e2e.yml" "$@"
}

run_up() {
    for svc in db backend frontend nginx mcp-server; do
        echo "==> docker build --target $svc"
        docker build -q --target "$svc" -t "turboea-e2e-$svc:local" "$HOST_REPO"
    done
    echo "==> Starting the isolated stack on 127.0.0.1:$HOST_PORT_E2E (demo data)"
    stack up -d
    echo "==> Waiting for the backend"
    for _ in $(seq 1 120); do
        curl -fsS "http://localhost:$HOST_PORT_E2E/api/health" >/dev/null 2>&1 && break
        sleep 5
    done
    curl -fsS "http://localhost:$HOST_PORT_E2E/api/health" >/dev/null || {
        echo "stack did not become healthy"; stack logs --tail 50 backend; exit 1; }
}

run_test() {
    curl -fsS "http://localhost:$HOST_PORT_E2E/api/health" >/dev/null 2>&1 || {
        echo "the stack is not up: run scripts/e2e/docker-e2e.sh up first"; exit 1; }
    [ $# -ge 1 ] || set -- "${DEFAULT_SPECS[@]}"
    echo "==> playwright test $* ($PW_IMAGE)"
    docker run --rm --ipc=host \
        -v "$HOST_REPO/frontend:/work" \
        -v tea-e2e-nm:/work/node_modules \
        -e CI=1 \
        -e E2E_BASE_URL="http://host.docker.internal:$HOST_PORT_E2E" \
        -e E2E_PML_DISPOSABLE=1 \
        --add-host=host.docker.internal:host-gateway \
        "$PW_IMAGE" bash -c '
            set -e
            cd /work
            # The lockfile is written by npm 11; npm ci only when it changed since the last run.
            stamp=$(md5sum package-lock.json | cut -d" " -f1)
            if [ "$(cat node_modules/.e2e-lock 2>/dev/null)" != "$stamp" ]; then
                npx -y npm@11 ci --silent --no-audit --no-fund
                echo "$stamp" > node_modules/.e2e-lock
            fi
            npx playwright test "$@"' _ "$@"
}

case "$MODE" in
    up) run_up ;;
    test) run_test "$@" ;;
    down) stack down -v ;;
    all)
        trap 'stack down -v >/dev/null 2>&1 || true' EXIT
        run_up
        run_test "$@"
        ;;
    *) usage ;;
esac
