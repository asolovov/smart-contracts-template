#!/bin/sh
# Resolve solc 0.8.24 and run Slither against slither-all.sol.
#
# See the header of slither-all.sol for why we analyse that file rather than the Hardhat project.
#
# Resolution order:
#   1. $SOLC, if you set it.
#   2. The solc-select ARTIFACT for 0.8.24, addressed directly.
#   3. `solc` on PATH — but only if it actually reports 0.8.24.
#
# Note (2): we address the artifact binary, not solc-select's `solc` shim. The shim resolves to
# whichever version is *globally selected*, so on a machine set to a different version it happily
# compiles with the wrong compiler and the pragma error that follows looks like a repo bug. The
# artifact path is unambiguous, and it leaves the developer's global selection untouched — a lint
# script has no business mutating your toolchain.
#
# Whatever we resolve is version-checked before use.

set -eu

REQUIRED="0.8.24"
SOLC_SELECT_HOME="${SOLC_SELECT_HOME:-${HOME}/.solc-select}"

SOLC="${SOLC:-}"

if [ -z "$SOLC" ]; then
    ARTIFACT="${SOLC_SELECT_HOME}/artifacts/solc-${REQUIRED}/solc-${REQUIRED}"
    if [ -x "$ARTIFACT" ]; then
        SOLC="$ARTIFACT"
    elif command -v solc >/dev/null 2>&1 && solc --version 2>/dev/null | grep -q "$REQUIRED"; then
        SOLC=solc
    fi
fi

if [ -z "$SOLC" ] || ! "$SOLC" --version 2>/dev/null | grep -q "$REQUIRED"; then
    cat >&2 <<EOF
solc ${REQUIRED} not found (the pragma is pinned to it).

Install:
    pip install solc-select
    solc-select install ${REQUIRED}

You do NOT need to \`solc-select use ${REQUIRED}\` — this script addresses the artifact directly
and leaves your global selection alone.

Or point it at your own binary:
    SOLC=/absolute/path/to/solc-${REQUIRED} npm run slither
EOF
    exit 1
fi

exec slither slither-all.sol --config-file slither.config.json --solc "$SOLC"
