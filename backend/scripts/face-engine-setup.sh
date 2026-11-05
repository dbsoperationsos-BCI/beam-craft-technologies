#!/usr/bin/env bash
#
# The face engine's Python environment, made or brought up to date, then proved to work.
#
#   bash backend/scripts/face-engine-setup.sh [--skip-if-disabled] [--no-check]
#
# Run by deploy.yml on every deploy, before the backend's own dependencies, so a server never
# again needs `pip install` by hand: it creates backend/.venv-face if it is missing (or broken),
# installs backend/requirements-face.txt into it, and then asks face_engine.py --check to import
# every package, fetch the two model files and run one detection. The deploy fails here, with the
# running application untouched, rather than after PM2 has restarted onto an engine that cannot
# start. The same script is the manual repair on a server where the engine says "offline".
#
# --skip-if-disabled   do nothing (exit 0) when backend/.env does not set AI_FACE_ENGINE_ENABLED=true,
#                      so a server that does not run face recognition installs nothing for it
# --no-check           install only; skip the import / model / inference validation
#
# The environment is the face engine's alone. The call-transcript engine (faster-whisper) has its
# own at the repository root (.venv); nothing here reads or writes that.
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${FACE_ENGINE_VENV:-$BACKEND_DIR/.venv-face}"
REQUIREMENTS="$BACKEND_DIR/requirements-face.txt"
ENGINE="$BACKEND_DIR/src/modules/ai-feature/face-engine/face_engine.py"
ENV_FILE="$BACKEND_DIR/.env"

SKIP_IF_DISABLED=0
RUN_CHECK=1
for arg in "$@"; do
  case "$arg" in
    --skip-if-disabled) SKIP_IF_DISABLED=1 ;;
    --no-check) RUN_CHECK=0 ;;
    *) printf '[face-engine] unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

log() { printf '[face-engine] %s\n' "$*"; }
fail() { printf '[face-engine] ERROR: %s\n' "$*" >&2; exit 1; }

# One value out of backend/.env, without sourcing it: it holds secrets and may hold values that are
# not valid shell. Quotes around the value are stripped; a missing key answers nothing.
env_value() {
  local key="$1"
  [[ -r "$ENV_FILE" ]] || return 0
  sed -n "s/^[[:space:]]*${key}=//p" "$ENV_FILE" | tail -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/" | tr -d '\r'
}

[[ -f "$REQUIREMENTS" ]] || fail "requirements file not found: $REQUIREMENTS"
[[ -f "$ENGINE" ]] || fail "engine script not found: $ENGINE"

if [[ "$SKIP_IF_DISABLED" -eq 1 ]]; then
  # Lower-cased with tr rather than ${var,,}: that is bash 4 syntax, and a macOS developer's bash is 3.2.
  ENABLED="$(env_value AI_FACE_ENGINE_ENABLED | tr '[:upper:]' '[:lower:]')"
  if [[ "$ENABLED" != "true" ]]; then
    log "AI_FACE_ENGINE_ENABLED is not \"true\" in $ENV_FILE - face recognition is off on this server; nothing to install."
    exit 0
  fi
fi

# --- which Python makes the environment ----------------------------------------------------------
# The newest interpreter the machine has that carries the venv module. FACE_ENGINE_PYTHON wins
# outright when set. The interpreter only matters when the environment is created; afterwards the
# environment's own python3 is what runs the engine.
pick_python() {
  if [[ -n "${FACE_ENGINE_PYTHON:-}" ]]; then
    printf '%s' "$FACE_ENGINE_PYTHON"; return 0
  fi
  local candidate
  for candidate in python3.13 python3.12 python3.11 python3.10 python3.9 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys, venv, ensurepip; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
      command -v "$candidate"; return 0
    fi
  done
  return 1
}

venv_is_healthy() {
  [[ -x "$VENV_DIR/bin/python3" ]] && "$VENV_DIR/bin/python3" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1
}

