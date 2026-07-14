#!/bin/sh
# Verify every contract from a deployment on the block explorer.
#
#   sh script/deploy/verifyAll.sh [network]     # default: sepolia
#
# Every constructor argument is read back out of deployments/<network>/addresses.json — including
# the threshold and the request fee. Nothing is re-declared here. A constant duplicated between
# the deploy script and this one is a constant that will eventually disagree with itself, and the
# symptom is an Etherscan verification failing with a constructor-args mismatch for no visible
# reason.
#
# Args go through a file rather than the CLI because `--constructor-args` on the command line
# mangles arrays and long hex — most "verification failed for no reason" hours trace back to a
# shell-quoting problem. Requires ETHERSCAN_API_KEY in `.env`.

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
printf '\n--- SignerSet %s ---\n' "$SIGNER_SET"
npx hardhat verify --network "$NETWORK" --constructor-args "${ARGS_DIR}/signerSet.cjs" "$SIGNER_SET" \
    || echo "  (already verified, or failed — check the output above)"

# --- ExampleRegistry ---
cat > "${ARGS_DIR}/registry.cjs" <<EOF
module.exports = ["${DEPLOYER}"];
EOF
printf '\n--- ExampleRegistry %s ---\n' "$REGISTRY"
npx hardhat verify --network "$NETWORK" --constructor-args "${ARGS_DIR}/registry.cjs" "$REGISTRY" \
    || echo "  (already verified, or failed — check the output above)"

# --- ExampleVault × N ---
i=0
while [ "$i" -lt "$VAULT_COUNT" ]; do
    SYMBOL=$(read_json ".vaults[${i}].symbol")
    ADDRESS=$(read_json ".vaults[${i}].address")
    TOPIC_ID=$(read_json ".vaults[${i}].topicId")
    DECIMALS=$(read_json ".vaults[${i}].decimals")

    cat > "${ARGS_DIR}/vault_${SYMBOL}.cjs" <<EOF
module.exports = ["${DEPLOYER}", "${SIGNER_SET}", "${TOPIC_ID}", ${DECIMALS}, "${REQUEST_FEE}"];
EOF
    printf '\n--- ExampleVault %s %s ---\n' "$SYMBOL" "$ADDRESS"
    npx hardhat verify --network "$NETWORK" --constructor-args "${ARGS_DIR}/vault_${SYMBOL}.cjs" "$ADDRESS" \
        || echo "  (already verified, or failed — check the output above)"

    i=$((i + 1))
done

printf '\n=== done ===\n'
