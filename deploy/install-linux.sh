#!/usr/bin/env bash
# One-shot install of Projektor on a Linux box with Docker. Idempotent: re-run to update.
#
#   curl -fsSL https://raw.githubusercontent.com/izzangalaxybyte/Projektor/main/deploy/install-linux.sh | bash -s -- /mnt/ssd
#
# Arguments (all optional):
#   $1  install root on the big disk (default: the largest mounted filesystem under /mnt, /media, /srv, or /home)
# Environment (optional): MOVIES_DIR, TV_DIR, ANIME_DIR to point at existing media folders.
set -euo pipefail

REPO=https://github.com/izzangalaxybyte/Projektor.git
say() { printf '\n==> %s\n' "$*"; }

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
  echo "Docker installed. If 'docker ps' fails with a permission error, log out and back in, then re-run this script."
fi
DOCKER=docker
docker ps >/dev/null 2>&1 || DOCKER="sudo docker"
$DOCKER compose version >/dev/null 2>&1 || { echo "Docker Compose plugin missing; install docker-compose-plugin and re-run." >&2; exit 1; }

# 2. Where to install: the argument, else the largest mounted filesystem on a data disk.
ROOT="${1:-}"
if [ -z "$ROOT" ]; then
  ROOT=$(df -x tmpfs -x devtmpfs -x overlay --output=target,avail 2>/dev/null | awk 'NR>1 && ($1 ~ /^\/(mnt|media|srv|home)/) {print $2, $1}' | sort -rn | head -1 | awk '{print $2}')
  ROOT="${ROOT:-$HOME}"
fi
INSTALL="$ROOT/projektor"
say "Installing under $INSTALL (data in $INSTALL/data)"
mkdir -p "$INSTALL/data"

# 3. Code
if [ -d "$INSTALL/src/.git" ]; then
  git -C "$INSTALL/src" pull -q --ff-only
else
  git clone -q "$REPO" "$INSTALL/src"
fi

# 4. Media folders: env vars, else the first likely-looking folders on the box, else placeholders.
find_media() { # $1 = name pattern
  find / -maxdepth 4 -type d -iname "$1" -not -path '*/proc/*' -not -path '*/sys/*' -not -path "$INSTALL/*" 2>/dev/null | head -1
}
MOVIES_DIR="${MOVIES_DIR:-$(find_media movies)}"
TV_DIR="${TV_DIR:-$(find_media 'tv*')}"
ANIME_DIR="${ANIME_DIR:-$(find_media anime)}"
for v in MOVIES_DIR TV_DIR ANIME_DIR; do
  if [ -z "${!v}" ]; then
    printf -v "$v" '%s' "$INSTALL/media/$(echo "${v%_DIR}" | tr '[:upper:]' '[:lower:]')"
    mkdir -p "${!v}"
    echo "No folder found for $v; created empty ${!v} (edit deploy/.env to point at your media)."
  fi
done

# 5. Environment
ENV="$INSTALL/src/deploy/.env"
cat > "$ENV" <<ENVEOF
DATA_DIR=$INSTALL/data
MOVIES_DIR=$MOVIES_DIR
TV_DIR=$TV_DIR
ANIME_DIR=$ANIME_DIR
ENVEOF
say "deploy/.env"
cat "$ENV"

# 6. Build and start
say "Building and starting (the first build takes a few minutes)"
( cd "$INSTALL/src" && $DOCKER compose -f deploy/docker-compose.yml up -d --build )

# 7. Health
say "Waiting for the API"
for i in $(seq 1 60); do
  if curl -fsS http://localhost:8096/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done
HEALTH=$(curl -fsS http://localhost:8096/api/health || true)
echo "$HEALTH"
case "$HEALTH" in
  *h264_vaapi*) say "Hardware transcoding is on." ;;
  *libx264*)    say "Software transcoding. Check encoderReason above; usually /dev/dri is not passed through or the Intel driver is missing." ;;
  *)            say "The API did not answer. See: $DOCKER compose -f $INSTALL/src/deploy/docker-compose.yml logs" ;;
esac
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
say "Open http://${IP:-<box-ip>}:8096 in a browser to create the admin profile, then add libraries /media/movies, /media/tv, /media/anime under Settings."
