#!/bin/sh
# Install a pinned XHS-Downloader into .tools/ (git-ignored). Run from anywhere; no global packages change.
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
XHS_REV=47840a1bee8438324ff10753c4291148c46071c8  # v2.8
XHS_DIR=${XHS_DOWNLOADER_HOME:-$REPO/.tools/xhs-downloader}
if [ ! -d "$XHS_DIR/.git" ]; then
    git clone https://github.com/JoeanAmier/XHS-Downloader.git "$XHS_DIR"
fi
git -C "$XHS_DIR" fetch --quiet origin "$XHS_REV" 2>/dev/null || true
git -C "$XHS_DIR" checkout --quiet --detach "$XHS_REV"
[ -x "$XHS_DIR/.venv/bin/python" ] || "${PYTHON:-python3}" -m venv "$XHS_DIR/.venv"
"$XHS_DIR/.venv/bin/pip" install --quiet -r "$XHS_DIR/requirements.txt"
echo "XHS-Downloader ready at $XHS_DIR ($XHS_REV)"
