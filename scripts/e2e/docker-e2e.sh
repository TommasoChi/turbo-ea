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
# 127.0.0.1:18444 (TLS). Override with E2E_HOST_PORT / E2E_TLS_PORT. Both are validated and
# normalised to decimal ("08920" is 8920) before any docker or curl call: a number from 1024 to
# 65535 that is not a port of another instance or of the
# dev servers (FORBIDDEN_PORTS). `test` also requires the tea-e2e nginx container to publish exactly
# the chosen port, so a port that merely answers /api/health is never driven.
# Compose prefers an exported shell variable to --env-file, so stack() runs compose under `env -u`
# for every variable the compose files interpolate (derived by grep, so a new one is covered) and
# for COMPOSE_*: an exported SMTP_*, AI_PROVIDER_URL, NVD_API_KEY, proxy-auth secret or TURBO_EA_TAG
# never reaches the "isolated" stack. Only e2e.env and the values set below are passed.
# The tests run in the official Playwright image pinned by digest (v1.63.0-noble, the
# @playwright/test version of package-lock.json; the script refuses a lockfile that moved on), with
# npm pinned to the exact version that image resolves. frontend/ is mounted; node_modules lives in
# the named volume tea-e2e-nm. E2E_PW_IMAGE overrides the image (with a warning).
# E2E_PML_DISPOSABLE=1 lets the specs write into the throwaway stack (and nowhere else): the specs
# accept only E2E_BASE_URL on the stack's own port (E2E_HOST_PORT, passed into the container).
# Reports land in frontend/playwright-report and frontend/test-results (git-ignored).
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
# mcr.microsoft.com/playwright:v1.63.0-noble. To bump: docker pull <tag>, then
# docker image inspect --format '{{index .RepoDigests 0}}' <tag>, and the npm that image resolves
# (docker run --entrypoint bash <tag> -c 'npx -y npm@11 --version').
PW_PINNED_VERSION="1.63.0"
PW_PINNED_IMAGE="mcr.microsoft.com/playwright@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27"
NPM_PINNED="11.19.0"
PW_IMAGE="${E2E_PW_IMAGE:-$PW_PINNED_IMAGE}"
DEFAULT_SPECS=(e2e/initiative-card-page.spec.ts e2e/ppm-overview.spec.ts e2e/ppm-plan-budget.spec.ts e2e/pml-financials.spec.ts)

usage() { sed -n '3,35p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-1}"; }

# Ports first: nothing below may reach a docker daemon or a port before they are accepted.
FORBIDDEN_PORTS=" 8920 8930 5433 9443 9444 18920 18443 8000 8001 4173 5173 "
# Sets the variable $1 (reported as $2) to the port in decimal ("08920" is 8920, which docker would publish).
check_port() {
    local var="$1" name="$2" value="${!1}"
    if ! [[ "$value" =~ ^[0-9]{1,5}$ ]]; then
        echo "$name=$value: must be a number between 1024 and 65535"; exit 1
    fi
    value=$((10#$value))
    if [ "$value" -lt 1024 ] || [ "$value" -gt 65535 ]; then
        echo "$name=$value: must be a number between 1024 and 65535"; exit 1
    fi
    case "$FORBIDDEN_PORTS" in
        *" $value "*) echo "$name=$value: refused, that port belongs to another instance or the dev servers"; exit 1 ;;
    esac
    printf -v "$var" '%s' "$value"
}
check_port HOST_PORT_E2E E2E_HOST_PORT
check_port TLS_PORT_E2E E2E_TLS_PORT
[ "$HOST_PORT_E2E" != "$TLS_PORT_E2E" ] || { echo "E2E_HOST_PORT and E2E_TLS_PORT must differ"; exit 1; }

[ $# -ge 1 ] || usage
MODE="$1"
shift

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running"; exit 1; }
[ -n "$PW_VERSION" ] || { echo "could not read the @playwright/test version from package-lock.json"; exit 1; }
if [ -n "${E2E_PW_IMAGE:-}" ]; then
    echo "WARNING: E2E_PW_IMAGE=$E2E_PW_IMAGE overrides the digest-pinned Playwright image"
elif [ "$PW_VERSION" != "$PW_PINNED_VERSION" ]; then
    echo "package-lock.json has @playwright/test $PW_VERSION but the image is pinned for $PW_PINNED_VERSION: update PW_PINNED_VERSION, PW_PINNED_IMAGE and NPM_PINNED"
    exit 1
fi

UNSET_VARS=(COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME COMPOSE_ENV_FILES)
while read -r v; do UNSET_VARS+=("$v"); done < <(
    grep -ohE '\$\{[A-Z_0-9]+' "$REPO/docker-compose.yml" "$REPO/scripts/e2e/docker-compose.e2e.yml" | tr -d '${' | sort -u)

stack() {
    local unset_args=() v
    for v in "${UNSET_VARS[@]}"; do unset_args+=(-u "$v"); done
    env "${unset_args[@]}" \
        HOST_PORT="127.0.0.1:$HOST_PORT_E2E" TLS_HOST_PORT="127.0.0.1:$TLS_PORT_E2E" \
        ALLOWED_ORIGINS="http://host.docker.internal:$HOST_PORT_E2E,http://localhost:$HOST_PORT_E2E" \
        TURBO_EA_PUBLIC_URL="http://host.docker.internal:$HOST_PORT_E2E" \
        MCP_PUBLIC_URL="http://host.docker.internal:$HOST_PORT_E2E/mcp" \
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
    # The nginx container of the tea-e2e project must be the one publishing the port.
    if [ -z "$(stack ps -q nginx 2>/dev/null)" ] ||
        [ "$(stack port nginx 8080 2>/dev/null | head -1)" != "127.0.0.1:$HOST_PORT_E2E" ]; then
        echo "the $PROJECT stack is not running on 127.0.0.1:$HOST_PORT_E2E: run scripts/e2e/docker-e2e.sh up first"
        exit 1
    fi
    curl -fsS "http://localhost:$HOST_PORT_E2E/api/health" >/dev/null 2>&1 || {
        echo "the stack is not healthy: run scripts/e2e/docker-e2e.sh up first"; exit 1; }
    [ $# -ge 1 ] || set -- "${DEFAULT_SPECS[@]}"
    echo "==> playwright test $* ($PW_IMAGE, npm $NPM_PINNED)"
    docker run --rm --ipc=host \
        -v "$HOST_REPO/frontend:/work" \
        -v tea-e2e-nm:/work/node_modules \
        -e CI=1 \
        -e NPM_PINNED="$NPM_PINNED" \
        -e E2E_BASE_URL="http://host.docker.internal:$HOST_PORT_E2E" \
        -e E2E_HOST_PORT="$HOST_PORT_E2E" \
        -e E2E_PML_DISPOSABLE=1 \
        --add-host=host.docker.internal:host-gateway \
        "$PW_IMAGE" bash -c '
            set -e
            cd /work
            # The lockfile is written by npm 11; npm ci only when it changed since the last run.
            stamp=$(md5sum package-lock.json | cut -d" " -f1)
            if [ "$(cat node_modules/.e2e-lock 2>/dev/null)" != "$stamp" ]; then
                npx -y "npm@$NPM_PINNED" ci --silent --no-audit --no-fund
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
