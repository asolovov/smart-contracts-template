#!/bin/sh
# Verify every contract from a deployment on the block explorer.
#
#   sh script/deploy/verifyAll.sh [network]     # default: sepolia
#
# `network` is BOTH the `--network` key in hardhat.config.ts AND the deployments/<network>/
# directory name. Those two names must match — see the note in config/deployment.ts.
#
# Every constructor argument is read back out of deployments/<network>/addresses.json, including
# the threshold and the request fee. Nothing is re-declared here. A constant duplicated between
# the deploy script and this one is a constant that will eventually disagree with itself, and the
# symptom is a verification that fails with a constructor-args mismatch for no visible reason.
#
# Args go through a module file rather than the command line, because `--constructor-args` as a
# CLI string mangles arrays and long hex — most "verification failed for no reason" hours trace
# back to a shell-quoting problem. (Hardhat 3 names the flag `--constructor-args-path`; the
# bare `--constructor-args` of Hardhat 2 is now a *positional*, and passing it as a flag dies in
# the argument parser before the network is ever touched.)
#
# Hardhat 3's `verify` task tries Etherscan, Blockscout and Sourcify. It needs ETHERSCAN_API_KEY
# (in `.env` or the keystore) and exits non-zero if a provider errors.
#
# Exit code: the number of contracts that failed to verify. Zero means everything is verified.

set -eu

NETWORK="${1:-sepolia}"
FAILED=0

# Verify one contract, remembering the failure instead of swallowing it. `hardhat verify` exits
# non-zero on a real failure — that signal is the only thing standing between you and a deployment
# you believe is verified but isn't, so it must not be discarded.
verify_one() {
    label="$1"
    address="$2"
    args_module="$3"

    printf '\n--- %s %s ---\n' "$label" "$address"
    if ! npx hardhat verify --network "$NETWORK" --constructor-args-path "$args_module" "$address"; then
        echo "  ✗ ${label} FAILED to verify (already-verified is reported as success, so this is real)"
        FAILED=$((FAILED + 1))
    fi
}
DEPLOY_DIR="deployments/${NETWORK}"
ADDRESSES="${DEPLOY_DIR}/addresses.json"
ARGS_DIR="${DEPLOY_DIR}/.verify-args"

if [ ! -f "$ADDRESSES" ]; then
    echo "no deployment found at ${ADDRESSES} — run deployAll.ts first" >&2
    exit 1
fi

mkdir -p "$ARGS_DIR"

# `node -p` is the least-bad JSON reader available without adding a dependency. It runs as CJS
# even though package.json says "type": "module", so `require` works here.
read_json() {
    node -p "JSON.stringify(require('./${ADDRESSES}')${1})" | tr -d '"'
}

DEPLOYER=$(read_json ".deployer")
SIGNER_SET=$(read_json ".signerSet")
REGISTRY=$(read_json ".registry")
THRESHOLD=$(read_json ".threshold")
REQUEST_FEE=$(read_json ".requestFee")
SIGNERS_JSON=$(node -p "JSON.stringify(require('./${ADDRESSES}').signerAddresses)")
VAULT_COUNT=$(read_json ".vaults.length")

printf '=== verifying %s deployment ===\n' "$NETWORK"

# --- SignerSet ---
cat > "${ARGS_DIR}/signerSet.cjs" <<EOF
module.exports = ["${DEPLOYER}", ${SIGNERS_JSON}, "${THRESHOLD}"];
EOF
verify_one "SignerSet" "$SIGNER_SET" "${ARGS_DIR}/signerSet.cjs"

# --- ExampleRegistry ---
cat > "${ARGS_DIR}/registry.cjs" <<EOF
module.exports = ["${DEPLOYER}"];
EOF
verify_one "ExampleRegistry" "$REGISTRY" "${ARGS_DIR}/registry.cjs"

# --- ExampleVault × N ---
i=0
while [ "$i" -lt "$VAULT_COUNT" ]; do
    SYMBOL=$(read_json ".vaults[${i}].symbol")
    ADDRESS=$(read_json ".vaults[${i}].address")
    TOPIC_ID=$(read_json ".vaults[${i}].topicId")
    DECIMALS=$(read_json ".vaults[${i}].decimals")

    # The args below must mirror ExampleVault's constructor exactly:
    #   (address initialOwner, ISignerSet signerSet_, bytes32 topic_, uint8 decimals_, uint256 requestFee_)
    cat > "${ARGS_DIR}/vault_${i}.cjs" <<EOF
module.exports = ["${DEPLOYER}", "${SIGNER_SET}", "${TOPIC_ID}", ${DECIMALS}, "${REQUEST_FEE}"];
EOF
    verify_one "ExampleVault ${SYMBOL}" "$ADDRESS" "${ARGS_DIR}/vault_${i}.cjs"

    i=$((i + 1))
done

if [ "$FAILED" -gt 0 ]; then
    printf '\n=== %s contract(s) FAILED to verify ===\n' "$FAILED" >&2
    exit "$FAILED"
fi

printf '\n=== all contracts verified ===\n'
