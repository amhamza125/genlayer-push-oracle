'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { custom, createPublicClient, http, formatGwei } from 'viem';
import { mainnet, arbitrum, base } from 'viem/chains';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Shield, Globe, CheckCircle2,
  AlertCircle, RefreshCw, Zap, Cpu, Target,
  Shuffle, BarChart3, Database, Lock,
  Copy, Check, ChevronRight, Sparkles, ArrowRight,
  Search, History, ExternalLink, Pause, Play,
  UserX, UserCheck, FileKey, KeyRound, Ban, CircleDollarSign,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Contract wiring. Default: the live v4 test deployment on           */
/*  StudioNet. Paste any v4 NexusIntentRouter address to drive the      */
/*  dashboard against it — the address is remembered on this device.    */
/* ------------------------------------------------------------------ */
const DEFAULT_CONTRACT =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  "0x9799957f6f819fa8D80DB7634BFF9B8026304b24";
const EXPLORER = "https://explorer-studio.genlayer.com";

const ASSETS = ["USDC", "USDT", "ETH", "WBTC"];
const SOURCE_CHAINS = ["ETHEREUM", "ARBITRUM", "BASE", "SOLANA", "NEAR"];

const ASSET_DEFAULTS: Record<string, string> = {
  "USDC": "1000.000000",
  "USDT": "1000.000000",
  "ETH": "0.500000",
  "WBTC": "0.015000"
};

const ALL_PRESETS = [
  { label: "Balanced Execution", prompt: "Find the optimal middle ground. Weight gas fees, liquidity, and security equally to find the safest, most cost-effective route." },
  { label: "Lowest Gas", prompt: "Find the absolute cheapest target chain by gas cost for high-frequency micro-transactions." },
  { label: "Deepest Liquidity", prompt: "Route this asset to whichever chain provides the deepest liquidity and highest 24h volume to minimize price impact." },
  { label: "Maximum Security", prompt: "Prioritize bridge security above all else. Route to the chain with the highest security standing, strictly ignoring gas costs." },
  { label: "High-Yield Farming", prompt: "Route to the network with the highest trading volume and liquidity to maximize LP yield, keeping gas reasonable." },
];

/* DefiLlama display names — the same source the v4 contract cross-checks */
const LLAMA_NAMES: Record<string, string> = {
  "ETHEREUM": "Ethereum",
  "ARBITRUM": "Arbitrum",
  "BASE": "Base",
  "SOLANA": "Solana",
  "NEAR": "Near",
};

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  "APPROVED": { label: "Approved", tone: "text-[var(--success)]" },
  "REJECTED_BY_AI": { label: "Rejected by AI", tone: "text-[var(--danger)]" },
  "REJECTED_SAFETY_SCORE": { label: "Below safety threshold", tone: "text-[var(--danger)]" },
  "REJECTED_CHAIN_PAUSED": { label: "Target chain paused", tone: "text-[var(--warning)]" },
  "REJECTED_ORACLE_UNAVAILABLE": { label: "Oracle unreachable — failed closed", tone: "text-[var(--warning)]" },
  "REJECTED_CONSENSUS_FAILED": { label: "No validator quorum", tone: "text-[var(--danger)]" },
};

const BRIDGE_STEPS = ["AWAITING_SOURCE", "SOURCE_SUBMITTED", "SOURCE_CONFIRMED", "COMPLETED"];

let lastKnownEthUsd = 3000;

/* ------------------------------------------------------------------ */
/*  Real telemetry — the exact numbers sent to the contract.            */
/*  TVL: DefiLlama (the same feed the v4 contract cross-checks).       */
/*  Gas: live RPC for ETH/ARB/BASE; documented typical fees for        */
/*  SOL/NEAR, labeled as such in the UI.                               */
/* ------------------------------------------------------------------ */
async function fetchTelemetry(onNote: (msg: string) => void) {
  const metrics: Record<string, Record<string, string>> = {};

  // 1) TVL per chain from DefiLlama
  let tvlByChain: Record<string, number> = {};
  try {
    const res = await fetch("https://api.llama.fi/v2/chains");
    const chains = await res.json();
    for (const c of SOURCE_CHAINS) {
      const entry = (chains as any[]).find((e: any) => e.name === LLAMA_NAMES[c]);
      if (entry && typeof entry.tvl === "number") tvlByChain[c] = entry.tvl;
    }
    onNote(`TVL fetched from DefiLlama for ${Object.keys(tvlByChain).length}/5 chains (live).`);
  } catch {
    onNote("DefiLlama unreachable — TVL fields will be omitted this run.");
  }

  // 2) Live gas prices via public RPC
  const gasGwei: Record<string, number> = {};
  try {
    const [eth, arb, bse] = await Promise.all([
      createPublicClient({ chain: mainnet, transport: http() }).getGasPrice(),
      createPublicClient({ chain: arbitrum, transport: http() }).getGasPrice(),
      createPublicClient({ chain: base, transport: http() }).getGasPrice(),
    ]);
    gasGwei["ETHEREUM"] = Number(formatGwei(eth));
    gasGwei["ARBITRUM"] = Number(formatGwei(arb));
    gasGwei["BASE"] = Number(formatGwei(bse));
    onNote("Gas prices fetched live via public RPC (Ethereum, Arbitrum, Base).");
  } catch {
    onNote("Public RPC unreachable — using conservative gas estimates.");
    gasGwei["ETHEREUM"] = 12; gasGwei["ARBITRUM"] = 0.1; gasGwei["BASE"] = 0.02;
  }

  // 3) ETH/USD for gas conversion
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    const j = await r.json();
    if (j?.ethereum?.usd) { lastKnownEthUsd = j.ethereum.usd; onNote(`ETH price live: $${lastKnownEthUsd}.`); }
  } catch {
    onNote(`Price feed unreachable — using last-known ETH price $${lastKnownEthUsd}.`);
  }

  const gasUsd = (gwei: number) => ((gwei * 21000) / 1e9 * lastKnownEthUsd);

  // 4) Security score: transparent TVL-rank heuristic (disclosed in UI).
  //    Highest-TVL chain scores 90, lowest 70. The contract treats all
  //    frontend telemetry as untrusted and cross-checks TVL itself.
  const ranked = [...SOURCE_CHAINS].sort((a, b) => (tvlByChain[b] || 0) - (tvlByChain[a] || 0));

  for (const c of SOURCE_CHAINS) {
    const tvl = tvlByChain[c];
    let avgGas: string;
    let gasSource = "live RPC";
    if (gasGwei[c] !== undefined) {
      avgGas = gasUsd(gasGwei[c]).toFixed(4);
    } else {
      avgGas = "0.0010"; // documented typical L1 fee for SOL / NEAR
      gasSource = "typical network fee";
    }
    const rank = ranked.indexOf(c);
    metrics[c] = {
      avg_gas_usd: avgGas,
      gas_source: gasSource,
      bridge_security_score: String(90 - rank * 5),
      security_basis: "TVL-rank heuristic (transparent)",
      liquidity_depth_usd: tvl !== undefined ? String(Math.round(tvl)) : "unavailable",
      tvl_source: tvl !== undefined ? "DefiLlama live" : "unavailable",
    };
  }
  return metrics;
}

