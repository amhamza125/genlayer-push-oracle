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

### Video deployment (submission demo)

A second, fresh v4 deployment was used for the narrated submission video:

- **Address:** `0xD1577536E1ef35c5bb27bbDCFfcAD02523bfa8A0`
- **Deploy tx:** [0x5d5ab7cf7e32619696d7702a3a34f207d65245a3988326a23f965a7c0bbf0020](https://explorer-studio.genlayer.com/tx/0x5d5ab7cf7e32619696d7702a3a34f207d65245a3988326a23f965a7c0bbf0020)
- **Explorer:** [0xD1577536E1ef35c5bb27bbDCFfcAD02523bfa8A0](https://explorer-studio.genlayer.com/address/0xD1577536E1ef35c5bb27bbDCFfcAD02523bfa8A0)

### Production deployment

_To be filled in after deploying from the owner's wallet (see §6)._

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

## 3. Submission video — 5 real intents on 5 chains

Recorded against the video deployment above. All five intents used real
telemetry (live DefiLlama TVL + live RPC gas) and reached validator consensus.
Each verdict was independently re-read from the contract.

| # | Chain | Amount | Intent | Route tx | Verdict |
|---|-------|--------|--------|----------|---------|
| 1 | Ethereum | 1000 USDC | ORACLE-SEQ-3230 | [0x58dbe3…212e34](https://explorer-studio.genlayer.com/tx/0x58dbe3148195faae91be3ca63a0fb7613543337955fdcaca7b016fd992212e34) | APPROVED → BASE, 92/100 |
| 2 | Arbitrum | 750 USDC | ORACLE-SEQ-9685 | [0xdd063e…3b38f67](https://explorer-studio.genlayer.com/tx/0xdd063e0ef2aac2c8ac8c9a4e45346c161e22299ed2e4b3cb435e9e30b3b38f67) | APPROVED → BASE, 94/100 |
| 3 | Base | 500 USDC | ORACLE-SEQ-6064 | [0xe7da59…0ecfdc35](https://explorer-studio.genlayer.com/tx/0xe7da59d5a1d6fadd3bf8139b2dd2aa97085a01defccab83af3533a2b0ecfdc35) | APPROVED → SOLANA, 81/100 |
| 4 | Solana | 250 USDC | ORACLE-SEQ-3084 | [0x9310ab…366e0817](https://explorer-studio.genlayer.com/tx/0x9310abcb720df1ed3d6fceba42294909749f0408a6e658e57a7c3a4f366e0817) | APPROVED → BASE, 88/100, then **CANCELLED** ([cancel tx](https://explorer-studio.genlayer.com/tx/0x9b1354b350dad69ae2acd7a3c047707c29a670ec829456049c152c2c7741f77d)) |
| 5 | Near | 300 USDC | ORACLE-SEQ-2335 | [0x6329fc…0146c7c](https://explorer-studio.genlayer.com/tx/0x6329fc025e42a3f267a0f57105481608fdc5e4bfac83700b8bf78246f0146c7c) | APPROVED → BASE, 96/100 |

Intent 4 demonstrates the v4 cancel flow: the AI approved it, the user cancelled
it while pending, and its bridge state is now permanently `CANCELLED` —
independently verified with the dashboard's intent tracker.

## 4. Dashboard

The `app/` directory is the Aurora Light dashboard (Next.js, deployed to Vercel).
It reads everything live from the configured contract — no simulated data. Any
valid v4 contract address can be pasted into the contract switcher. The default
address is the test deployment; point it at the production deployment after §6.

## 5. Honest limitations

- The test suite ran against the test deployment of the identical v4 file, not
  (yet) the production deployment.
- The video's route transactions were submitted programmatically; the video
  shows the real on-chain results, not the wallet clicks.
- `total_volume_scaled` sums deposit amounts across assets — it is labeled in
  the UI as combined deposits, not USD volume.
- The contract's intent registry is not enumerable on-chain; the dashboard shows
  aggregate stats, lookup by known intent ID, and the local per-device journal.
  Full history is on the contract's explorer page.

## 6. Production deployment checklist (owner)

1. Deploy `contract_v4.py` from your own wallet via GenLayer Studio.
2. In `app/page.tsx`, set `DEFAULT_CONTRACT` (line 23) to the new address.
3. Update §1 above with the production address + deploy tx.
4. Push — Vercel redeploys the dashboard automatically.
