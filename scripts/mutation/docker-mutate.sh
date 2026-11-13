#!/usr/bin/env bash
#
# Run the Python mutation suites (mutmut) inside Linux containers.
#
# Why: mutmut_scope.py builds a symlinked mirror of the repository
# (shadow_root.py), which Windows refuses without a privilege (WinError 1314).
# A Linux container does not. The test database is a throwaway Postgres on a
# private Docker network; nothing touches your own instance.
#
# Usage (from anywhere inside the repository, in Git Bash / bash):
#   scripts/mutation/docker-mutate.sh mcp     turbo_ea_mcp/oauth.py
#   scripts/mutation/docker-mutate.sh backend app/services/resource_service.py
#   scripts/mutation/docker-mutate.sh diff    [BASE]     # backend + MCP, scored like the PR gate
#   scripts/mutation/docker-mutate.sh shell              # a shell in the work volume (mutmut browse...)
#   scripts/mutation/docker-mutate.sh clean              # remove the volumes (stats cache and virtualenv)
#
# Several FILEs may be given to mcp / backend. The frontend (Stryker) needs no
# symlinks: run `npx stryker run --mutate ...` from frontend/ as usual.
#
# The work volume keeps the virtualenv and mutmut's stats/mutants cache, so only
# the first run pays for the serial stats pass over the suite. The repository is
# copied into it on every run (tar, so the cache survives); uncommitted changes
# are included, as they are for `make mutation-*`.
#
# Local runs are for a human at a keyboard: an unattended agent must not start
# them (CLAUDE.md, Testing Conventions).
set -euo pipefail

PY_IMAGE="${MUTATION_PY_IMAGE:-python:3.12}"
PG_IMAGE="${MUTATION_PG_IMAGE:-postgres:16-alpine}" # what CI's mutation jobs use
VOLUME="tea-mut-work"
NETWORK="tea-mut-net"
PG_NAME="tea-mut-pg"

# Git Bash would rewrite /paths in docker arguments into C:/Program Files/...
export MSYS_NO_PATHCONV=1

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
HOST_REPO="$(cd "$REPO" && (pwd -W 2>/dev/null || pwd))"

usage() { sed -n '3,24p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-1}"; }

[ $# -ge 1 ] || usage
MODE="$1"
shift

command -v docker >/dev/null || { echo "docker not found"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running"; exit 1; }

if [ "$MODE" = "clean" ]; then
    docker volume rm "$VOLUME" tea-mut-venv >/dev/null 2>&1 && echo "removed $VOLUME and tea-mut-venv" || echo "no volume to remove"
    exit 0
fi

case "$MODE" in
    mcp | backend) [ $# -ge 1 ] || { echo "$MODE needs at least one FILE"; usage; } ;;
    diff | shell) ;;
    *) usage ;;
esac

cleanup() {
    docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

echo "==> Starting the test database ($PG_IMAGE)"
docker network create "$NETWORK" >/dev/null
docker run -d --name "$PG_NAME" --network "$NETWORK" \
    -e POSTGRES_USER=turboea -e POSTGRES_PASSWORD=turboea -e POSTGRES_DB=turboea_test \
    "$PG_IMAGE" >/dev/null
for _ in $(seq 1 30); do
    docker exec "$PG_NAME" pg_isready -U turboea -d turboea_test >/dev/null 2>&1 && break
    sleep 1
done

# What runs inside the container. Quoted heredoc: nothing here expands on the host.
read -r -d '' INNER <<'EOS' || true
set -euo pipefail
cd /work
echo "==> Copying the repository into the work volume"
tar -C /src -cf - \
    --exclude=node_modules --exclude=venv --exclude=.venv --exclude=__pycache__ \
    --exclude=mutants --exclude=.mutation --exclude=.superpowers --exclude=graphify-out \
    --exclude=frontend/reports --exclude=frontend/coverage --exclude=frontend/dist . \
    | tar -xf -
git config --global --add safe.directory /work
if [ ! -x /venv/bin/python ]; then python -m venv /venv; fi
STAMP="$(cat backend/pyproject.toml mcp-server/pyproject.toml | sha256sum | cut -d' ' -f1)"
if [ "$(cat /venv/.stamp 2>/dev/null)" != "$STAMP" ]; then
    echo "==> Installing dependencies (first run, or a pyproject changed)"
    /venv/bin/pip install --quiet -e "backend[dev]" -e "mcp-server[dev]"
    echo "$STAMP" > /venv/.stamp
fi
export PATH="/venv/bin:$PATH"
export POSTGRES_HOST="$PG_HOST" POSTGRES_PORT=5432 POSTGRES_USER=turboea
export POSTGRES_PASSWORD=turboea TEST_POSTGRES_DB=turboea_test TEST_DB_REQUIRED=1 PYTHONUTF8=1
case "$MODE" in
    mcp | backend)
        for f in "$@"; do make "mutation-$MODE" FILE="$f"; done
        ;;
    diff)
        BASE="${1:-origin/main}"
        python scripts/mutation/changed_lines.py --base "$BASE" --output mutation-changed.json -- backend/app mcp-server/turbo_ea_mcp
        for s in backend mcp; do
            python scripts/mutation/mutmut_scope.py run --suite "$s" --changed mutation-changed.json
            python scripts/mutation/mutmut_scope.py collect --suite "$s" --changed mutation-changed.json --output "mutation-$s.json"
            python scripts/mutation/gate.py --suite "$s" --scope diff --records "mutation-$s.json"
        done
        ;;
    shell)
        exec bash
        ;;
esac
EOS

TTY=()
[ "$MODE" = "shell" ] && TTY=(-it)

echo "==> Running: $MODE $*"
docker run --rm "${TTY[@]}" --network "$NETWORK" \
    -v "$VOLUME:/work" -v "tea-mut-venv:/venv" \
    -v "$HOST_REPO:/src:ro" \
    -e MODE="$MODE" -e PG_HOST="$PG_NAME" \
    "$PY_IMAGE" bash -c "$INNER" _ "$@"