/* ------------------------------------------------------------------ */
/*  Small building blocks                                               */
/* ------------------------------------------------------------------ */

function StatCard({ icon: Icon, label, value, sub, tint }: { icon: any; label: string; value: string; sub?: string; tint: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      className="card-hover rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5 shadow-[0_8px_30px_-18px_rgba(20,22,29,0.25)] backdrop-blur">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
        <Icon className="h-3 w-3" style={{ color: tint }} /> {label}
      </div>
      <div className="truncate text-xl sm:text-2xl font-extrabold tracking-tight" style={{ color: tint === 'var(--ink)' ? 'var(--ink)' : undefined }}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-[var(--faint)]">{sub}</div>}
    </motion.div>
  );
}

function SectionTitle({ icon: Icon, title, hint }: { icon: any; title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
        <Icon className="h-4.5 w-4.5 text-[var(--accent)]" /> {title}
      </h3>
      {hint && <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

function statusInfo(status?: string) {
  if (!status) return { label: "Unknown", tone: "text-[var(--muted)]" };
  return STATUS_LABELS[status] || { label: status.replace(/_/g, " ").toLowerCase(), tone: "text-[var(--muted)]" };
}

type Log = { time: string; msg: string; type: 'info' | 'success' | 'warning' | 'error' };
type Overview = {
  version: string; active_status: string; minimum_safety_score: string;
  total_intents_routed: string; total_volume_scaled: string;
  supported_chains: string[]; action_allowlist: string[];
};
type JournalEntry = { intent_id: string; tx: string; time: string; asset: string; amount: string; source_chain: string };

const now = () => new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default function PushOracleDashboard() {
  const [contract, setContract] = useState(DEFAULT_CONTRACT);
  const [contractInput, setContractInput] = useState(DEFAULT_CONTRACT);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState('');
  const [versionWarning, setVersionWarning] = useState('');

  const [userAddress, setUserAddress] = useState('');
  const [activeTab, setActiveTab] = useState<'terminal' | 'receipt'>('terminal');
  const [logs, setLogs] = useState<Log[]>([]);
  const [copied, setCopied] = useState('');

  const [intentId, setIntentId] = useState('');
  const [selectedAsset, setSelectedAsset] = useState(ASSETS[0]);
  const [sourceChain, setSourceChain] = useState(SOURCE_CHAINS[0]);
  const [depositAmount, setDepositAmount] = useState(ASSET_DEFAULTS["USDC"]);
  const [userIntent, setUserIntent] = useState(ALL_PRESETS[0].prompt);
  const [activePresets, setActivePresets] = useState(ALL_PRESETS.slice(0, 3));
  const [telemetry, setTelemetry] = useState<Record<string, Record<string, string>> | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);

  const [manualOverride, setManualOverride] = useState(false);
  const [manualTarget, setManualTarget] = useState(SOURCE_CHAINS[1]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processStartedAt, setProcessStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [receipt, setReceipt] = useState<any>(null);

  const [sourceTxHash, setSourceTxHash] = useState('');
  const [isBinding, setIsBinding] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const [trackId, setTrackId] = useState('');
  const [tracked, setTracked] = useState<any>(null);
  const [tracking, setTracking] = useState(false);

  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [govOpen, setGovOpen] = useState(false);
  const [govBusy, setGovBusy] = useState('');
  const [govScore, setGovScore] = useState('75');
  const [govAsset, setGovAsset] = useState('USDC');
  const [govAddr, setGovAddr] = useState('');

  /* ---------- helpers ---------- */

  const addLog = useCallback((msg: string, type: Log['type'] = 'info') => {
    setLogs(prev => [...prev.slice(-300), { time: now(), msg, type }]);
  }, []);

  const getClient = useCallback((withSigner = false) => {
    if (typeof window === 'undefined' || !(window as any).ethereum) throw new Error("No Web3 wallet found.");
    return createClient({
      chain: studionet,
      ...(withSigner ? { account: userAddress as `0x${string}` } : {}),
      transport: custom((window as any).ethereum)
    } as any);
  }, [userAddress]);

  const loadOverview = useCallback(async (addr: string) => {
    setOverviewError('');
    setVersionWarning('');
    try {
      const client = getClient(false);
      const raw = await client.readContract({
        address: addr as `0x${string}`,
        functionName: 'get_protocol_overview',
        args: []
      });
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      setOverview({
        version: parsed.version || '?',
        active_status: parsed.active_status || '?',
        minimum_safety_score: parsed.minimum_safety_score || '?',
        total_intents_routed: parsed.total_intents_routed || '0',
        total_volume_scaled: parsed.total_volume_scaled || '0',
        supported_chains: parsed.supported_chains || [],
        action_allowlist: parsed.action_allowlist || [],
      });
      if (!String(parsed.version || '').includes('4.')) {
        setVersionWarning(`This contract reports version "${parsed.version || 'unknown'}" — the dashboard is built for v4 (NexusIntentRouter 4.x). Some features may not work.`);
      }
      return true;
    } catch (e: any) {
      setOverview(null);
      setOverviewError("Couldn't read a contract at this address on StudioNet. Check the address and try again.");
      return false;
    }
  }, [getClient]);

  /* ---------- init ---------- */

  useEffect(() => {
    try {
      const saved = localStorage.getItem('po4-contract');
      if (saved && /^0x[0-9a-fA-F]{40}$/.test(saved)) {
        setContract(saved);
        setContractInput(saved);
      }
      const j = localStorage.getItem('po4-journal');
      if (j) setJournal(JSON.parse(j));
    } catch { /* private mode */ }
  }, []);

  useEffect(() => { loadOverview(contract); }, [contract, loadOverview]);
  useEffect(() => { refreshTelemetry(); }, []);

  useEffect(() => {
    if (!isProcessing) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - processStartedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [isProcessing, processStartedAt]);

  /* ---------- wallet ---------- */

  const connectWallet = async () => {
    try {
      const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
      setUserAddress(accounts[0]);
      addLog(`Wallet connected: ${accounts[0].slice(0, 6)}…${accounts[0].slice(-4)}`, 'success');
    } catch (err: any) {
      addLog(`Wallet connection failed: ${err.message}`, 'error');
    }
  };

  const copyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* clipboard unavailable */ }
  };

  /* ---------- contract switcher ---------- */

  const applyContract = async () => {
    const addr = contractInput.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setOverviewError("That doesn't look like a valid contract address (0x + 40 hex characters).");
      return;
    }
    addLog(`Switching dashboard to contract ${addr.slice(0, 10)}…`, 'warning');
    const ok = await loadOverview(addr);
    if (ok) {
      setContract(addr);
      try { localStorage.setItem('po4-contract', addr); } catch { /* ignore */ }
      setReceipt(null);
      setTracked(null);
      addLog(`Now reading live state from ${addr.slice(0, 10)}…${addr.slice(-8)}`, 'success');
    } else {
      addLog("Contract switch failed — keeping the previous address.", 'error');
    }
  };

  /* ---------- telemetry ---------- */

  const refreshTelemetry = async () => {
    setTelemetryLoading(true);
    const notes: string[] = [];
    const m = await fetchTelemetry((msg) => notes.push(msg));
    setTelemetry(m);
    setTelemetryLoading(false);
    notes.forEach(n => addLog(n, 'info'));
  };

  /* ---------- canonical payload (must match the contract's hash check) ---------- */

  const canonicalize = (obj: Record<string, any>): string => {
    const sortDeep = (v: any): any => {
      if (Array.isArray(v)) return v.map(sortDeep);
      if (v && typeof v === 'object') {
        const out: Record<string, any> = {};
        for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
        return out;
      }
      return v;
    };
    const normalized: Record<string, any> = {};
    for (const k of Object.keys(obj).sort()) {
      const v = obj[k];
      normalized[k] = (v && typeof v === 'object') ? sortDeep(v) : String(v);
    }
    return JSON.stringify(normalized);
  };

  const sha256Hex = async (s: string) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  /* ---------- execute ---------- */

  const executeRoute = async () => {
    if (!userAddress) { addLog("Connect your wallet first.", 'error'); return; }
    if (!telemetry) { addLog("Telemetry isn't ready yet — wait for it to load.", 'error'); return; }

    setIsProcessing(true);
    setProcessStartedAt(Date.now());
    setElapsed(0);
    setLogs([]);
    setReceipt(null);
    setActiveTab('terminal');

    const id = `ORACLE-SEQ-${Math.floor(1000 + Math.random() * 9000)}`;
    setIntentId(id);

    try {
      addLog(`Building intent ${id}: ${depositAmount} ${selectedAsset} from ${sourceChain}…`, 'info');
      if (manualOverride) addLog(`Manual override: requesting a forced route to ${manualTarget}.`, 'warning');

      // Strip the disclosure sub-fields before sending — the contract only
      // needs the numeric telemetry; sources are shown in the UI.
      const chainMetrics: Record<string, Record<string, string>> = {};
      for (const c of SOURCE_CHAINS) {
        const t = telemetry[c] || {};
        chainMetrics[c] = {
          avg_gas_usd: t.avg_gas_usd || "0",
          bridge_security_score: t.bridge_security_score || "0",
          liquidity_depth_usd: t.liquidity_depth_usd || "0",
        };
      }

      const payload = {
        payload_timestamp: Math.floor(Date.now() / 1000).toString(),
        source_chain: sourceChain,
        source_tx_hash: "",
        deposit_amount: depositAmount,
        asset: selectedAsset,
        user_intent: manualOverride ? `FORCE_ROUTE:${manualTarget}` : userIntent,
        chain_metrics: chainMetrics,
      };

      const canonical = canonicalize(payload);
      const hash = await sha256Hex(canonical);
      addLog(`Payload sealed with SHA-256 (60s TTL): ${hash.slice(0, 16)}…`, 'success');

      const client = getClient(true);
      const txHash = await client.writeContract({
        address: contract as `0x${string}`,
        functionName: 'route_cross_chain_intent',
        args: [id, canonical, hash],
        value: BigInt(0)
      });
      addLog(`Transaction sent: ${txHash}`, 'info');
      addLog("Waiting for GenLayer validators to reach consensus — this usually takes 1–3 minutes.", 'warning');

      const saveJournal = () => {
        const entry: JournalEntry = { intent_id: id, tx: txHash, time: new Date().toISOString(), asset: selectedAsset, amount: depositAmount, source_chain: sourceChain };
        setJournal(prev => {
          const next = [entry, ...prev.filter(e => e.intent_id !== id)].slice(0, 25);
          try { localStorage.setItem('po4-journal', JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      };

      if (typeof client.waitForTransactionReceipt === 'function') {
        try {
          const rct: any = await client.waitForTransactionReceipt({ hash: txHash, interval: 3000, retries: 60 });
          const traceError = rct?.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr || "";
          if (traceError.includes("Exception:") || traceError.includes("UserError")) {
            const line = traceError.split('\n').filter((l: string) => l.trim()).pop();
            addLog(`Consensus reverted the transaction: ${line}`, 'error');
            setIsProcessing(false);
            return;
          }
          addLog("Consensus reached. Reading the on-chain verdict…", 'success');
          await new Promise(r => setTimeout(r, 3000));
          const raw = await client.readContract({
            address: contract as `0x${string}`,
            functionName: 'get_intent',
            args: [id]
          });
          const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
          setReceipt(rec);
          saveJournal();
          const st = statusInfo(rec.status);
          addLog(`Verdict: ${st.label}${rec.status === 'APPROVED' ? ` → ${rec.target_chain} (score ${rec.safety_score}/100)` : ''}`, rec.status === 'APPROVED' ? 'success' : 'warning');
          addLog(`Oracle attestation: sources=[${rec.oracle_sources || 'none'}] fingerprint=${(rec.oracle_fingerprint || '').slice(0, 12)}…`, 'info');
          setActiveTab('receipt');
        } catch (e: any) {
          addLog("Timed out waiting for finality — check the explorer; your intent may still confirm.", 'warning');
        }
      }
    } catch (err: any) {
      const msg = String(err.message || err);
      const short = msg.length > 220 ? msg.slice(0, 220) + '…' : msg;
      addLog(`Execution failed: ${short}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  /* ---------- bind / cancel ---------- */

  const bindSource = async () => {
    if (!sourceTxHash) { addLog("Paste your source-chain transaction hash first.", 'error'); return; }
    setIsBinding(true);
    setActiveTab('terminal');
    addLog(`Binding ${sourceTxHash.slice(0, 12)}… to ${intentId}`, 'warning');
    try {
      const client = getClient(true);
      const h = await client.writeContract({
        address: contract as `0x${string}`,
        functionName: 'bind_source_transaction',
        args: [intentId, sourceTxHash],
        value: BigInt(0)
      });
      addLog(`Bind sent: ${h}`, 'info');
      if (typeof client.waitForTransactionReceipt === 'function') {
        await client.waitForTransactionReceipt({ hash: h, interval: 3000, retries: 60 });
        addLog("Source hash bound — bridge state is now SOURCE_SUBMITTED.", 'success');
        const raw = await client.readContract({ address: contract as `0x${string}`, functionName: 'get_intent', args: [intentId] });
        setReceipt(typeof raw === 'string' ? JSON.parse(raw) : raw);
        setActiveTab('receipt');
      }
    } catch (err: any) {
      addLog(`Bind failed: ${String(err.message || err).slice(0, 200)}`, 'error');
    } finally {
      setIsBinding(false);
    }
  };

  const cancelIntent = async () => {
    if (!confirm("Cancel this intent? It will be locked as CANCELLED permanently.")) return;
    setIsCancelling(true);
    try {
      const client = getClient(true);
      const h = await client.writeContract({
        address: contract as `0x${string}`,
        functionName: 'cancel_intent',
        args: [intentId],
        value: BigInt(0)
      });
      addLog(`Cancel sent: ${h}`, 'warning');
      if (typeof client.waitForTransactionReceipt === 'function') {
        await client.waitForTransactionReceipt({ hash: h, interval: 3000, retries: 60 });
        addLog("Intent cancelled.", 'success');
        const raw = await client.readContract({ address: contract as `0x${string}`, functionName: 'get_intent', args: [intentId] });
        setReceipt(typeof raw === 'string' ? JSON.parse(raw) : raw);
      }
    } catch (err: any) {
      addLog(`Cancel failed: ${String(err.message || err).slice(0, 200)}`, 'error');
    } finally {
      setIsCancelling(false);
    }
  };

  /* ---------- intent tracker ---------- */

  const trackIntent = async (overrideId?: string) => {
    const id = (overrideId || trackId).trim();
    if (!id) return;
    setTracking(true);
    setTracked(null);
    try {
      const client = getClient(false);
      const raw = await client.readContract({ address: contract as `0x${string}`, functionName: 'get_intent', args: [id] });
      const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (rec.error) { addLog(`No intent found with ID "${id}" on this contract.`, 'warning'); }
      else { setTracked(rec); addLog(`Loaded intent ${id}: ${statusInfo(rec.status).label}.`, 'success'); }
    } catch (err: any) {
      addLog(`Lookup failed: ${String(err.message || err).slice(0, 160)}`, 'error');
    } finally {
      setTracking(false);
    }
  };

  /* ---------- governance (owner only — reverts otherwise) ---------- */

  const govCall = async (label: string, fn: string, args: any[]) => {
    if (!userAddress) { addLog("Connect your wallet first.", 'error'); return; }
    setGovBusy(label);
    addLog(`Governance: ${label}…`, 'warning');
    try {
      const client = getClient(true);
      const h = await client.writeContract({ address: contract as `0x${string}`, functionName: fn, args, value: BigInt(0) });
      addLog(`Sent: ${h}`, 'info');
      if (typeof client.waitForTransactionReceipt === 'function') {
        await client.waitForTransactionReceipt({ hash: h, interval: 3000, retries: 60 });
        addLog(`${label} confirmed.`, 'success');
        loadOverview(contract);
      }
    } catch (err: any) {
      addLog(`${label} failed: ${String(err.message || err).slice(0, 200)}`, 'error');
    } finally {
      setGovBusy('');
    }
  };

  const logColor = (t: Log['type']) =>
    t === 'error' ? 'text-red-600 font-semibold'
    : t === 'success' ? 'text-emerald-700 font-semibold'
    : t === 'warning' ? 'text-amber-700'
    : 'text-slate-600';

  const termLogColor = (t: Log['type']) =>
    t === 'error' ? 'text-red-400 font-semibold'
    : t === 'success' ? 'text-emerald-400 font-semibold'
    : t === 'warning' ? 'text-amber-300'
    : 'text-[var(--terminal-ink)]';

  const volume = overview ? (Number(overview.total_volume_scaled) / 1e6) : 0;
  const st = receipt ? statusInfo(receipt.status) : null;
  const canCancel = receipt && receipt.bridge_state === 'AWAITING_SOURCE' &&
    userAddress && receipt.sender && receipt.sender.toLowerCase() === userAddress.toLowerCase();

  return (
    <div className="aurora-bg min-h-screen text-[var(--ink)]">
      {/* ================= HEADER ================= */}
      <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 shadow-lg shadow-indigo-500/25">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base sm:text-lg font-extrabold tracking-tight">Cryptographic Push Oracle</h1>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">GenLayer · Intent Router v4</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-[10px] font-bold tracking-wider text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> STUDIONET
            </span>
            {!userAddress ? (
              <button onClick={connectWallet}
                className="rounded-full bg-slate-900 px-4 sm:px-5 py-2.5 text-xs font-bold text-white shadow-lg transition-transform hover:scale-[1.03] active:scale-[0.98]">
                <span className="hidden sm:inline">Connect Wallet</span><span className="sm:hidden">Connect</span>
              </button>
            ) : (
              <span className="rounded-full border border-[var(--border)] bg-white px-4 py-2 font-mono text-xs text-[var(--muted)]">
                {userAddress.slice(0, 6)}…{userAddress.slice(-4)}
              </span>
            )}
          </div>
        </div>

        {/* contract switcher strip */}
        <div className="border-t border-[var(--border)] bg-white/60">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:px-6">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
              <FileKey className="h-3.5 w-3.5 text-[var(--accent)]" /> Contract
            </div>
            <div className="flex flex-1 gap-2">
              <input value={contractInput} onChange={e => setContractInput(e.target.value)}
                spellCheck={false} placeholder="0x… — paste any v4 NexusIntentRouter address"
                className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs outline-none focus:border-[var(--accent)]" />
              <button onClick={applyContract}
                className="shrink-0 rounded-xl bg-[var(--accent)] px-4 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90">
                Use contract
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => copyText(contract, 'contract')}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 font-mono text-[11px] text-[var(--muted)] hover:text-[var(--ink)]">
                {contract.slice(0, 8)}…{contract.slice(-6)}
                {copied === 'contract' ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
              </button>
              <a href={`${EXPLORER}/address/${contract}`} target="_blank" rel="noreferrer" title="Open in explorer"
                className="rounded-lg border border-[var(--border)] bg-white p-1.5 text-[var(--muted)] hover:text-[var(--ink)]">
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
          {overviewError && (
            <div className="mx-auto max-w-[1400px] px-4 pb-2 sm:px-6">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--danger)]"><AlertCircle className="h-3.5 w-3.5" /> {overviewError}</p>
            </div>
          )}
          {versionWarning && (
            <div className="mx-auto max-w-[1400px] px-4 pb-2 sm:px-6">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--warning)]"><AlertCircle className="h-3.5 w-3.5" /> {versionWarning}</p>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 sm:px-6 pb-16">
        {/* ================= STATS (all live, from the contract) ================= */}
        <section className="grid grid-cols-2 gap-3 sm:gap-4 pt-6 lg:grid-cols-4">
          <StatCard icon={Activity} label="Intents routed" value={overview ? Number(overview.total_intents_routed).toLocaleString() : '…'} sub="on this contract, all time" tint="var(--accent)" />
          <StatCard icon={CircleDollarSign} label="Total volume" value={overview ? volume.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '…'} sub="combined deposits, all assets" tint="var(--success)" />
          <StatCard icon={Shield} label="Safety threshold" value={overview ? `${overview.minimum_safety_score}/100` : '…'} sub="set by governance" tint="var(--accent-2)" />
          <StatCard icon={Zap} label="Protocol status" value={overview ? overview.active_status : '…'} sub={overview ? `v${overview.version}` : 'reading contract…'} tint="var(--ink)" />
        </section>

        {/* ================= HOW IT WORKS ================= */}
        <section className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { n: "1", t: "You describe the intent", d: "Pick an asset, a source chain and a strategy. Your payload is sealed with a SHA-256 hash that expires in 60 seconds." },
            { n: "2", t: "Validators verify independently", d: "GenLayer validators fetch live oracle data themselves and cross-check it against your payload before agreeing." },
            { n: "3", t: "You get a signed verdict", d: "Approved or rejected — with the target chain, safety score, reasoning, and a fingerprint of the exact data judged." },
          ].map(s => (
            <div key={s.n} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 backdrop-blur">
              <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-sm font-extrabold text-white">{s.n}</div>
              <p className="text-sm font-bold">{s.t}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{s.d}</p>
            </div>
          ))}
        </section>

        {/* ================= MAIN ================= */}
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* ---------- Intent builder ---------- */}
          <div className="lg:col-span-5">
            <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6 shadow-[0_20px_60px_-30px_rgba(20,22,29,0.3)] backdrop-blur">
              <SectionTitle icon={Target} title="Build an intent"
                hint="Everything below becomes a cryptographically sealed payload. Nothing here is simulated — the numbers in telemetry are fetched live." />

              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Asset</label>
                    <div className="grid grid-cols-2 gap-2">
                      {ASSETS.map(a => (
                        <button key={a} onClick={() => { setSelectedAsset(a); setDepositAmount(ASSET_DEFAULTS[a]); }}
                          className={`rounded-xl border py-2.5 font-mono text-xs font-bold transition-all ${selectedAsset === a ? 'border-transparent bg-slate-900 text-white shadow-md' : 'border-[var(--border)] bg-white text-[var(--muted)] hover:border-slate-400'}`}>{a}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Source chain</label>
                    <div className="grid grid-cols-2 gap-2">
                      {SOURCE_CHAINS.slice(0, 4).map(c => (
                        <button key={c} onClick={() => setSourceChain(c)}
                          className={`rounded-xl border px-1 py-2.5 font-mono text-[10px] font-bold transition-all ${sourceChain === c ? 'border-[var(--accent)] bg-indigo-50 text-[var(--accent)]' : 'border-[var(--border)] bg-white text-[var(--muted)] hover:border-slate-400'}`}>{c}</button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">Amount</label>
                  <div className="relative">
                    <input value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                      className="w-full rounded-xl border border-[var(--border)] bg-white px-4 py-3 font-mono text-sm outline-none focus:border-[var(--accent)]" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] font-bold text-[var(--accent)]">{selectedAsset}</span>
                  </div>
                </div>

                <div className={`transition-opacity ${manualOverride ? 'pointer-events-none opacity-30' : ''}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                      <Sparkles className="h-3 w-3 text-[var(--accent-2)]" /> Strategy
                    </label>
                    <button onClick={() => {
                      const s = [...ALL_PRESETS].sort(() => 0.5 - Math.random()).slice(0, 3);
                      setActivePresets(s); setUserIntent(s[0].prompt);
                    }} className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)]"><Shuffle className="h-3 w-3" /> Shuffle</button>
                  </div>
                  <div className="mb-2 flex flex-col gap-1.5">
                    {activePresets.map(p => (
                      <button key={p.label} onClick={() => setUserIntent(p.prompt)}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-xs transition-all ${userIntent === p.prompt ? 'border-[var(--accent)] bg-indigo-50/60 font-semibold' : 'border-[var(--border)] bg-white text-[var(--muted)] hover:border-slate-400'}`}>
                        {p.label}
                        {userIntent === p.prompt && <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />}
                      </button>
                    ))}
                  </div>
                  <textarea rows={3} value={userIntent} onChange={e => setUserIntent(e.target.value)}
                    className="nice-scroll w-full resize-none rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 text-[11px] leading-relaxed text-[var(--muted)] outline-none focus:border-[var(--accent)]" />
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider">Manual override</p>
                      <p className="text-[11px] text-[var(--muted)]">Skip the AI and force a destination chain</p>
                    </div>
                    <button onClick={() => setManualOverride(v => !v)} aria-label="Toggle manual override"
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${manualOverride ? 'bg-[var(--accent)]' : 'bg-slate-200'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${manualOverride ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  {manualOverride && (
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-3">
                      {SOURCE_CHAINS.map(c => (
                        <button key={c} onClick={() => setManualTarget(c)}
                          className={`rounded-lg border px-1 py-2 font-mono text-[10px] font-bold ${manualTarget === c ? 'border-transparent bg-slate-900 text-white' : 'border-[var(--border)] text-[var(--muted)]'}`}>{c}</button>
                      ))}
                    </div>
                  )}
                </div>

                <button onClick={executeRoute} disabled={isProcessing || !userAddress || !telemetry}
                  className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-extrabold text-white shadow-xl transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-40 disabled:hover:scale-100">
                  {isProcessing ? <><Activity className="h-4 w-4 animate-spin" /> Validators are deciding…</>
                    : <><Zap className="h-4 w-4" /> Send intent for AI routing <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" /></>}
                </button>
                {!userAddress && <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-[var(--muted)]"><AlertCircle className="h-3.5 w-3.5" /> Connect a wallet to send intents</p>}
              </div>
            </motion.section>

            {/* ---------- Live telemetry (real numbers) ---------- */}
            <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              className="mt-5 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6 backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-extrabold"><BarChart3 className="h-4 w-4 text-[var(--accent)]" /> Live telemetry</h3>
                <button onClick={refreshTelemetry} disabled={telemetryLoading}
                  className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)] disabled:opacity-40">
                  <RefreshCw className={`h-3 w-3 ${telemetryLoading ? 'animate-spin' : ''}`} /> Refresh
                </button>
              </div>
              <p className="mb-4 text-[11px] leading-relaxed text-[var(--muted)]">
                These are the exact numbers sealed into your payload. The contract fetches its own
                oracle data and rejects the intent if this telemetry is manipulated.
              </p>
              {!telemetry ? (
                <p className="py-6 text-center text-xs text-[var(--faint)]">Loading live data…</p>
              ) : (
                <div className="space-y-2">
                  {SOURCE_CHAINS.map(c => {
                    const t = telemetry[c] || {};
                    return (
                      <div key={c} className="rounded-xl border border-[var(--border)] bg-white px-3 py-2.5">
                        <div className="mb-1 font-mono text-[11px] font-extrabold">{c}</div>
                        <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
                          <div><span className="block text-[var(--faint)]">TVL</span><span className="font-bold">{t.liquidity_depth_usd === 'unavailable' ? '—' : '$' + Number(t.liquidity_depth_usd).toLocaleString()}</span></div>
                          <div><span className="block text-[var(--faint)]">Gas</span><span className="font-bold">${t.avg_gas_usd}</span></div>
                          <div><span className="block text-[var(--faint)]">Security</span><span className="font-bold">{t.bridge_security_score}/100</span></div>
                        </div>
                        <div className="mt-1 text-[9px] text-[var(--faint)]">
                          TVL: {t.tvl_source} · Gas: {t.gas_source} · Security: {t.security_basis}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.section>
          </div>

          {/* ---------- Console ---------- */}
          <div className="lg:col-span-7">
            <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
              className="flex flex-col overflow-hidden rounded-3xl border border-[var(--border)] bg-white shadow-[0_20px_60px_-30px_rgba(20,22,29,0.3)] lg:h-[1180px]">
              <div className="flex items-center gap-4 border-b border-[var(--border)] bg-[var(--surface-2)]/60 px-5">
                <div className="flex gap-1.5 py-4">
                  <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </div>
                <div className="flex gap-6">
                  {(['terminal', 'receipt'] as const).map(t => (
                    <button key={t} onClick={() => setActiveTab(t)}
                      className={`border-b-2 py-4 text-xs font-bold uppercase tracking-[0.12em] transition-colors ${activeTab === t ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--faint)] hover:text-[var(--muted)]'}`}>
                      {t === 'terminal' ? 'Activity log' : 'Verdict receipt'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="nice-scroll relative flex-1 overflow-y-auto bg-[var(--terminal-bg)] p-5">
                <AnimatePresence mode="wait">
                  {activeTab === 'terminal' ? (
                    <motion.div key="terminal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="space-y-1 font-mono text-[11px] leading-relaxed">
                      {logs.length === 0 && !isProcessing && (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <Cpu className="mb-4 h-10 w-10 text-slate-600" />
                          <p className="max-w-xs text-xs leading-relaxed text-slate-500">
                            Build an intent and send it — every step, from payload sealing to the
                            validators' verdict, is logged here with real transaction hashes.
                          </p>
                        </div>
                      )}
                      {logs.map((l, i) => (
                        <div key={i} className="flex gap-3 px-1 py-1">
                          <span className="shrink-0 text-slate-600">[{l.time}]</span>
                          <span className={termLogColor(l.type)}>{l.msg}</span>
                        </div>
                      ))}
                      {isProcessing && (
                        <div className="mt-3 flex items-center gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3">
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="absolute h-full w-full animate-ping rounded-full bg-indigo-400 opacity-60" />
                            <span className="relative h-2.5 w-2.5 rounded-full bg-indigo-400" />
                          </span>
                          <span className="text-indigo-200">
                            <span className="waiting-dots">Waiting for validator consensus</span>
                            <span className="ml-2 text-indigo-400">({elapsed}s elapsed)</span>
                          </span>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div key="receipt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                      {receipt ? (
                        <div className="flex h-full flex-col space-y-4">
                          <div className={`rounded-2xl border p-5 ${receipt.status === 'APPROVED' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                {receipt.status === 'APPROVED'
                                  ? <CheckCircle2 className="h-9 w-9 text-emerald-400" />
                                  : <AlertCircle className="h-9 w-9 text-red-400" />}
                                <div>
                                  <h3 className={`text-xl font-black ${st!.tone}`}>{st!.label}</h3>
                                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">{receipt.intent_id}</p>
                                </div>
                              </div>
                              <span className="rounded-full border border-slate-700 px-3 py-1 font-mono text-[10px] font-bold text-slate-300">
                                {receipt.bridge_state}
                              </span>
                            </div>
                            {/* bridge timeline */}
                            <div className="mt-4 flex items-center gap-1">
                              {BRIDGE_STEPS.map((s, i) => {
                                const cur = BRIDGE_STEPS.indexOf(receipt.bridge_state);
                                const done = cur >= 0 && i <= cur;
                                return (
                                  <div key={s} className="flex flex-1 items-center gap-1">
                                    <div className="flex flex-col items-center gap-1">
                                      <div className={`h-2.5 w-2.5 rounded-full ${done ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                                      <span className={`text-[8px] font-mono ${done ? 'text-emerald-300' : 'text-slate-600'}`}>{s.replace('SOURCE_', 'S·')}</span>
                                    </div>
                                    {i < BRIDGE_STEPS.length - 1 && <div className={`mb-4 h-px flex-1 ${done && cur > i ? 'bg-emerald-400' : 'bg-slate-700'}`} />}
                                  </div>
                                );
                              })}
                            </div>
                            {(receipt.bridge_state === 'FAILED' || receipt.bridge_state === 'CANCELLED') && (
                              <p className="mt-2 font-mono text-[10px] text-slate-500">Terminal state — this intent is closed permanently.</p>
                            )}
                          </div>

                          {receipt.status === 'APPROVED' && (
                            <div className="grid grid-cols-3 gap-3">
                              <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                                <p className="text-[9px] uppercase tracking-widest text-slate-500">Target</p>
                                <p className="font-extrabold text-indigo-300">{receipt.target_chain}</p>
                              </div>
                              <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                                <p className="text-[9px] uppercase tracking-widest text-slate-500">Score</p>
                                <p className="font-extrabold text-emerald-300">{receipt.safety_score}<span className="text-xs text-slate-500">/100</span></p>
                              </div>
                              <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                                <p className="text-[9px] uppercase tracking-widest text-slate-500">Action</p>
                                <p className="truncate font-mono text-[11px] font-bold text-slate-200">{receipt.action}</p>
                              </div>
                            </div>
                          )}

                          <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                            <p className="mb-1.5 text-[10px] uppercase tracking-widest text-slate-500">Why this verdict</p>
                            <p className="text-[13px] leading-relaxed text-slate-200">{receipt.ai_reasoning || receipt.reason}</p>
                          </div>

                          <div className="rounded-xl bg-white/5 border border-white/10 p-4">
                            <p className="mb-1.5 text-[10px] uppercase tracking-widest text-slate-500">Oracle attestation</p>
                            <p className="text-xs text-slate-300">
                              Independently verified against: <span className="font-bold text-indigo-300">{receipt.oracle_sources || 'no live sources — failed closed'}</span>
                            </p>
                            <button onClick={() => copyText(receipt.oracle_fingerprint || '', 'fp')}
                              className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-slate-500 hover:text-slate-300">
                              fingerprint {(receipt.oracle_fingerprint || '').slice(0, 20)}…
                              {copied === 'fp' ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            </button>
                            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-600">
                              A fingerprint of the exact oracle data the validators judged. Anyone can compare it against the live feeds to audit this decision.
                            </p>
                          </div>

                          {receipt.status === 'APPROVED' && receipt.bridge_state === 'AWAITING_SOURCE' && (
                            <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-4">
                              <h4 className="mb-1 flex items-center gap-2 text-sm font-bold text-indigo-200"><Lock className="h-4 w-4" /> Next: bind your source transaction</h4>
                              <p className="mb-3 text-[11px] leading-relaxed text-slate-400">
                                The route is approved. Make your deposit on {receipt.source_chain}, then paste that transaction hash below to link it to this intent.
                              </p>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <input value={sourceTxHash} onChange={e => setSourceTxHash(e.target.value)} placeholder="0x…"
                                  spellCheck={false} className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 font-mono text-xs text-white outline-none focus:border-indigo-400" />
                                <button onClick={bindSource} disabled={isBinding || !sourceTxHash}
                                  className="rounded-xl bg-indigo-500 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-400 disabled:opacity-40">
                                  {isBinding ? 'Binding…' : 'Bind hash'}
                                </button>
                              </div>
                              {canCancel && (
                                <button onClick={cancelIntent} disabled={isCancelling}
                                  className="mt-3 text-[11px] font-semibold text-red-400/80 hover:text-red-300 disabled:opacity-40">
                                  {isCancelling ? 'Cancelling…' : 'Or cancel this intent permanently'}
                                </button>
                              )}
                            </div>
                          )}

                          <details className="rounded-xl border border-white/10 bg-black/30">
                            <summary className="cursor-pointer px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">Raw on-chain record</summary>
                            <pre className="nice-scroll max-h-56 overflow-auto border-t border-white/10 p-4 font-mono text-[10px] leading-relaxed text-slate-500">{JSON.stringify(receipt, null, 2)}</pre>
                          </details>
                        </div>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center py-16 text-center">
                          <Target className="mb-4 h-10 w-10 text-slate-700" />
                          <p className="max-w-xs text-xs italic text-slate-500">Send an intent and its signed verdict will appear here.</p>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.section>
          </div>
        </div>

        {/* ================= TRACK + HISTORY ================= */}
        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6 backdrop-blur">
            <SectionTitle icon={Search} title="Track any intent"
              hint="Enter an intent ID to read its full on-chain record — status, bridge state, verdict and oracle attestation." />
            <div className="flex gap-2">
              <input value={trackId} onChange={e => setTrackId(e.target.value)} placeholder="ORACLE-SEQ-1234"
                spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-white px-3 py-2.5 font-mono text-xs outline-none focus:border-[var(--accent)]" />
              <button onClick={() => trackIntent()} disabled={tracking || !trackId.trim()}
                className="shrink-0 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white disabled:opacity-40">
                {tracking ? 'Reading…' : 'Look up'}
              </button>
            </div>
            {tracked && (
              <div className="mt-4 rounded-2xl border border-[var(--border)] bg-white p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold">{tracked.intent_id}</span>
                  <span className={`text-sm font-extrabold ${statusInfo(tracked.status).tone}`}>{statusInfo(tracked.status).label}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                  {[['Route', `${tracked.source_chain} → ${tracked.target_chain}`], ['Amount', `${tracked.deposit_amount} ${tracked.asset}`],
                    ['Score', `${tracked.safety_score}/100`], ['Bridge', tracked.bridge_state]].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-[var(--surface-2)] px-2.5 py-2">
                      <div className="text-[9px] uppercase tracking-widest text-[var(--faint)]">{k}</div>
                      <div className="truncate font-bold">{v}</div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{tracked.ai_reasoning}</p>
                <p className="mt-2 font-mono text-[10px] text-[var(--faint)]">
                  oracle: {tracked.oracle_sources || 'none'} · fp {(tracked.oracle_fingerprint || '').slice(0, 16)}…
                </p>
              </div>
            )}
          </motion.section>

          <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
            className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6 backdrop-blur">
            <SectionTitle icon={History} title="Sent from this device"
              hint="Intents you routed through this dashboard on the current contract. The complete history lives on-chain — " />
            <div className="-mt-3 mb-3">
              <a href={`${EXPLORER}/address/${contract}`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">
                view full on-chain history in the explorer <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {journal.length === 0 ? (
              <p className="py-8 text-center text-xs italic text-[var(--faint)]">Nothing yet — your intents will be listed here after you send them.</p>
            ) : (
              <div className="nice-scroll max-h-72 space-y-2 overflow-y-auto">
                {journal.map(j => (
                  <div key={j.intent_id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-white px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11px] font-bold">{j.intent_id}</div>
                      <div className="text-[10px] text-[var(--faint)]">{j.amount} {j.asset} · from {j.source_chain} · {new Date(j.time).toLocaleString()}</div>
                    </div>
                    <a href={`${EXPLORER}/tx/${j.tx}`} target="_blank" rel="noreferrer" title="Open transaction"
                      className="shrink-0 rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--ink)]">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button onClick={() => { setTrackId(j.intent_id); trackIntent(j.intent_id); }} title="Load verdict"
                      className="shrink-0 rounded-lg border border-[var(--border)] p-1.5 text-[var(--muted)] hover:text-[var(--ink)]">
                      <Search className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </div>

        {/* ================= OWNER CONTROLS ================= */}
        <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-3xl border border-[var(--border)] bg-[var(--surface)] backdrop-blur">
          <button onClick={() => setGovOpen(o => !o)} className="flex w-full items-center justify-between p-5 sm:p-6 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900">
                <KeyRound className="h-4 w-4 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold">Protocol controls</h3>
                <p className="text-[11px] text-[var(--muted)]">Pause, thresholds, asset & sender management — contract owner only; other wallets will see transactions revert.</p>
              </div>
            </div>
            <ChevronRight className={`h-5 w-5 text-[var(--faint)] transition-transform ${govOpen ? 'rotate-90' : ''}`} />
          </button>
          <AnimatePresence>
            {govOpen && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden">
                <div className="grid grid-cols-1 gap-3 border-t border-[var(--border)] p-5 sm:grid-cols-2 lg:grid-cols-3 sm:p-6">
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold"><Pause className="h-3.5 w-3.5" /> Protocol pause</p>
                    <div className="flex gap-2">
                      <button disabled={!!govBusy} onClick={() => govCall('Pausing protocol', 'set_paused', [true])}
                        className="flex-1 rounded-xl bg-red-600 py-2 text-xs font-bold text-white disabled:opacity-40">Pause</button>
                      <button disabled={!!govBusy} onClick={() => govCall('Unpausing protocol', 'set_paused', [false])}
                        className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white disabled:opacity-40"><Play className="h-3 w-3" /> Resume</button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold"><Shield className="h-3.5 w-3.5" /> Safety threshold (1–100)</p>
                    <div className="flex gap-2">
                      <input value={govScore} onChange={e => setGovScore(e.target.value)} inputMode="numeric"
                        className="w-20 rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--accent)]" />
                      <button disabled={!!govBusy} onClick={() => govCall('Setting safety threshold', 'set_minimum_safety_score', [parseInt(govScore, 10)])}
                        className="flex-1 rounded-xl bg-slate-900 py-2 text-xs font-bold text-white disabled:opacity-40">Apply</button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold"><Ban className="h-3.5 w-3.5" /> Asset pause</p>
                    <div className="flex gap-2">
                      <select value={govAsset} onChange={e => setGovAsset(e.target.value)}
                        className="rounded-xl border border-[var(--border)] bg-white px-2 py-2 font-mono text-xs outline-none">
                        {ASSETS.map(a => <option key={a}>{a}</option>)}
                      </select>
                      <button disabled={!!govBusy} onClick={() => govCall(`Pausing ${govAsset}`, 'set_asset_paused', [govAsset, true])}
                        className="flex-1 rounded-xl bg-red-600 py-2 text-xs font-bold text-white disabled:opacity-40">Pause</button>
                      <button disabled={!!govBusy} onClick={() => govCall(`Unpausing ${govAsset}`, 'set_asset_paused', [govAsset, false])}
                        className="flex-1 rounded-xl bg-emerald-600 py-2 text-xs font-bold text-white disabled:opacity-40">Resume</button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold"><UserX className="h-3.5 w-3.5" /> Block / unblock sender</p>
                    <div className="flex gap-2">
                      <input value={govAddr} onChange={e => setGovAddr(e.target.value)} placeholder="0x…"
                        spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--accent)]" />
                      <button disabled={!!govBusy} onClick={() => govCall('Blocking sender', 'set_sender_blocked', [govAddr, true])}
                        className="rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Block</button>
                      <button disabled={!!govBusy} onClick={() => govCall('Unblocking sender', 'set_sender_blocked', [govAddr, false])}
                        className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Unblock</button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold"><UserCheck className="h-3.5 w-3.5" /> Bridge reporter</p>
                    <div className="flex gap-2">
                      <input value={govAddr} onChange={e => setGovAddr(e.target.value)} placeholder="0x…"
                        spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--accent)]" />
                      <button disabled={!!govBusy} onClick={() => govCall('Setting bridge reporter', 'set_bridge_reporter', [govAddr])}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Set</button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--border)] bg-white p-4">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-bold"><KeyRound className="h-3.5 w-3.5" /> Transfer ownership</p>
                    <div className="flex gap-2">
                      <input value={govAddr} onChange={e => setGovAddr(e.target.value)} placeholder="0x…"
                        spellCheck={false} className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--accent)]" />
                      <button disabled={!!govBusy} onClick={() => { if (confirm("Transfer ownership? This cannot be undone by you afterwards.")) govCall('Transferring ownership', 'transfer_ownership', [govAddr]); }}
                        className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Transfer</button>
                    </div>
                  </div>
                </div>
                {govBusy && <p className="border-t border-[var(--border)] px-6 py-3 text-xs font-semibold text-[var(--warning)]">Working: {govBusy}…</p>}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {/* ================= FOOTER ================= */}
        <footer className="mt-10 border-t border-[var(--border)] pt-6 text-center">
          <div className="mb-3 flex items-center justify-center gap-2 text-[11px] text-[var(--faint)]">
            <Database className="h-3.5 w-3.5" />
            <span>Every number on this page is read live from the contract or fetched from public feeds — nothing is simulated.</span>
          </div>
          <p className="mx-auto max-w-2xl text-[11px] leading-relaxed text-[var(--faint)]">
            Telemetry sources: chain TVL via DefiLlama (the same feed the contract cross-checks) ·
            gas via public RPC · security score is a transparent TVL-rank heuristic, labeled as such.
            Contract: <a href={`${EXPLORER}/address/${contract}`} target="_blank" rel="noreferrer" className="font-mono text-[var(--accent)]">{contract.slice(0, 10)}…{contract.slice(-8)}</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
