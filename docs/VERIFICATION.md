# Push Oracle v4 — Verification

This document records exactly what was deployed, what was tested, and what the
evidence is. Every claim below links to an on-chain record.

## 1. The contract

**Cryptographic Push Oracle v4** (`contract_v4.py`) — GenLayer Intelligent
Contract. Routes cross-chain DeFi intents through multi-validator AI consensus,
with a dual-source web oracle, strict verdict validation, finished governance,
and a cancel flow with permanent terminal states.

### Test deployment (adversarial suite + dashboard default)

- **Address:** `0x9799957f6f819fa8D80DB7634BFF9B8026304b24`
- **Deploy tx:** [0xa0b3662f85b4df56f7fc2c09d7e25844d053bfcadc568f8a97558ac864b93bf3](https://explorer-studio.genlayer.com/tx/0xa0b3662f85b4df56f7fc2c09d7e25844d053bfcadc568f8a97558ac864b93bf3)
- **Explorer:** [0x9799957f6f819fa8D80DB7634BFF9B8026304b24](https://explorer-studio.genlayer.com/address/0x9799957f6f819fa8D80DB7634BFF9B8026304b24)
- **Network:** GenLayer StudioNet (chain 61999)

### Production deployment

_To be filled in after deploying from the owner's wallet (see §5)._

## 2. Adversarial test suite — 62/62 passed

`tests/adversarial/run.mjs` runs 62 scenarios against the test deployment,
covering: dual-oracle fail-closed behavior, strict verdict validation (chain
allowlist, action allowlist, 0–100 score), governance access control
(`set_asset_paused`, `set_sender_blocked`, `set_bridge_reporter`,
`transfer_ownership`), safety-threshold bounds, the cancel flow and terminal
bridge states, source-hash format enforcement, replay protection, and TTL
guardrails. **56 unique write transactions reached FINALIZED.**

- **Result:** 62/62 scenarios passed, 56/56 write transactions FINALIZED
- **Run ID:** V4T-MV7RUDZC
- **Raw results:** `tests/adversarial/po-v4-results.json` (includes every
  transaction hash)

Run it yourself (keys via environment, no private keys in the repo):

```bash
cd tests/adversarial
npm install
node run.mjs
```

Three real bugs were found and fixed by this suite during development (documented
in `docs/` of the build workspace): `TreeMap[Address]` key mismatch for blocked
senders, raw oracle truncation hiding the supported chains, and `Address`
calldata params not comparing equal to `gl.message.sender_address`.

## 3. Dashboard

The `app/` directory is the Aurora Light dashboard (Next.js, deployed to Vercel).
It reads everything live from the configured contract — no simulated data. Any
valid v4 contract address can be pasted into the contract switcher. The default
address is the test deployment; point it at the production deployment after §5.

## 4. Honest limitations

- The test suite ran against the test deployment of the identical v4 file, not
  (yet) the production deployment.
- `total_volume_scaled` sums deposit amounts across assets — it is labeled in
  the UI as combined deposits, not USD volume.
- The contract's intent registry is not enumerable on-chain; the dashboard shows
  aggregate stats, lookup by known intent ID, and the local per-device journal.
  Full history is on the contract's explorer page.

## 5. Production deployment checklist (owner)

1. Deploy `contract_v4.py` from your own wallet via GenLayer Studio.
2. In `app/page.tsx`, set `DEFAULT_CONTRACT` (line 23) to the new address.
3. Update §1 above with the production address + deploy tx.
4. Push — Vercel redeploys the dashboard automatically.
