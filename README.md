# Cryptographic Push Oracle for GenLayer

A multi-LLM Cryptographic Push Oracle for GenLayer, securely routing cross-chain DeFi intents while bypassing VM sandbox limitations.

## Overview
Standard smart contracts cannot dynamically evaluate live, multi-chain data without relying on centralized oracles. Furthermore, GenLayer's strict GenVM sandbox prevents arbitrary web requests during execution to maintain deterministic state. 

This project solves this by introducing a **Cryptographic Push Oracle Architecture**:
1. **The Frontend** pulls live market telemetry (gas fees, liquidity depth, security scores) across multiple chains.
2. **Canonicalization:** The data is deterministically sorted and locked into a SHA-256 hash.
3. **On-Chain Verification:** The payload and hash are submitted to GenLayer, where the contract mathematically proves the data has not been tampered with.
4. **Multi-LLM Consensus:** GenLayer's AI validators evaluate the verified payload against the user's natural language intent to autonomously route the transaction.

## Features
* **Dynamic Omni-Chain Telemetry:** Simulates real-time market conditions.
* **AI Intent Presets:** Translates complex DeFi strategies into executable cross-chain routes.
* **Deterministic Hash Locks:** Prevents payload tampering and bypasses GenVM sandbox restrictions.
* **Type-Safe Storage:** Utilizes GenLayer `TreeMap` architecture.

## Repository Structure
* `/app/page.tsx`: The Next.js / Framer Motion interactive God-Mode dashboard.
* `contract.py`: The GenLayer Python Intelligent Contract featuring the multi-LLM consensus engine.
