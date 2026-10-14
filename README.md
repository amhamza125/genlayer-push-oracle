# Cryptographic Push Oracle v4 for GenLayer

A GenLayer Intelligent Contract that routes cross-chain DeFi intents through
multi-validator AI consensus. Version 4 adds a dual-source web oracle, strict
verdict validation, finished governance, and a cancel flow with permanent
terminal states.

## Live deployments (StudioNet, chain 61999)

- **v4 test deployment:** [0x9799957f6f819fa8D80DB7634BFF9B8026304b24](https://explorer-studio.genlayer.com/address/0x9799957f6f819fa8D80DB7634BFF9B8026304b24) — adversarial suite: 62/62 passed, 56/56 write txs finalized
- **v4 video deployment:** [0xD1577536E1ef35c5bb27bbDCFfcAD02523bfa8A0](https://explorer-studio.genlayer.com/address/0xD1577536E1ef35c5bb27bbDCFfcAD02523bfa8A0) — 5 real intents on 5 chains (see `docs/VERIFICATION.md`)
- **v3 (legacy):** `0xB98F42756D6458c9576B418cC8cb3bDe5Ae04fb8`

**Dashboard:** https://genlayer-push-oracle.vercel.app/ — reads live from the
configured contract; paste any v4 address into the contract switcher.

## What's new in v4

1. **Dual-source web oracle** — the contract fetches market data from two
   independent feeds (`api.llama.fi/chains` and `/v2/chains`). If both are
   unreachable, it refuses to judge rather than trusting blind data.
2. **Strict verdict validation** — the AI's answer must pick a supported chain
   (Ethereum, Arbitrum, Base, Solana, Near), an allowlisted action, and a clean
   0–100 safety score, or it is rejected.
3. **Finished governance** — `set_asset_paused`, `set_sender_blocked`,
   `set_bridge_reporter`, `transfer_ownership`, with threshold bounds (1–100)
   and chain validation.
4. **Cancel flow** — `cancel_intent` plus permanent terminal bridge states
   (`COMPLETED`, `FAILED`, `CANCELLED`).
5. **Oracle attestation** — every intent records which feeds were verified and a
   fingerprint of the exact data judged.

## Repository structure

- `contract_v4.py` — the v4 GenLayer Intelligent Contract
- `app/` — the Aurora Light dashboard (Next.js, Vercel)
- `docs/VERIFICATION.md` — deployment record, test results, video evidence
- `tests/adversarial/` — runnable 62-scenario test suite + raw results
- `contract v3.py` — previous version, kept for history

## Verify it yourself

```bash
cd tests/adversarial
npm install
node run.mjs
```

Keys come from environment variables — no private keys in this repo.

## Deploying v4

Paste `contract_v4.py` into [GenLayer Studio](https://studio.genlayer.com) and
deploy from your wallet (you become the owner). Then set `DEFAULT_CONTRACT` in
`app/page.tsx` to your new address and push — Vercel redeploys automatically.