# --- 1. the virtual environment -------------------------------------------------------------------
if venv_is_healthy; then
  log "using existing environment $VENV_DIR ($("$VENV_DIR/bin/python3" --version 2>&1))"
else
  if [[ -e "$VENV_DIR" ]]; then
    log "environment at $VENV_DIR does not run (its interpreter was upgraded or removed); recreating it"
    rm -rf "$VENV_DIR"
  fi
  PYTHON="$(pick_python)" || fail "no python3 (>= 3.9) with the venv module was found. On Ubuntu/Debian: sudo apt install python3 python3-venv   - or set FACE_ENGINE_PYTHON to the interpreter to use."
  log "creating $VENV_DIR with $PYTHON ($("$PYTHON" --version 2>&1))"
  "$PYTHON" -m venv "$VENV_DIR" || fail "could not create the virtual environment. On Ubuntu/Debian the venv module is a separate package: sudo apt install python3-venv"
fi
PY="$VENV_DIR/bin/python3"

# --- 2. the packages -------------------------------------------------------------------------------
# pip itself first, so wheels for the newer package builds resolve; then everything in the
# requirements except insightface; then insightface without its dependencies - see the note at
# the top of requirements-face.txt for why (it would otherwise pull the desktop OpenCV in).
log "installing requirements from $REQUIREMENTS"
"$PY" -m pip install --quiet --disable-pip-version-check --upgrade pip wheel setuptools \
  || fail "could not upgrade pip inside $VENV_DIR"
WITHOUT_INSIGHTFACE="$(mktemp)"
trap 'rm -f "$WITHOUT_INSIGHTFACE"' EXIT
grep -v -E '^[[:space:]]*insightface([[:space:]=<>!~]|$)' "$REQUIREMENTS" > "$WITHOUT_INSIGHTFACE"
"$PY" -m pip install --quiet --disable-pip-version-check -r "$WITHOUT_INSIGHTFACE" \
  || fail "pip could not install the face engine's packages. The messages above say which; a wheel that is missing for this Python usually means the server's python3 is too old or too new for that package."
INSIGHTFACE_SPEC="$(grep -E '^[[:space:]]*insightface([[:space:]=<>!~]|$)' "$REQUIREMENTS" | head -1 | sed 's/[[:space:]]*#.*$//' | tr -d '[:space:]')"
[[ -n "$INSIGHTFACE_SPEC" ]] || fail "requirements-face.txt names no insightface line"
"$PY" -m pip install --quiet --disable-pip-version-check --no-deps "$INSIGHTFACE_SPEC" \
  || fail "pip could not install $INSIGHTFACE_SPEC"
log "packages installed"

# --- 3. prove it -----------------------------------------------------------------------------------
# The engine's own check: import every package, fetch the model files from the Hub if they are not
# on disk yet, load the models and run one detection. The model settings the server runs with are
# read from backend/.env so the files land where the engine will look for them at runtime.
if [[ "$RUN_CHECK" -eq 1 ]]; then
  for key in AI_FACE_MODEL_REPO AI_FACE_MODEL_NAME AI_FACE_DET_SIZE INSIGHTFACE_HOME HF_HOME HF_ENDPOINT HTTPS_PROXY HTTP_PROXY; do
    value="$(env_value "$key")"
    [[ -n "$value" ]] && export "$key=$value"
  done
  log "validating imports, model files and inference with $PY"
  if REPORT="$("$PY" "$ENGINE" --check)"; then
    log "ready: $REPORT"
  else
    printf '%s\n' "${REPORT:-}" >&2
    fail "the face engine cannot run in $VENV_DIR - see the report above. Model files download from the Hugging Face Hub on first run; a server without outbound HTTPS needs them copied into \$INSIGHTFACE_HOME/models/<name>/ by hand."
  fi
fi

log "environment ready at $VENV_DIR"
