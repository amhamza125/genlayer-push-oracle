# Cryptographic Push Oracle v3.0 for GenLayer

A multi-LLM Cryptographic Push Oracle for GenLayer, securely routing cross-chain DeFi intents using autonomous web fetching and stateful execution lifecycles.

## Overview

Standard smart contracts cannot dynamically evaluate live, multi-chain data without relying on centralized oracles.

This project solves this by introducing a **Cryptographic Push Oracle Architecture**, which has been massively upgraded in V3 to include autonomous data verification:

1. **The Frontend** pulls live market telemetry (gas fees, liquidity depth, security scores) across multiple chains.
2. **Canonicalization & Hash Locks (V3 TTL):** The data is deterministically sorted, timestamped with a strict 60-second TTL, and locked into a SHA-256 hash to prevent replay attacks or stale data injection.
3. **Autonomous Web Verification (V3):** During execution, GenLayer's AI nodes utilize `gl.nondet.web.get` to independently fetch live DeFi API data from the internet, cross-referencing it against the user's pushed payload to detect manipulation.
4. **Multi-LLM Consensus:** GenLayer's AI validators evaluate the verified payload against the user's natural language intent to autonomously approve the optimal route.
5. **Two-Step Bridge Lifecycle (V3):** Once approved, users cryptographically bind their source CCTP `DepositForBurn` transaction hash to the contract, advancing the on-chain state from `AWAITING_SOURCE` to `SOURCE_SUBMITTED`.

## V3 Key Upgrades & Features

* **[NEW] Autonomous Web Oracle:** The GenVM contract natively fetches live internet data to cross-reference untrusted frontend telemetry.
* **[NEW] Two-Step Execution State Machine:** Decoupled the AI routing logic from the physical bridge execution for secure cross-chain status tracking.
* **[NEW] Deterministic TTL Guardrails:** 60-second payload age limits mathematically block stale market data injection.
* **Dynamic Omni-Chain Telemetry:** Visualizes real-time market conditions and live API RPC data on the Next.js UI.
* **AI Intent Presets:** Translates complex DeFi strategies into executable cross-chain routes.

## Repository Structure

* `/app/page.tsx`: The Next.js / Framer Motion interactive dashboard featuring the consensus visualizer and Step-2 bindings.
* `contract v3.py`: The V3 GenLayer Python Intelligent Contract featuring the Autonomous Web Oracle, TTL guardrails, and the multi-LLM consensus engine.
