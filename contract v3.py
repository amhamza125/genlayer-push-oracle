# {
#   "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"
# }

from genlayer import *
from dataclasses import dataclass
import json
import hashlib
from datetime import datetime, timezone

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

    minimum_safety_score: bigint
    bridge_reporter: Address
    chain_paused: TreeMap[str, bool]
    asset_paused: TreeMap[str, bool]
    blocked_senders: TreeMap[Address, bool]
    
    bridge_status: TreeMap[str, str]
    destination_tx_by_intent: TreeMap[str, str]
    chain_usage_stats: TreeMap[str, bigint]
    intent_expiry: TreeMap[str, bigint]

    def __init__(self):
        self.owner = gl.message.sender_address
        self.bridge_reporter = gl.message.sender_address
        self.is_paused = False
        self.total_intents_routed = 0
        self.total_volume_processed = 0
        self.minimum_safety_score = 75  # AI must score route >= 75/100

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
        if self.blocked_senders.get(caller, False):
            raise Exception("Sender is blocked by protocol governance")

        if len(intent_id) == 0 or len(intent_id) > 64:
            raise Exception("Invalid intent identifier length")
        if not self._valid_hash(expected_sha256):
            raise Exception("Invalid SHA-256 hash formatting")

        calculated_hash = hashlib.sha256(payload_json.encode()).hexdigest()
        if calculated_hash != expected_sha256:
            raise Exception("Cryptographic verification failed: SHA-256 mismatch")
        if self.processed_hashes.get(expected_sha256, False):
            raise Exception("Payload has already been processed")
        if intent_id in self.intents:
            raise Exception("Intent ID already registered")

        try:
            payload = json.loads(payload_json)
        except Exception:
            raise Exception("Malformed JSON payload string")
        if not isinstance(payload, dict):
            raise Exception("Root payload must be an object")

        required_keys = [
            "payload_timestamp", "source_chain", "source_tx_hash",
            "deposit_amount", "asset", "user_intent", "chain_metrics"
        ]
        for key in required_keys:
            if key not in payload:
                raise Exception(f"Missing mandatory payload parameter: {key}")

        tx_timestamp = int(datetime.now(timezone.utc).timestamp())
        raw_timestamp = payload.get("payload_timestamp")
        if not str(raw_timestamp).isdigit():
            raise Exception("Invalid payload timestamp format")
        
        age = tx_timestamp - int(raw_timestamp)
        if age < 0 or age > 60:
            raise Exception(f"Payload stale. Outside the 60-second TTL (Age: {age}s)")

        source_chain = str(payload["source_chain"]).upper()
        source_tx_hash = str(payload["source_tx_hash"])
        deposit_amount_str = str(payload["deposit_amount"])
        asset = str(payload["asset"]).upper()
        user_intent = str(payload["user_intent"])
        chain_metrics = payload["chain_metrics"]

        if not self._is_supported_chain(source_chain):
            raise Exception("Source chain is not supported by Nexus")
        if self.chain_paused.get(source_chain, False):
            raise Exception("Source chain is currently paused")
        if self.asset_paused.get(asset, False):
            raise Exception("Asset is currently paused")

        if source_tx_hash and self.processed_txs.get(source_tx_hash, False):
            raise Exception("Source chain transaction hash already consumed")

        deposit_scaled = self._parse_scaled_decimal(deposit_amount_str)
        if deposit_scaled <= 0:
            raise Exception("Deposit value must be strictly positive")
        if not isinstance(chain_metrics, dict):
            raise Exception("chain_metrics must be an object containing candidate chains")

        historical_metrics = {chain: int(self.chain_usage_stats.get(chain, 0)) for chain in SUPPORTED_CHAINS}

        prompt = f"""
You are the Nexus Omni-Chain AI Routing and Security Engine.
Analyze this cross-chain user intent against both the untrusted user payload and the live, on-chain oracle API telemetry.

Source Chain: {source_chain}
Source Tx: {source_tx_hash}
Deposit: {deposit_amount_str} {asset}
User Intent: {user_intent}

Provided Frontend Telemetry (Untrusted):
{json.dumps(chain_metrics, sort_keys=True, indent=2)}

Historical Protocol Volume (Successful Bridges):
{json.dumps(historical_metrics, sort_keys=True)}

Evaluation Criteria:
1. Optimal Route: Select the best target chain that fulfills the user's intent based on the aggregated data.
2. Oracle Verification: Ensure the untrusted frontend telemetry reasonably aligns with the LIVE API Telemetry (provided below). If the frontend data appears heavily manipulated, penalize the safety score or reject the transaction.
3. Safety: Output a safety_score (0-100). Any score below {self.minimum_safety_score} will be automatically rejected.
4. Supported Chains: Must be strictly one of {json.dumps(SUPPORTED_CHAINS)}.

Return ONLY valid JSON matching this structure:
{{
    "status": "APPROVED",
    "target_chain": "SOLANA",
    "action": "EXECUTE_SWAP_AND_STAKE",
    "safety_score": "98",
    "execution_route": "Ethereum -> Wormhole Core -> Destination",
    "reason": "Solana offers the lowest fees per user intent. Live API verified."
}}
If the intent is malicious or heavily manipulated, set "status" to "REJECTED".
"""

        # ==========================================
        # V3 UPGRADE: On-Chain Web Fetching Oracle
        # ==========================================
        def run_ai_with_live_oracle() -> dict:
            try:
                # The GenLayer nodes fetch live public API data (e.g., DefiLlama chains) natively
                res = gl.nondet.web.get("https://api.llama.fi/chains")
                # Truncate response to prevent blowing up the LLM context window
                live_web_data = res.body.decode("utf-8")[:1500]
            except Exception:
                live_web_data = "Oracle fetch failed. Fallback to untrusted frontend telemetry."

            dynamic_prompt = prompt + f"\n\nLIVE Web API Telemetry (Trusted Oracle Data):\n{live_web_data}"
            return gl.nondet.exec_prompt(dynamic_prompt, response_format="json")

        def leader_fn():
            return run_ai_with_live_oracle()

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

            # Validator nodes also fetch the internet data independently
            validator_result = run_ai_with_live_oracle()
            if not isinstance(validator_result, dict):
                return False
            
            # Semantic equivalence check
            if validator_result.get("status") != leader_data.get("status"):
                return False
            if validator_result.get("target_chain") != leader_data.get("target_chain"):
                return False
            return True

        consensus_failed = False
        try:
            ai_result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        except Exception:
            consensus_failed = True

        status = "APPROVED"
        target_chain = "NONE"
        action = "HALT"
        safety_score = "0"
        execution_route = "NONE"
        reason = ""

        if consensus_failed:
            status = "REJECTED_CONSENSUS_FAILED"
            reason = "AI consensus failed to reach quorum. Intent halted for safety."
        else:
            if not isinstance(ai_result, dict):
                raise Exception("AI returned invalid JSON object")
                
            ai_status = ai_result.get("status", "REJECTED")
            if ai_status != "APPROVED":
                status = "REJECTED_BY_AI"
                reason = ai_result.get("reason", "Rejected by AI policy")
            else:
                target_chain = ai_result.get("target_chain", "NONE")
                safety_score = str(ai_result.get("safety_score", "100"))
                action = ai_result.get("action", "TRANSFER")
                execution_route = ai_result.get("execution_route", "Direct")
                reason = ai_result.get("reason", "Approved")

                if int(safety_score) < int(self.minimum_safety_score):
                    status = "REJECTED_SAFETY_SCORE"
                    reason = f"AI safety score {safety_score} is below governance minimum of {self.minimum_safety_score}"
                elif self.chain_paused.get(target_chain, False):
                    status = "REJECTED_CHAIN_PAUSED"
                    reason = "Target chain selected by AI is currently paused"

        self.processed_hashes[expected_sha256] = True
        if source_tx_hash:
            self.processed_txs[source_tx_hash] = True
            
        self.total_intents_routed += 1
        self.intent_expiry[intent_id] = tx_timestamp + 3600
        
        if status == "APPROVED":
            self.total_volume_processed += deposit_scaled
            self.chain_usage_stats[target_chain] = self.chain_usage_stats.get(target_chain, 0) + 1
            self.bridge_status[intent_id] = "SOURCE_SUBMITTED" if source_tx_hash else "AWAITING_SOURCE"
        else:
            self.bridge_status[intent_id] = "FAILED"

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

        return json.dumps({
            "intent_id": intent_id,
            "status": status,
            "reason": reason
        })

    @gl.public.write
    def bind_source_transaction(self, intent_id: str, source_tx_hash: str) -> None:
        if intent_id not in self.intents:
            raise Exception("Intent not found")
        
        record = self.intents[intent_id]
        if gl.message.sender_address != record.sender:
            raise Exception("Only the intent creator can bind the hash")
        if record.status != "APPROVED":
            raise Exception("Intent is not APPROVED")
        if self.bridge_status.get(intent_id, "") != "AWAITING_SOURCE":
            raise Exception("Intent is not waiting for a source transaction")

        tx_timestamp = int(datetime.now(timezone.utc).timestamp())
        if tx_timestamp > self.intent_expiry.get(intent_id, 0):
            raise Exception("Intent bridge execution window has expired (60 mins)")

        if self.processed_txs.get(source_tx_hash, False):
            raise Exception("Source hash already consumed")

        self.processed_txs[source_tx_hash] = True
        record.source_tx_hash = source_tx_hash
        self.intents[intent_id] = record
        self.bridge_status[intent_id] = "SOURCE_SUBMITTED"

    @gl.public.write
    def report_bridge_status(self, intent_id: str, new_status: str, destination_tx_hash: str) -> None:
        if gl.message.sender_address != self.bridge_reporter:
            raise Exception("Only the authorized Bridge Oracle can report status")
        if intent_id not in self.intents:
            raise Exception("Intent not found")

        current = self.bridge_status.get(intent_id, "")
        if new_status == "SOURCE_CONFIRMED" and current != "SOURCE_SUBMITTED":
            raise Exception("Invalid status transition to SOURCE_CONFIRMED")
        if new_status == "COMPLETED" and current != "SOURCE_CONFIRMED":
            raise Exception("Invalid status transition to COMPLETED")

        self.bridge_status[intent_id] = new_status
        if destination_tx_hash:
            self.destination_tx_by_intent[intent_id] = destination_tx_hash

    @gl.public.view
    def get_intent(self, intent_id: str) -> str:
        if intent_id not in self.intents:
            return json.dumps({"error": "Intent ID not found"})

        record = self.intents[intent_id]
        return json.dumps({
            "intent_id": record.intent_id,
            "source_chain": record.source_chain,
            "source_tx_hash": record.source_tx_hash,
            "target_chain": record.target_chain,
            "action": record.action,
            "status": record.status,
            "bridge_state": self.bridge_status.get(intent_id, "UNKNOWN"),
            "safety_score": record.safety_score,
            "deposit_amount": record.deposit_amount,
            "asset": record.asset,
            "execution_route": record.execution_route,
            "ai_reasoning": record.ai_reasoning,
            "sender": str(record.sender)
        })

    @gl.public.view
    def get_protocol_overview(self) -> str:
        return json.dumps({
            "protocol": "Nexus Omni-Chain Intent Router",
            "version": "3.0 (Autonomous Oracle Architecture)",
            "active_status": "PAUSED" if self.is_paused else "OPERATIONAL",
            "minimum_safety_score": str(self.minimum_safety_score),
            "supported_chains": SUPPORTED_CHAINS,
            "total_intents_routed": str(self.total_intents_routed),
            "total_volume_scaled": str(self.total_volume_processed)
        })

    @gl.public.write
    def set_paused(self, paused: bool):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the protocol owner may pause/unpause")
        self.is_paused = paused

    @gl.public.write
    def set_minimum_safety_score(self, score: int):
        if gl.message.sender_address != self.owner:
            raise Exception("Only owner")
        self.minimum_safety_score = score

    @gl.public.write
    def set_chain_paused(self, chain: str, paused: bool):
        if gl.message.sender_address != self.owner:
            raise Exception("Only owner")
        self.chain_paused[str(chain).upper()] = paused