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
PAYLOAD_TTL_SECONDS = 60
INTENT_EXPIRY_SECONDS = 3600
ORACLE_SNIPPET_CHARS = 1500

SUPPORTED_CHAINS = ["ETHEREUM", "ARBITRUM", "BASE", "SOLANA", "NEAR"]
ACTION_ALLOWLIST = ["EXECUTE_SWAP", "EXECUTE_SWAP_AND_STAKE", "BRIDGE_TRANSFER", "STAKE", "HOLD"]
TERMINAL_BRIDGE_STATES = ["COMPLETED", "FAILED", "CANCELLED"]

ORACLE_PRIMARY_URL = "https://api.llama.fi/chains"
ORACLE_SECONDARY_URL = "https://api.llama.fi/v2/chains"

# API display names for the supported chains, used to pre-filter oracle
# responses. The endpoints return 400+ chains in arbitrary order, so a raw
# truncation window would hide the chains the AI must verify.
ORACLE_CHAIN_NAMES = {
    "ETHEREUM": "Ethereum",
    "ARBITRUM": "Arbitrum",
    "BASE": "Base",
    "SOLANA": "Solana",
    "NEAR": "Near",
}


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
    oracle_sources: str
    oracle_fingerprint: str


class NexusIntentRouter(gl.Contract):
    # NOTE: owner/bridge_reporter are lowercase hex STRINGS, not Address.
    # An Address decoded from calldata does not compare equal to
    # gl.message.sender_address for the same wallet (verified adversarially
    # on StudioNet), which silently broke set_bridge_reporter and would have
    # bricked transfer_ownership. Normalizing both sides to lowercase strings
    # keeps every comparison consistent. Do not "simplify" these back.
    owner: str
    is_paused: bool
    total_intents_routed: bigint
    total_volume_processed: bigint

    processed_hashes: TreeMap[str, bool]
    processed_txs: TreeMap[str, bool]
    intents: TreeMap[str, IntentRecord]

    minimum_safety_score: bigint
    bridge_reporter: str
    chain_paused: TreeMap[str, bool]
    asset_paused: TreeMap[str, bool]
    # NOTE: keyed by lowercase hex string, NOT Address. TreeMap[Address] key
    # lookups do not match gl.message.sender_address against an Address
    # decoded from calldata (verified adversarially on StudioNet), while
    # plain-string keys do. Do not "simplify" this back to Address keys.
    blocked_senders: TreeMap[str, bool]

    bridge_status: TreeMap[str, str]
    destination_tx_by_intent: TreeMap[str, str]
    chain_usage_stats: TreeMap[str, bigint]
    intent_expiry: TreeMap[str, bigint]

    def __init__(self):
        self.owner = str(gl.message.sender_address).lower()
        self.bridge_reporter = str(gl.message.sender_address).lower()
        self.is_paused = False
        self.total_intents_routed = 0
        self.total_volume_processed = 0
        self.minimum_safety_score = 75

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

    def _valid_tx_hash(self, value: str) -> bool:
        if len(value) != 66:
            return False
        if not value.startswith("0x"):
            return False
        for char in value[2:]:
            is_num = char >= "0" and char <= "9"
            is_lo = char >= "a" and char <= "f"
            is_hi = char >= "A" and char <= "F"
            if not (is_num or is_lo or is_hi):
                return False
        return True

    def _parse_safety_score(self, value) -> int:
        text = str(value).strip()
        if len(text) == 0 or len(text) > 3:
            raise Exception("Safety score is not a plain 0-100 integer")
        score = 0
        for char in text:
            if char < "0" or char > "9":
                raise Exception("Safety score is not a plain 0-100 integer")
            score = score * 10 + int(char)
        if score > 100:
            raise Exception("Safety score exceeds 100")
        return score

    def _require_owner(self):
        if str(gl.message.sender_address).lower() != self.owner:
            raise Exception("Only the protocol owner may call this function")

    def _extract_supported_chains(self, body: str) -> str:
        try:
            data = json.loads(body)
        except Exception:
            return body[:ORACLE_SNIPPET_CHARS]
        if isinstance(data, list):
            wanted = set(ORACLE_CHAIN_NAMES.values())
            picked = []
            for entry in data:
                if isinstance(entry, dict) and entry.get("name") in wanted:
                    picked.append({
                        "name": entry.get("name"),
                        "tvl": entry.get("tvl"),
                        "tokenSymbol": entry.get("tokenSymbol"),
                        "chainId": entry.get("chainId"),
                    })
            if picked:
                return json.dumps(picked, sort_keys=True)
        return body[:ORACLE_SNIPPET_CHARS]

    @gl.public.write
    def route_cross_chain_intent(
        self, intent_id: str, payload_json: str, expected_sha256: str
    ) -> str:
        caller = gl.message.sender_address

        if self.is_paused:
            raise Exception("Nexus Protocol is currently paused by governance")
        if self.blocked_senders.get(str(caller).lower(), False):
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
        if age < 0 or age > PAYLOAD_TTL_SECONDS:
            raise Exception(f"Payload stale. Outside the {PAYLOAD_TTL_SECONDS}-second TTL (Age: {age}s)")

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

        if source_tx_hash:
            if not self._valid_tx_hash(source_tx_hash):
                raise Exception("Source transaction hash is not valid 0x-prefixed 32-byte hex")
            if self.processed_txs.get(source_tx_hash, False):
                raise Exception("Source chain transaction hash already consumed")

        deposit_scaled = self._parse_scaled_decimal(deposit_amount_str)
        if deposit_scaled <= 0:
            raise Exception("Deposit value must be strictly positive")
        if not isinstance(chain_metrics, dict):
            raise Exception("chain_metrics must be an object containing candidate chains")

        historical_metrics = {chain: int(self.chain_usage_stats.get(chain, 0)) for chain in SUPPORTED_CHAINS}
        min_score = int(self.minimum_safety_score)

        prompt = f"""
You are the Nexus Omni-Chain AI Routing and Security Engine.
Analyze this cross-chain user intent against both the untrusted user payload and the live oracle telemetry below.

Source Chain: {source_chain}
Source Tx: {source_tx_hash if source_tx_hash else "(not yet bound)"}
Deposit: {deposit_amount_str} {asset}
User Intent: {user_intent}

Provided Frontend Telemetry (UNTRUSTED - verify against oracle data):
{json.dumps(chain_metrics, sort_keys=True, indent=2)}

Historical Protocol Volume (Successful Bridges):
{json.dumps(historical_metrics, sort_keys=True)}

Evaluation Criteria:
1. Optimal Route: Select the best target chain that fulfills the user's intent based on the aggregated data.
2. Oracle Verification: The oracle section below lists which sources were reachable. Cross-check the untrusted frontend telemetry against EVERY reachable oracle source. If the frontend data is heavily manipulated or contradicts the oracle data, penalize the safety score or reject the transaction.
3. Safety: Output a safety_score as a plain integer string from 0 to 100 (e.g. "98"). Any score below {min_score} will be automatically rejected.
4. Supported Chains: target_chain must be strictly one of {json.dumps(SUPPORTED_CHAINS)}.
5. Action: action must be strictly one of {json.dumps(ACTION_ALLOWLIST)}.

Return ONLY valid JSON matching this structure:
{{
    "status": "APPROVED",
    "target_chain": "SOLANA",
    "action": "EXECUTE_SWAP_AND_STAKE",
    "safety_score": "98",
    "execution_route": "Ethereum -> Wormhole Core -> Destination",
    "reason": "Solana offers the lowest fees per user intent. Both oracle sources verified."
}}
If the intent is malicious or the frontend telemetry is heavily manipulated, set "status" to "REJECTED".
"""

        # ==========================================
        # V4 UPGRADE: Dual-Source Web Oracle (fail-closed)
        # ==========================================
        def fetch_dual_oracle() -> tuple:
            parts = []
            sources = []
            for name, url in (("primary", ORACLE_PRIMARY_URL), ("secondary", ORACLE_SECONDARY_URL)):
                try:
                    res = gl.nondet.web.get(url)
                    body = res.body.decode("utf-8")
                    snippet = self._extract_supported_chains(body)
                    parts.append(f"--- {name.upper()} ({url}) ---\n{snippet}")
                    sources.append(name)
                except Exception:
                    parts.append(f"--- {name.upper()} ({url}) ---\nUNAVAILABLE")
            header = "ORACLE SOURCE STATUS: " + (",".join(sources) if sources else "NONE")
            section = header + "\n" + "\n".join(parts)
            fingerprint = hashlib.sha256(section.encode()).hexdigest()
            return section, ",".join(sources), fingerprint

        def run_ai_with_dual_oracle() -> dict:
            section, sources, fingerprint = fetch_dual_oracle()
            if not sources:
                return {"status": "ORACLE_UNAVAILABLE", "_oracle_sources": "", "_oracle_fingerprint": fingerprint}
            dynamic_prompt = prompt + "\n\nLIVE Web Oracle Telemetry (independent on-chain fetch, pre-filtered to the 5 supported chains with live TVL):\n" + section
            llm_out = gl.nondet.exec_prompt(dynamic_prompt, response_format="json")
            if not isinstance(llm_out, dict):
                return {"status": "MALFORMED", "_oracle_sources": sources, "_oracle_fingerprint": fingerprint}
            llm_out["_oracle_sources"] = sources
            llm_out["_oracle_fingerprint"] = fingerprint
            return llm_out

        def leader_fn():
            return run_ai_with_dual_oracle()

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            leader_data = leader_result.calldata
            if not isinstance(leader_data, dict):
                return False
            leader_status = leader_data.get("status")
            if leader_status == "ORACLE_UNAVAILABLE":
                check = run_ai_with_dual_oracle()
                return isinstance(check, dict) and check.get("status") == "ORACLE_UNAVAILABLE"
            if leader_status not in ("APPROVED", "REJECTED"):
                return False
            check = run_ai_with_dual_oracle()
            if not isinstance(check, dict):
                return False
            if check.get("status") == "ORACLE_UNAVAILABLE":
                return False
            if check.get("status") != leader_status:
                return False
            if leader_status == "APPROVED":
                if check.get("target_chain") != leader_data.get("target_chain"):
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
        oracle_sources = ""
        oracle_fingerprint = ""

        if consensus_failed:
            status = "REJECTED_CONSENSUS_FAILED"
            reason = "AI consensus failed to reach quorum. Intent halted for safety."
        elif not isinstance(ai_result, dict):
            status = "REJECTED_CONSENSUS_FAILED"
            reason = "AI consensus returned an invalid envelope. Intent halted for safety."
        elif ai_result.get("status") == "ORACLE_UNAVAILABLE":
            status = "REJECTED_ORACLE_UNAVAILABLE"
            reason = "Both web oracle sources were unreachable. Refusing to judge on untrusted frontend telemetry alone."
            oracle_sources = str(ai_result.get("_oracle_sources", ""))
            oracle_fingerprint = str(ai_result.get("_oracle_fingerprint", ""))
        else:
            oracle_sources = str(ai_result.get("_oracle_sources", ""))
            oracle_fingerprint = str(ai_result.get("_oracle_fingerprint", ""))
            ai_status = ai_result.get("status", "REJECTED")
            if ai_status != "APPROVED":
                status = "REJECTED_BY_AI"
                reason = str(ai_result.get("reason", "Rejected by AI policy"))
            else:
                try:
                    v_target = str(ai_result.get("target_chain", "NONE"))
                    v_action = str(ai_result.get("action", "HALT"))
                    v_score = self._parse_safety_score(ai_result.get("safety_score", "0"))
                    if v_target not in SUPPORTED_CHAINS:
                        raise Exception("AI selected an unsupported target chain")
                    if v_action not in ACTION_ALLOWLIST:
                        raise Exception("AI selected an action outside the allowlist")
                except Exception as e:
                    status = "REJECTED_BY_AI"
                    reason = f"AI verdict failed strict schema validation: {e}"
                else:
                    target_chain = v_target
                    action = v_action
                    safety_score = str(v_score)
                    execution_route = str(ai_result.get("execution_route", "Direct"))
                    reason = str(ai_result.get("reason", "Approved"))

                    if v_score < min_score:
                        status = "REJECTED_SAFETY_SCORE"
                        reason = f"AI safety score {v_score} is below governance minimum of {min_score}"
                    elif self.chain_paused.get(target_chain, False):
                        status = "REJECTED_CHAIN_PAUSED"
                        reason = "Target chain selected by AI is currently paused"

        self.processed_hashes[expected_sha256] = True
        if source_tx_hash:
            self.processed_txs[source_tx_hash] = True

        self.total_intents_routed += 1
        self.intent_expiry[intent_id] = tx_timestamp + INTENT_EXPIRY_SECONDS

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
            oracle_sources=oracle_sources,
            oracle_fingerprint=oracle_fingerprint,
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

        if not self._valid_tx_hash(source_tx_hash):
            raise Exception("Source transaction hash is not valid 0x-prefixed 32-byte hex")
        if self.processed_txs.get(source_tx_hash, False):
            raise Exception("Source hash already consumed")

        self.processed_txs[source_tx_hash] = True
        record.source_tx_hash = source_tx_hash
        self.intents[intent_id] = record
        self.bridge_status[intent_id] = "SOURCE_SUBMITTED"

    @gl.public.write
    def cancel_intent(self, intent_id: str) -> None:
        if intent_id not in self.intents:
            raise Exception("Intent not found")

        record = self.intents[intent_id]
        if gl.message.sender_address != record.sender:
            raise Exception("Only the intent creator can cancel the intent")
        if self.bridge_status.get(intent_id, "") != "AWAITING_SOURCE":
            raise Exception("Only intents awaiting a source transaction can be cancelled")

        self.bridge_status[intent_id] = "CANCELLED"

    @gl.public.write
    def report_bridge_status(self, intent_id: str, new_status: str, destination_tx_hash: str) -> None:
        if str(gl.message.sender_address).lower() != self.bridge_reporter:
            raise Exception("Only the authorized Bridge Oracle can report status")
        if intent_id not in self.intents:
            raise Exception("Intent not found")

        current = self.bridge_status.get(intent_id, "")
        if current in TERMINAL_BRIDGE_STATES:
            raise Exception("Intent is in a terminal state; no further transitions allowed")
        if new_status == "SOURCE_CONFIRMED" and current != "SOURCE_SUBMITTED":
            raise Exception("Invalid status transition to SOURCE_CONFIRMED")
        if new_status == "COMPLETED" and current != "SOURCE_CONFIRMED":
            raise Exception("Invalid status transition to COMPLETED")
        if new_status not in ("SOURCE_CONFIRMED", "COMPLETED"):
            raise Exception("Unknown bridge status")

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
            "sender": str(record.sender),
            "oracle_sources": record.oracle_sources,
            "oracle_fingerprint": record.oracle_fingerprint
        })

    @gl.public.view
    def get_protocol_overview(self) -> str:
        return json.dumps({
            "protocol": "Nexus Omni-Chain Intent Router",
            "version": "4.0 (Dual-Source Oracle + Hardened Governance)",
            "active_status": "PAUSED" if self.is_paused else "OPERATIONAL",
            "minimum_safety_score": str(self.minimum_safety_score),
            "supported_chains": SUPPORTED_CHAINS,
            "action_allowlist": ACTION_ALLOWLIST,
            "total_intents_routed": str(self.total_intents_routed),
            "total_volume_scaled": str(self.total_volume_processed)
        })

    @gl.public.write
    def set_paused(self, paused: bool):
        self._require_owner()
        self.is_paused = paused

    @gl.public.write
    def set_minimum_safety_score(self, score: int):
        self._require_owner()
        if score < 1 or score > 100:
            raise Exception("Safety score threshold must be between 1 and 100")
        self.minimum_safety_score = score

    @gl.public.write
    def set_chain_paused(self, chain: str, paused: bool):
        self._require_owner()
        chain = str(chain).upper()
        if not self._is_supported_chain(chain):
            raise Exception("Chain is not supported by Nexus")
        self.chain_paused[chain] = paused

    @gl.public.write
    def set_asset_paused(self, asset: str, paused: bool):
        self._require_owner()
        self.asset_paused[str(asset).upper()] = paused

    @gl.public.write
    def set_sender_blocked(self, sender: Address, blocked: bool):
        self._require_owner()
        self.blocked_senders[str(sender).lower()] = blocked

    @gl.public.write
    def set_bridge_reporter(self, reporter: Address):
        self._require_owner()
        self.bridge_reporter = str(reporter).lower()

    @gl.public.write
    def transfer_ownership(self, new_owner: Address):
        self._require_owner()
        self.owner = str(new_owner).lower()
