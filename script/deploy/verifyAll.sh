#!/bin/sh
# Verify every contract from a deployment on the block explorer.
#
#   sh script/deploy/verifyAll.sh [network]     # default: sepolia
#
# Reads deployments/<network>/addresses.json, writes a throwaway constructor-args module per
# contract into deployments/<network>/.verify-args/ (gitignored), and calls `hardhat verify`.
#
# Constructor args go through a file rather than the CLI because `--constructor-args` on the
# command line mangles arrays and long hex — every "verification failed for no reason" hour
# eventually traces back to a shell-quoting problem. Requires ETHERSCAN_API_KEY in `.env`.

set -eu

NETWORK="${1:-sepolia}"
DEPLOY_DIR="deployments/${NETWORK}"
ADDRESSES="${DEPLOY_DIR}/addresses.json"
ARGS_DIR="${DEPLOY_DIR}/.verify-args"

if [ ! -f "$ADDRESSES" ]; then
    echo "no deployment found at ${ADDRESSES} — run deployAll.ts first" >&2
    exit 1
fi

mkdir -p "$ARGS_DIR"

# `node -p` is the least-bad JSON reader available without adding a dependency.
read_json() {
    node -p "JSON.stringify(require('./${ADDRESSES}')${1})" | tr -d '"'
}

DEPLOYER=$(read_json ".deployer")
SIGNER_SET=$(read_json ".signerSet")
REGISTRY=$(read_json ".registry")
THRESHOLD=$(read_json ".threshold")
SIGNERS_JSON=$(node -p "JSON.stringify(require('./${ADDRESSES}').signerAddresses)")
VAULT_COUNT=$(read_json ".vaults.length")

echo "=== verifying ${NETWORK} deployment ==="

# --- SignerSet ---
cat > "${ARGS_DIR}/signerSet.cjs" <<EOF
module.exports = ["${DEPLOYER}", ${SIGNERS_JSON}, "${THRESHOLD}"];
EOF
echo "\n--- SignerSet ${SIGNER_SET} ---"
npx hardhat verify --network "$NETWORK" --constructor-args "${ARGS_DIR}/signerSet.cjs" "$SIGNER_SET" || echo "  (already verified or failed — check output)"

# --- ExampleRegistry ---
cat > "${ARGS_DIR}/registry.cjs" <<EOF
module.exports = ["${DEPLOYER}"];
EOF
echo "\n--- ExampleRegistry ${REGISTRY} ---"
npx hardhat verify --network "$NETWORK" --constructor-args "${ARGS_DIR}/registry.cjs" "$REGISTRY" || echo "  (already verified or failed — check output)"

# --- ExampleVault × N ---
i=0
while [ "$i" -lt "$VAULT_COUNT" ]; do
    SYMBOL=$(read_json ".vaults[${i}].symbol")
    ADDRESS=$(read_json ".vaults[${i}].address")
    TOPIC_ID=$(read_json ".vaults[${i}].topicId")
    DECIMALS=$(read_json ".vaults[${i}].decimals")

    # REQUEST_FEE must match the value deployAll.ts used.
    cat > "${ARGS_DIR}/vault_${SYMBOL}.cjs" <<EOF
module.exports = ["${DEPLOYER}", "${SIGNER_SET}", "${TOPIC_ID}", ${DECIMALS}, "0"];
EOF
    echo "\n--- ExampleVault ${SYMBOL} ${ADDRESS} ---"
    npx hardhat verify --network "$NETWORK" --constructor-args "${ARGS_DIR}/vault_${SYMBOL}.cjs" "$ADDRESS" || echo "  (already verified or failed — check output)"

    i=$((i + 1))
done

echo "\n=== done ==="
