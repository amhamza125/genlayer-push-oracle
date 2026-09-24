# {
#   "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"
# }

from genlayer import *
from dataclasses import dataclass
import json
import hashlib

MAX_HASH_LENGTH = 64
MAX_DECIMAL_LENGTH = 24
MAX_REASON_LENGTH = 200

SUPPORTED_CHAINS = ["ETHEREUM", "ARBITRUM", "BASE", "SOLANA", "NEAR"]


@allow_storage
@dataclass
class IntentRecord:
    intent_id: str
    source_chain: str
    source_tx_hash: str
    target_chain: str
    action: str
    status: str
    safety_score: str
    deposit_amount: str
    asset: str
    execution_route: str
    ai_reasoning: str
    sender: Address
    processed_at_block_nonce: str


class NexusIntentRouter(gl.Contract):
    owner: Address
    is_paused: bool
    total_intents_routed: bigint
    total_volume_processed: bigint

    processed_hashes: TreeMap[str, bool]
    processed_txs: TreeMap[str, bool]
    intents: TreeMap[str, IntentRecord]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.is_paused = False
        self.total_intents_routed = 0
        self.total_volume_processed = 0

    def _is_supported_chain(self, chain: str) -> bool:
        return chain in SUPPORTED_CHAINS

    def _parse_scaled_decimal(self, value: str) -> bigint:
        if len(value) == 0:
            raise Exception("Empty numeric value")

        if len(value) > MAX_DECIMAL_LENGTH:
            raise Exception("Numeric value exceeds maximum allowed length")

        negative = False
        text = value

        if text.startswith("-"):
            negative = True
            text = text[1:]

        parts = text.split(".")

        if len(parts) > 2:
            raise Exception("Invalid decimal notation")

        whole = parts[0]
        if len(whole) == 0:
            whole = "0"

        fractional = ""
        if len(parts) == 2:
            fractional = parts[1]

        # Gracefully truncate decimals beyond 6 places to prevent runtime overflow
        if len(fractional) > 6:
            fractional = fractional[:6]

        while len(fractional) < 6:
            fractional += "0"

        whole_val = 0
        for char in whole:
            if char < "0" or char > "9":
                raise Exception("Non-numeric character in integer segment")
            whole_val = whole_val * 10 + int(char)

        fractional_val = 0
        for char in fractional:
            if char < "0" or char > "9":
                raise Exception("Non-numeric character in fraction segment")
            fractional_val = fractional_val * 10 + int(char)

        total = whole_val * 1000000 + fractional_val
        return -total if negative else total

    def _valid_hash(self, value: str) -> bool:
        if len(value) != MAX_HASH_LENGTH:
            return False

        for char in value:
            valid_num = char >= "0" and char <= "9"
            valid_hex = char >= "a" and char <= "f"
            if not (valid_num or valid_hex):
                return False

        return True

    @gl.public.write
    def route_cross_chain_intent(
        self, intent_id: str, payload_json: str, expected_sha256: str
    ) -> str:
        caller = gl.message.sender_address

        if self.is_paused:
            raise Exception("Nexus Protocol is currently paused by governance")

        if len(intent_id) == 0 or len(intent_id) > 64:
            raise Exception("Invalid intent identifier length")

        if not self._valid_hash(expected_sha256):
            raise Exception("Invalid SHA-256 hash formatting")

        # 1. Cryptographic Tamper Verification
        calculated_hash = hashlib.sha256(payload_json.encode()).hexdigest()
        if calculated_hash != expected_sha256:
            raise Exception("Cryptographic verification failed: SHA-256 mismatch")

        # 2. Replay Protection
        if expected_sha256 in self.processed_hashes:
            if self.processed_hashes[expected_sha256]:
                raise Exception("Payload has already been processed")

        if intent_id in self.intents:
            raise Exception("Intent ID already registered")

        # 3. JSON Structure & Field Validation
        try:
            payload = json.loads(payload_json)
        except Exception:
            raise Exception("Malformed JSON payload string")

        if not isinstance(payload, dict):
            raise Exception("Root payload must be an object")

        required_keys = [
            "source_chain",
            "source_tx_hash",
            "deposit_amount",
            "asset",
            "user_intent",
            "chain_metrics",
        ]
        for key in required_keys:
            if key not in payload:
                raise Exception(f"Missing mandatory payload parameter: {key}")

        source_chain = str(payload["source_chain"]).upper()
        source_tx_hash = str(payload["source_tx_hash"])
        deposit_amount_str = str(payload["deposit_amount"])
        asset = str(payload["asset"]).upper()
        user_intent = str(payload["user_intent"])
        chain_metrics = payload["chain_metrics"]

        if not self._is_supported_chain(source_chain):
            raise Exception("Source chain is not supported by Nexus")

        if source_tx_hash in self.processed_txs:
            if self.processed_txs[source_tx_hash]:
                raise Exception("Source chain transaction hash already consumed")

        deposit_scaled = self._parse_scaled_decimal(deposit_amount_str)
        if deposit_scaled <= 0:
            raise Exception("Deposit value must be strictly positive")

        if not isinstance(chain_metrics, dict):
            raise Exception("chain_metrics must be an object containing candidate chains")

        # 4. Multi-LLM Omni-Chain Routing & Safety Consensus Engine
        prompt = f"""
You are the Nexus Omni-Chain AI Routing and Security Engine running inside GenLayer consensus.
Analyze this cross-chain user intent and live multi-chain network condition matrix:

Source Chain: {source_chain}
Source Tx: {source_tx_hash}
Deposit: {deposit_amount_str} {asset}
User Intent: {user_intent}

Candidate Chains & Live Telemetry:
{json.dumps(chain_metrics, sort_keys=True, indent=2)}

Evaluation Criteria:
1. Security: Verify that the source deposit satisfies valid non-zero parameters without exploit flags.
2. Optimal Route: Select the best target chain among the candidates that fulfills the user's intent with the optimal balance of lowest gas cost, highest destination liquidity, and lowest bridge slippage.
3. Supported Target Chains: Must be strictly one of ["ETHEREUM", "ARBITRUM", "BASE", "SOLANA", "NEAR"].

Return ONLY valid JSON matching this exact structure:
{{
    "status": "APPROVED",
    "target_chain": "SOLANA",
    "action": "EXECUTE_SWAP_AND_STAKE",
    "safety_score": "98",
    "execution_route": "Ethereum -> Wormhole Core Bridge -> Raydium Pool -> Destination Wallet",
    "reason": "Solana offers 98% lower fees and the highest 24h volume for the requested asset."
}}

If the intent is malicious, zero-value spoofing, or invalid, set "status" to "REJECTED" and "target_chain" to "NONE".
"""

        def leader_fn():
            return gl.nondet.exec_prompt(prompt, response_format="json")

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False

            leader_data = leader_result.calldata
            if not isinstance(leader_data, dict):
                return False

            if leader_data.get("status") not in ("APPROVED", "REJECTED"):
                return False

            target = leader_data.get("target_chain")
            if target not in SUPPORTED_CHAINS and target != "NONE":
                return False

            if not isinstance(leader_data.get("reason"), str):
                return False

            # Validator validates using its own non-deterministic LLM evaluation
            validator_result = gl.nondet.exec_prompt(prompt, response_format="json")
            if not isinstance(validator_result, dict):
                return False

            # Quorum requires agreement on approval status and chosen execution target
            if validator_result.get("status") != leader_data.get("status"):
                return False

            if validator_result.get("target_chain") != leader_data.get("target_chain"):
                return False

            return True

        ai_result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        if not isinstance(ai_result, dict):
            raise Exception("AI consensus failed to return a valid dictionary response")

        status = ai_result.get("status")
        target_chain = ai_result.get("target_chain")
        action = ai_result.get("action", "TRANSFER")
        safety_score = str(ai_result.get("safety_score", "100"))
        execution_route = ai_result.get("execution_route", "Direct Route")
        reason = ai_result.get("reason", "No audit details supplied")

        if status != "APPROVED":
            raise Exception(f"Intent rejected by AI Consensus: {reason}")

        if len(reason) > MAX_REASON_LENGTH:
            reason = reason[:MAX_REASON_LENGTH]

        # 5. State Persistence
        self.processed_hashes[expected_sha256] = True
        self.processed_txs[source_tx_hash] = True
        self.total_intents_routed += 1
        self.total_volume_processed += deposit_scaled

        record = IntentRecord(
            intent_id=intent_id,
            source_chain=source_chain,
            source_tx_hash=source_tx_hash,
            target_chain=target_chain,
            action=action,
            status=status,
            safety_score=safety_score,
            deposit_amount=deposit_amount_str,
            asset=asset,
            execution_route=execution_route,
            ai_reasoning=reason,
            sender=caller,
            processed_at_block_nonce=str(self.total_intents_routed),
        )

        self.intents[intent_id] = record

        return json.dumps(
            {
                "protocol": "Nexus Omni-Chain Intent Router",
                "version": "1.0",
                "intent_id": intent_id,
                "status": status,
                "source_chain": source_chain,
                "target_chain": target_chain,
                "action": action,
                "safety_score": safety_score,
                "execution_route": execution_route,
                "reason": reason,
                "total_intents_routed": str(self.total_intents_routed),
            }
        )

    @gl.public.view
    def get_intent(self, intent_id: str) -> str:
        if intent_id not in self.intents:
            return json.dumps({"error": "Intent ID not found"})

        record = self.intents[intent_id]
        return json.dumps(
            {
                "intent_id": record.intent_id,
                "source_chain": record.source_chain,
                "source_tx_hash": record.source_tx_hash,
                "target_chain": record.target_chain,
                "action": record.action,
                "status": record.status,
                "safety_score": record.safety_score,
                "deposit_amount": record.deposit_amount,
                "asset": record.asset,
                "execution_route": record.execution_route,
                "ai_reasoning": record.ai_reasoning,
                "sender": str(record.sender),
                "nonce": record.processed_at_block_nonce,
            }
        )

    @gl.public.view
    def get_protocol_overview(self) -> str:
        return json.dumps(
            {
                "protocol": "Nexus Omni-Chain Intent Router",
                "active_status": "PAUSED" if self.is_paused else "OPERATIONAL",
                "supported_chains": SUPPORTED_CHAINS,
                "total_intents_routed": str(self.total_intents_routed),
                "total_volume_scaled": str(self.total_volume_processed),
            }
        )

    @gl.public.view
    def is_source_tx_processed(self, tx_hash: str) -> bool:
        if tx_hash in self.processed_txs:
            return bool(self.processed_txs[tx_hash])
        return False

    @gl.public.write
    def set_paused(self, paused: bool):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the protocol governance owner may pause/unpause")
        self.is_paused = paused
