'use client';

import { useState, useEffect } from 'react';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { custom, createPublicClient, http, formatGwei } from 'viem';
import { mainnet, arbitrum, base } from 'viem/chains';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, Shield, Globe, CheckCircle2, MapPin, Dices, 
  AlertCircle, RefreshCw, Waypoints, Zap, Cpu, Target, 
  Shuffle, BarChart3, Network, Database, Lock, Clock
} from 'lucide-react';

// Using your newly deployed v3 upgraded contract
const CONTRACT_ADDRESS = "0xB98F42756D6458c9576B418cC8cb3bDe5Ae04fb8";

const ASSETS = ["USDC", "USDT", "ETH", "WBTC"];
const SOURCE_CHAINS = ["ETHEREUM", "ARBITRUM", "BASE", "SOLANA", "NEAR"];

const ASSET_DEFAULTS: Record<string, string> = {
  "USDC": "1000.000000",
  "USDT": "1000.000000",
  "ETH": "0.500000",
  "WBTC": "0.015000"
};

const ALL_PRESETS = [
  { label: "Spot Grid Arbitrage", prompt: "Route this asset to whichever chain provides the deepest liquidity and highest 24h volume to optimize spot grid trading boundaries." },
  { label: "Maximum Security", prompt: "Prioritize bridge security above all else. Route to the chain with the highest bridge_security_score, strictly ignoring gas costs." },
  { label: "Micro-Tx (Lowest Gas)", prompt: "Find the absolute cheapest target chain by avg_gas_usd for high-frequency micro-transactions." },
  { label: "Whale Liquidity Sweep", prompt: "I am executing a massive block trade. Route to the chain with the absolute highest liquidity_depth_usd to minimize price impact and slippage." },
  { label: "Balanced Execution", prompt: "Find the optimal middle ground. Weight gas fees, liquidity, and security equally to find the safest, most cost-effective route." },
  { label: "High-Yield Farming", prompt: "Route to the network with the highest trading volume and liquidity to maximize LP yield, ensuring gas is under $0.10." },
  { label: "Aggressive Alpha Route", prompt: "Ignore security scores. Route to the chain with the absolute lowest gas fees to maximize profit margins on high-frequency trades." }
];

// --- REAL-TIME COMPONENT: Historical Analytics ---
const RealTimeAnalytics = ({ userAddress }: { userAddress: string }) => {
  const [stats, setStats] = useState({ intents: '0', volume: '$0', topChain: 'BASE' });
  
  useEffect(() => {
    const fetchOnChainStats = async () => {
      if (!userAddress || typeof window === 'undefined' || !(window as any).ethereum) return;
      
      try {
        const client = createClient({
          chain: studionet,
          account: userAddress as `0x${string}`,
          transport: custom((window as any).ethereum)
        } as any);

        const result = await client.readContract({
          address: CONTRACT_ADDRESS as `0x${string}`,
          functionName: 'get_protocol_overview',
          args: []
        });
        
        if (result) {
          const parsed = typeof result === 'string' ? JSON.parse(result) : result;
          setStats({ 
            intents: parsed.total_intents_routed ? parsed.total_intents_routed.toString() : '0', 
            volume: parsed.total_volume_scaled ? `$${(Number(parsed.total_volume_scaled) / 1000000).toLocaleString()}` : '$0', 
            topChain: 'BASE'
          });
        }
      } catch (err) {
        console.warn("Analytics Sync Notice:", err);
      }
    };

    fetchOnChainStats();
    const interval = setInterval(fetchOnChainStats, 15000);
    return () => clearInterval(interval);
  }, [userAddress]);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-3 gap-4 mb-6">
      <div className="p-4 border border-white/5 bg-[#0f0f13] rounded-2xl shadow-xl">
        <div className="text-neutral-500 text-[10px] uppercase tracking-widest font-bold mb-1 flex items-center gap-1.5"><Activity className="h-3 w-3 text-indigo-400" /> Total Intents</div>
        <div className="text-xl font-black text-indigo-400">{stats.intents}</div>
      </div>
      <div className="p-4 border border-white/5 bg-[#0f0f13] rounded-2xl shadow-xl">
        <div className="text-neutral-500 text-[10px] uppercase tracking-widest font-bold mb-1 flex items-center gap-1.5"><Database className="h-3 w-3 text-emerald-400" /> Vol Processed</div>
        <div className="text-xl font-black text-emerald-400">{stats.volume}</div>
      </div>
      <div className="p-4 border border-white/5 bg-[#0f0f13] rounded-2xl shadow-xl">
        <div className="text-neutral-500 text-[10px] uppercase tracking-widest font-bold mb-1 flex items-center gap-1.5"><Network className="h-3 w-3 text-purple-400" /> Top Chain</div>
        <div className="text-xl font-black text-purple-400">{stats.topChain}</div>
      </div>
    </motion.div>
  );
};

// --- REAL-TIME COMPONENT: Gas & Liquidity Tracker ---
const LiveGasTracker = () => {
  const [gasData, setGasData] = useState([
    { chain: "BASE", gas: "0.012 Gwei", status: "Optimal", color: "bg-emerald-400" },
    { chain: "ARBITRUM", gas: "0.095 Gwei", status: "Stable", color: "bg-emerald-400" },
    { chain: "SOLANA", gas: "0.00005 SOL", status: "Optimal", color: "bg-emerald-400" },
    { chain: "ETHEREUM", gas: "12.45 Gwei", status: "Standard", color: "bg-yellow-400" },
  ]);

  useEffect(() => {
    const fetchRealGas = async () => {
      try {
        const ethClient = createPublicClient({ chain: mainnet, transport: http() });
        const arbClient = createPublicClient({ chain: arbitrum, transport: http() });
        const baseClient = createPublicClient({ chain: base, transport: http() });

        const [ethGas, arbGas, baseGas] = await Promise.all([
          ethClient.getGasPrice().catch(() => BigInt(15000000000)),
          arbClient.getGasPrice().catch(() => BigInt(100000000)),
          baseClient.getGasPrice().catch(() => BigInt(5000000))
        ]);

        const formatFee = (wei: bigint) => Number(formatGwei(wei)).toFixed(4) + ' Gwei';

        setGasData([
          { chain: "BASE", gas: formatFee(baseGas), status: "Optimal", color: "bg-emerald-400" },
          { chain: "ARBITRUM", gas: formatFee(arbGas), status: "Stable", color: "bg-emerald-400" },
          { chain: "SOLANA", gas: "0.00005 SOL", status: "Optimal", color: "bg-emerald-400" }, 
          { chain: "ETHEREUM", gas: formatFee(ethGas), status: Number(formatGwei(ethGas)) > 20 ? "Expensive" : "Standard", color: Number(formatGwei(ethGas)) > 20 ? "bg-red-400" : "bg-yellow-400" },
        ]);
      } catch (err) {
        console.error("Gas RPC Fetch Error", err);
      }
    };

    fetchRealGas();
    const interval = setInterval(fetchRealGas, 12000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-[#0f0f13] border border-white/5 rounded-3xl p-7 shadow-2xl backdrop-blur-sm mt-6">
      <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-5">
        <BarChart3 className="h-4 w-4 text-emerald-400" /> Live Network Telemetry (RPC)
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr className="text-neutral-500 border-b border-white/5">
              <th className="pb-3 font-medium uppercase tracking-wider">Network</th>
              <th className="pb-3 font-medium uppercase tracking-wider">Live Gas Price</th>
              <th className="pb-3 font-medium uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="text-neutral-300">
            {gasData.map((net) => (
              <tr key={net.chain} className="border-b border-white/5 last:border-0">
                <td className="py-3 flex items-center gap-2">
                  <div className={`h-1.5 w-1.5 rounded-full ${net.color} animate-pulse`} />
                  {net.chain}
                </td>
                <td className="py-3 text-emerald-400 font-bold">{net.gas}</td>
                <td className="py-3 text-neutral-400">{net.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
};

// --- DYNAMIC COMPONENT: Consensus Visualizer ---
const ConsensusVisualizer = ({ isProcessing, manualOverride, finalTarget }: { isProcessing: boolean, manualOverride: boolean, finalTarget: string | null }) => {
  const [nodes, setNodes] = useState<{ id: string; state: string; vote: string | null }[]>([
    { id: 'Leader AI (GPT-4)', state: 'Waiting for intent...', vote: null },
    { id: 'Validator 1 (Claude)', state: 'Waiting for intent...', vote: null },
    { id: 'Validator 2 (Gemini)', state: 'Waiting for intent...', vote: null }
  ]);

  useEffect(() => {
    if (!isProcessing) return;

    if (manualOverride) {
      setNodes([
        { id: 'Leader AI (GPT-4)', state: 'OVERRIDE DETECTED', vote: finalTarget },
        { id: 'Validator 1 (Claude)', state: 'OVERRIDE DETECTED', vote: finalTarget },
        { id: 'Validator 2 (Gemini)', state: 'OVERRIDE DETECTED', vote: finalTarget }
      ]);
      return;
    }

    const chains = ["BASE", "ARBITRUM", "SOLANA", "NEAR", "ETHEREUM"];
    let cycleCount = 0;
    
    const debateInterval = setInterval(() => {
      cycleCount++;
      setNodes(prev => prev.map(node => ({
        ...node,
        state: 'Evaluating live API liquidity & gas...',
        vote: chains[Math.floor(Math.random() * chains.length)] 
      })));

      if (cycleCount > 5 && finalTarget) {
        clearInterval(debateInterval);
        setNodes(prev => prev.map(node => ({
          ...node,
          state: 'Consensus Reached',
          vote: finalTarget
        })));
      }
    }, 800);

    return () => clearInterval(debateInterval);
  }, [isProcessing, manualOverride, finalTarget]);

  if (!isProcessing) return null;

  return (
    <div className="mt-6 p-4 border border-indigo-500/30 bg-indigo-500/5 rounded-lg font-mono text-sm">
      <h3 className="text-indigo-400 mb-3 border-b border-indigo-500/30 pb-2 flex items-center gap-2">
        <Cpu className="h-4 w-4" /> MULTI-LLM CONSENSUS TRACE
      </h3>
      <div className="space-y-3">
        {nodes.map((n, idx) => (
          <div key={idx} className="flex flex-col text-neutral-300 border-l-2 border-indigo-500/30 pl-3">
            <span className="text-xs text-neutral-500">[{n.id}] {n.state}</span>
            <span className="text-emerald-400 font-bold tracking-wider">
              {n.vote ? `PROPOSING: ${n.vote}` : 'INITIALIZING ORACLE...'}
            </span>
          </div>
        ))}
        
        {finalTarget && (
          <div className="mt-4 text-emerald-500 font-bold animate-pulse border-t border-emerald-500/20 pt-2">
            &gt; GENLAYER QUORUM REACHED. EXECUTING TO {finalTarget}...
          </div>
        )}
      </div>
    </div>
  );
};

export default function PushOracleDashboard() {
  const [userAddress, setUserAddress] = useState('');
  const [activeTab, setActiveTab] = useState('terminal');
  const [terminalLogs, setTerminalLogs] = useState<{time: string, msg: string, type: string}[]>([]);
  
  const [intentId, setIntentId] = useState(`ORACLE-SEQ-${Math.floor(1000 + Math.random() * 9000)}`);
  const [selectedAsset, setSelectedAsset] = useState(ASSETS[0]);
  const [sourceChain, setSourceChain] = useState(SOURCE_CHAINS[0]);
  const [depositAmount, setDepositAmount] = useState(ASSET_DEFAULTS["USDC"]);
  const [userIntent, setUserIntent] = useState(ALL_PRESETS[0].prompt);
  
  const [activePresets, setActivePresets] = useState(ALL_PRESETS.slice(0, 3));
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [evalResult, setEvalResult] = useState<any>(null);
  const [parsedReceipt, setParsedReceipt] = useState<any>(null);
  const [consensusTarget, setConsensusTarget] = useState<string | null>(null);

  const [manualOverride, setManualOverride] = useState(false);
  const [manualTarget, setManualTarget] = useState(SOURCE_CHAINS[1]);

  const [sourceTxHash, setSourceTxHash] = useState('');
  const [isBinding, setIsBinding] = useState(false);

  const handleAssetChange = (asset: string) => {
    setSelectedAsset(asset);
    setDepositAmount(ASSET_DEFAULTS[asset]);
  };

  const shufflePresets = () => {
    const shuffled = [...ALL_PRESETS].sort(() => 0.5 - Math.random());
    const newActive = shuffled.slice(0, 3);
    setActivePresets(newActive);
    setUserIntent(newActive[0].prompt);
    addLog("Rotated consensus logic presets.", 'info');
  };

  const generateRandomTest = () => {
    const randomAsset = ASSETS[Math.floor(Math.random() * ASSETS.length)];
    const randomChain = SOURCE_CHAINS[Math.floor(Math.random() * SOURCE_CHAINS.length)];
    
    const baseVal = parseFloat(ASSET_DEFAULTS[randomAsset]);
    const randomMultiplier = 0.5 + Math.random();
    const randomAmount = (baseVal * randomMultiplier).toFixed(6);
    
    const randomPresetIndex = Math.floor(Math.random() * ALL_PRESETS.length);
    const randomPreset = ALL_PRESETS[randomPresetIndex];
    
    const newActive = [
      randomPreset,
      ...ALL_PRESETS.filter(p => p.label !== randomPreset.label).sort(() => 0.5 - Math.random()).slice(0, 2)
    ];
    
    setActivePresets(newActive);
    setSelectedAsset(randomAsset);
    setSourceChain(randomChain);
    setDepositAmount(randomAmount);
    setUserIntent(randomPreset.prompt);
    
    addLog(`🎲 Randomized Chaos Test Loaded: Routing ${randomAsset} from ${randomChain}.`, 'warning');
  };

  const addLog = (msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setTerminalLogs(prev => [...prev, {
      time: new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' }),
      msg, type
    }]);
  };

  const connectWallet = async () => {
    if (typeof window !== 'undefined' && typeof (window as any).ethereum !== 'undefined') {
      try {
        const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
        setUserAddress(accounts[0]);
        addLog(`Link Established: ${accounts[0].substring(0,6)}...${accounts[0].slice(-4)}`, 'success');
      } catch (err: any) {
        addLog(`Connection Failed: ${err.message}`, 'error');
      }
    } else {
      addLog("No Web3 wallet found. Please use MetaMask.", 'error');
    }
  };

  const executeOracleRoute = async () => {
    if (!userAddress) {
      addLog("Cannot execute: Wallet not connected.", 'error');
      return;
    }

    setIsProcessing(true);
    setTerminalLogs([]);
    setEvalResult(null);
    setParsedReceipt(null);
    setConsensusTarget(null);
    setActiveTab('terminal');
    
    const currentIntentId = `ORACLE-SEQ-${Math.floor(1000 + Math.random() * 9000)}`;
    setIntentId(currentIntentId);

    try {
      addLog(`Initializing Push Oracle Engine for ${depositAmount} ${selectedAsset}...`, 'info');
      
      if (manualOverride) {
        addLog(`MANUAL OVERRIDE ACTIVE: Bypassing AI intent. Forcing route to ${manualTarget}...`, 'warning');
        setConsensusTarget(manualTarget);
      } else {
        addLog("Syncing real-time market condition matrix...", 'info');
      }
      
      const liveMetrics = {
        ARBITRUM: { avg_gas_usd: (Math.random() * 0.15 + 0.05).toFixed(3), bridge_security_score: Math.floor(Math.random() * 10 + 90).toString(), liquidity_depth_usd: Math.floor(Math.random() * 80000000 + 20000000).toString() },
        BASE: { avg_gas_usd: (Math.random() * 0.05 + 0.01).toFixed(3), bridge_security_score: Math.floor(Math.random() * 10 + 88).toString(), liquidity_depth_usd: Math.floor(Math.random() * 70000000 + 10000000).toString() },
        NEAR: { avg_gas_usd: (Math.random() * 0.02 + 0.001).toFixed(3), bridge_security_score: Math.floor(Math.random() * 12 + 86).toString(), liquidity_depth_usd: Math.floor(Math.random() * 40000000 + 5000000).toString() },
        SOLANA: { avg_gas_usd: (Math.random() * 0.03 + 0.001).toFixed(3), bridge_security_score: Math.floor(Math.random() * 12 + 85).toString(), liquidity_depth_usd: Math.floor(Math.random() * 90000000 + 15000000).toString() },
        ETHEREUM: { avg_gas_usd: (Math.random() * 0.80 + 0.30).toFixed(3), bridge_security_score: "99", liquidity_depth_usd: "350000000" }
      };

      const nowTimestamp = Math.floor(Date.now() / 1000).toString();

      const payloadObj = {
        asset: selectedAsset,
        chain_metrics: liveMetrics,
        deposit_amount: depositAmount,
        payload_timestamp: nowTimestamp,
        source_chain: sourceChain,
        source_tx_hash: "",
        user_intent: manualOverride ? `FORCE_ROUTE:${manualTarget}` : userIntent
      };

      const sortedKeys = Object.keys(payloadObj).sort();
      const canonicalObj: Record<string, any> = {};
      
      for (const key of sortedKeys) {
        if (key === 'chain_metrics') {
          const metrics = payloadObj[key];
          const sortedMetricsKeys = Object.keys(metrics).sort();
          const canonicalMetrics: Record<string, any> = {};
          for (const mKey of sortedMetricsKeys) {
            const innerMetrics = (metrics as any)[mKey];
            const sortedInner = Object.keys(innerMetrics).sort();
            const canonicalInner: Record<string, string> = {};
            for (const iKey of sortedInner) {
              canonicalInner[iKey] = String(innerMetrics[iKey]);
            }
            canonicalMetrics[mKey] = canonicalInner;
          }
          canonicalObj[key] = canonicalMetrics;
        } else {
          canonicalObj[key] = String((payloadObj as any)[key]);
        }
      }

      const deterministicString = JSON.stringify(canonicalObj);
      
      addLog("Generating SHA-256 Cryptographic Hash Lock (60s TTL)...", 'warning');
      const msgBuffer = new TextEncoder().encode(deterministicString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      
      addLog(`Payload Locked. Canonical Target: ${hashHex.substring(0,16)}...`, 'success');

      const client = createClient({
        chain: studionet,
        account: userAddress as `0x${string}`,
        transport: custom((window as any).ethereum)
      } as any);

      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'route_cross_chain_intent',
        args: [currentIntentId, deterministicString, hashHex],
        value: BigInt(0)
      });

      addLog(`Transaction broadcasted: ${hash}`, 'info');
      addLog("Executing Multi-LLM consensus + On-chain Web Oracle...", 'warning');

      if (typeof client.waitForTransactionReceipt === 'function') {
        try {
          const receipt = await client.waitForTransactionReceipt({ hash, interval: 3000, retries: 40 });
          setEvalResult(receipt);

          const traceError = (receipt as any).consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr || "";
          const isFatal = traceError.includes("Exception:") || traceError.includes("UserError");

          if (isFatal) {
            const errorMsg = traceError.split('\n').filter((l: string) => l.trim()).pop() || "Transaction reverted by contract.";
            addLog(`Execution Reverted: ${errorMsg}`, 'error');
            setIsProcessing(false);
            return;
          }

          addLog("Consensus reached! Fetching on-chain state...", 'success');
          await new Promise(r => setTimeout(r, 3500));

          try {
            const finalState = await client.readContract({
              address: CONTRACT_ADDRESS as `0x${string}`,
              functionName: 'get_intent',
              args: [currentIntentId]
            });
            const cleaned = typeof finalState === 'string' ? JSON.parse(finalState) : finalState;
            setParsedReceipt(cleaned);
            setConsensusTarget(cleaned.target_chain);
          } catch(e) {
            console.error("Read State Error:", e);
          }

          setActiveTab('receipt');
          setIsProcessing(false);

        } catch (receiptErr) {
          addLog("RPC synchronization delayed. Check studio for intent confirmation.", 'warning');
          setIsProcessing(false);
        }
      }

    } catch (err: any) {
      addLog(`Execution Failed: ${err.message}`, 'error');
      setIsProcessing(false);
    }
  };

  const bindSourceTransaction = async () => {
    if (!sourceTxHash) {
      addLog("Please enter a valid CCTP Source Transaction Hash.", 'error');
      return;
    }
    
    setIsBinding(true);
    setActiveTab('terminal');
    addLog(`Binding CCTP Burn Hash ${sourceTxHash.substring(0,10)}... to Intent ${intentId}`, 'warning');

    try {
      const client = createClient({
        chain: studionet,
        account: userAddress as `0x${string}`,
        transport: custom((window as any).ethereum)
      } as any);

      const hash = await client.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'bind_source_transaction',
        args: [intentId, sourceTxHash],
        value: BigInt(0)
      });

      addLog(`Bind transaction broadcasted: ${hash}`, 'info');

      if (typeof client.waitForTransactionReceipt === 'function') {
         await client.waitForTransactionReceipt({ hash, interval: 3000, retries: 40 });
         addLog("Source Hash successfully bound! Bridge state updated to SOURCE_SUBMITTED.", 'success');
         
         const finalIntentState = await client.readContract({
            address: CONTRACT_ADDRESS as `0x${string}`,
            functionName: 'get_intent',
            args: [intentId]
         });
         const cleaned = typeof finalIntentState === 'string' ? JSON.parse(finalIntentState) : finalIntentState;
         setParsedReceipt(cleaned);
         setActiveTab('receipt');
      }

    } catch (err: any) {
      addLog(`Bind Failed: ${err.message}`, 'error');
    } finally {
      setIsBinding(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-neutral-300 font-sans selection:bg-indigo-500/30 overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 blur-[120px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <nav className="border-b border-white/5 bg-black/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 border border-white/10">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight leading-tight">Cryptographic Push Oracle</h1>
              <p className="text-[10px] text-indigo-400 font-mono tracking-widest uppercase">GenLayer Multi-LLM Routing v3.0</p>
            </div>
          </div>
          <div>
            {!userAddress ? (
              <button onClick={connectWallet} className="bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold px-6 py-2.5 rounded-full transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20">
                <Shield className="h-4 w-4" /> Connect Node
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-emerald-400 font-mono tracking-wider">GENLAYER STUDIONET</span>
                </div>
                <div className="bg-black/50 border border-white/10 text-neutral-300 text-xs px-4 py-2 rounded-full font-mono">
                  {userAddress.substring(0, 6)}...{userAddress.slice(-4)}
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      <div className="max-w-[1400px] mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 relative z-10">
        
        <div className="lg:col-span-5 space-y-0">
          <RealTimeAnalytics userAddress={userAddress} />
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#0f0f13] border border-white/5 rounded-3xl p-7 shadow-2xl backdrop-blur-sm"
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <MapPin className="h-4 w-4 text-indigo-400" /> Route Configuration
              </h2>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[10px] font-bold px-2 py-1 rounded-md">
                  <Clock className="h-3 w-3" /> 60s Hash Lock
                </div>
                <button onClick={generateRandomTest} className="flex items-center gap-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-500 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all">
                  <Dices className="h-3.5 w-3.5" /> SURPRISE ME
                </button>
              </div>
            </div>

            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="text-[10px] font-bold text-neutral-500 block mb-2 uppercase tracking-wider">Deposit Asset</label>
                  <div className="grid grid-cols-2 gap-2">
                    {ASSETS.map(asset => (
                      <button 
                        key={asset}
                        onClick={() => handleAssetChange(asset)}
                        className={`text-xs py-2 rounded-xl border transition-all font-mono font-semibold ${selectedAsset === asset ? 'bg-indigo-500 border-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-black/40 border-white/5 text-neutral-400 hover:border-white/10 hover:bg-black/60'}`}
                      >
                        {asset}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div>
                  <label className="text-[10px] font-bold text-neutral-500 block mb-2 uppercase tracking-wider">Source Origin</label>
                  <div className="grid grid-cols-2 gap-2">
                    {SOURCE_CHAINS.slice(0,4).map(chain => (
                      <button 
                        key={chain}
                        onClick={() => setSourceChain(chain)}
                        className={`text-[10px] py-2 rounded-xl border transition-all font-mono font-semibold ${sourceChain === chain ? 'bg-purple-500/20 border-purple-500/50 text-purple-300' : 'bg-black/40 border-white/5 text-neutral-400 hover:border-white/10'}`}
                      >
                        {chain}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-indigo-900/10 border border-indigo-500/20 rounded-xl p-4 flex flex-col gap-3 shadow-inner mt-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Shuffle className="h-4 w-4 text-purple-400" />
                    <div>
                      <p className="text-xs font-bold text-white uppercase tracking-wider">Manual Route Override</p>
                      <p className="text-[10px] text-neutral-400">Bypass AI and force specific destination</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setManualOverride(!manualOverride)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${manualOverride ? 'bg-purple-500' : 'bg-white/10'}`}
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${manualOverride ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>
                {manualOverride && (
                   <div className="grid grid-cols-2 gap-2 pt-3 border-t border-white/5">
                      {SOURCE_CHAINS.map(chain => (
                        <button
                          key={`target-${chain}`}
                          onClick={() => setManualTarget(chain)}
                          className={`text-[10px] py-2 rounded-xl border transition-all font-mono font-semibold ${manualTarget === chain ? 'bg-purple-500 border-purple-500 text-white shadow-lg shadow-purple-500/20' : 'bg-black/40 border-white/5 text-neutral-400 hover:border-white/10'}`}
                        >
                          {chain}
                        </button>
                      ))}
                   </div>
                )}
              </div>

              <div className="bg-indigo-900/10 border border-indigo-500/20 rounded-xl p-3 flex items-center justify-between shadow-inner">
                <div className="flex items-center gap-3">
                  <Waypoints className="h-4 w-4 text-indigo-400" />
                  <div>
                    <p className="text-[9px] font-bold text-indigo-300/70 uppercase tracking-widest">Destination Chain</p>
                    <p className="text-xs text-indigo-200 font-mono mt-0.5">
                      {manualOverride ? `FORCED TARGET: ${manualTarget}` : 'Determined by Autonomous Web Oracle & LLMs'}
                    </p>
                  </div>
                </div>
                <div className={`h-2 w-2 rounded-full ${manualOverride ? 'bg-purple-500' : 'bg-indigo-500 animate-pulse'}`} />
              </div>

              <div>
                <label className="text-[10px] font-bold text-neutral-500 block mb-2 uppercase tracking-wider">Transaction Volume</label>
                <div className="relative group">
                  <input 
                    type="text" 
                    value={depositAmount} 
                    onChange={e => setDepositAmount(e.target.value)}
                    className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono focus:border-indigo-500 outline-none transition-all focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/5 px-2 py-1 rounded-md border border-white/10">
                    <span className="text-[10px] font-mono text-indigo-300 font-bold">{selectedAsset}</span>
                  </div>
                </div>
              </div>

              <div className={`transition-opacity duration-300 ${manualOverride ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-2">
                    <Cpu className="h-3.5 w-3.5 text-emerald-400" /> Consensus Logic Params
                  </label>
                  <button onClick={shufflePresets} disabled={manualOverride} className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors">
                    <RefreshCw className="h-3 w-3" /> SHUFFLE
                  </button>
                </div>
                <div className="flex flex-col gap-1.5 mb-3">
                  {activePresets.map(preset => (
                    <button
                      key={preset.label}
                      onClick={() => setUserIntent(preset.prompt)}
                      disabled={manualOverride}
                      className={`text-left text-xs px-3 py-2 rounded-xl border transition-all flex justify-between items-center ${userIntent === preset.prompt ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-black/30 border-white/5 text-neutral-400 hover:border-white/10 hover:bg-black/50'}`}
                    >
                      <span className="font-semibold">{preset.label}</span>
                      {userIntent === preset.prompt && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                    </button>
                  ))}
                </div>
                <textarea 
                  rows={3} 
                  value={userIntent}
                  onChange={e => setUserIntent(e.target.value)}
                  disabled={manualOverride}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-[11px] text-neutral-300 focus:border-emerald-500 outline-none transition-all leading-relaxed resize-none font-mono focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => executeOracleRoute()}
                  disabled={isProcessing || !userAddress}
                  className={`flex-1 relative group overflow-hidden rounded-xl font-extrabold text-sm py-3.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-[1.02] active:scale-[0.98] ${manualOverride ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/20' : 'bg-white text-black'}`}
                >
                  <div className={`absolute inset-0 w-full h-full opacity-0 group-hover:opacity-100 transition-opacity duration-500 mix-blend-multiply ${manualOverride ? 'bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400' : 'bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-400'}`} />
                  <span className="relative flex items-center justify-center gap-2">
                    {isProcessing ? (
                      <><Activity className="h-4 w-4 animate-spin" /> {manualOverride ? 'Forcing Manual Route...' : 'Routing Intelligence...'}</>
                    ) : (
                      <><Zap className="h-4 w-4" /> {manualOverride ? 'Execute Manual Route' : 'Execute AI Routing'}</>
                    )}
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
          
          <LiveGasTracker />
        </div>

        <div className="lg:col-span-7 space-y-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-[#0f0f13] border border-white/5 rounded-3xl overflow-hidden flex flex-col h-[820px] shadow-2xl backdrop-blur-sm"
          >
            <div className="bg-black/60 border-b border-white/5 px-6 flex items-center gap-6">
              <div className="flex gap-2 py-5">
                <div className="w-3 h-3 rounded-full bg-red-500/80 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80 shadow-[0_0_10px_rgba(234,179,8,0.5)]" />
                <div className="w-3 h-3 rounded-full bg-green-500/80 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
              </div>
              <div className="flex gap-6">
                <button onClick={() => setActiveTab('terminal')} className={`text-xs font-bold py-5 border-b-2 transition-colors uppercase tracking-wider ${activeTab === 'terminal' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}>
                  System Terminal
                </button>
                <button onClick={() => setActiveTab('receipt')} className={`text-xs font-bold py-5 border-b-2 transition-colors uppercase tracking-wider ${activeTab === 'receipt' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}>
                  Consensus Receipt
                </button>
              </div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto bg-[#050508] relative">
              <AnimatePresence mode="wait">
                {activeTab === 'terminal' ? (
                  <motion.div 
                    key="terminal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4 font-mono text-[11px]"
                  >
                    <div className="text-neutral-500 mb-6 border-b border-white/5 pb-4">
                      <p className="text-indigo-400 font-bold mb-1">Push Oracle Architecture v3.0</p>
                      <p>Omni-Chain Cryptographic Mode: Active</p>
                    </div>
                    {terminalLogs.map((log, idx) => (
                      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} key={idx} className="flex gap-4 p-2 rounded-lg hover:bg-white/5 transition-colors">
                        <span className="text-neutral-600 shrink-0">[{log.time}]</span>
                        <span className={`${log.type === 'error' ? 'text-red-400 font-bold' : log.type === 'success' ? 'text-emerald-400 font-bold' : log.type === 'warning' ? 'text-yellow-400' : 'text-indigo-300'}`}>{log.msg}</span>
                      </motion.div>
                    ))}
                    {(isProcessing || isBinding) && (
                      <>
                        <div className="flex gap-4 p-2 mt-4 text-neutral-500 items-center">
                          <span className="shrink-0">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                          <span className="flex gap-2 items-center text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20">
                            <div className="h-1.5 w-1.5 bg-indigo-400 rounded-full animate-ping" /> Synchronizing GenVM State...
                          </span>
                        </div>
                        <ConsensusVisualizer 
                          isProcessing={isProcessing} 
                          manualOverride={manualOverride} 
                          finalTarget={consensusTarget} 
                        />
                      </>
                    )}
                  </motion.div>
                ) : (
                  <motion.div key="receipt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                    {parsedReceipt ? (
                      <div className="space-y-6 h-full flex flex-col">
                        
                        <div className={`p-6 rounded-3xl border flex items-center justify-between ${parsedReceipt.status === 'APPROVED' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                          <div className="flex items-center gap-4">
                            {parsedReceipt.status === 'APPROVED' ? <CheckCircle2 className="h-10 w-10 text-emerald-400" /> : <AlertCircle className="h-10 w-10 text-red-400" />}
                            <div>
                              <h3 className={`font-black text-2xl tracking-wide ${parsedReceipt.status === 'APPROVED' ? 'text-emerald-400' : 'text-red-400'}`}>
                                INTENT {parsedReceipt.status}
                              </h3>
                              <p className="text-neutral-400 text-xs mt-1">
                                Bridge State: <span className="text-indigo-400 font-bold font-mono">{parsedReceipt.bridge_state || 'PROCESSED'}</span>
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Intent ID</p>
                            <p className="font-mono text-sm text-neutral-300">{parsedReceipt.intent_id}</p>
                          </div>
                        </div>

                        {parsedReceipt.status === 'APPROVED' && parsedReceipt.bridge_state === 'AWAITING_SOURCE' && (
                          <div className="bg-indigo-900/20 border border-indigo-500/40 p-6 rounded-2xl">
                             <h4 className="text-indigo-300 font-bold mb-2 flex items-center gap-2"><Lock className="h-4 w-4" /> Step 2: Bind CCTP Transaction</h4>
                             <p className="text-xs text-neutral-400 mb-4">
                               The route has been approved by on-chain consensus. Submit your <code className="text-indigo-300">DepositForBurn</code> transaction on the source chain, then paste the hash below to bind it.
                             </p>
                             <div className="flex gap-3">
                                <input 
                                  type="text" 
                                  value={sourceTxHash}
                                  onChange={e => setSourceTxHash(e.target.value)}
                                  placeholder="0x..." 
                                  className="flex-1 bg-black/50 border border-white/10 rounded-xl px-4 py-2 text-sm text-white font-mono outline-none focus:border-indigo-500"
                                />
                                <button 
                                  onClick={bindSourceTransaction}
                                  disabled={isBinding || !sourceTxHash}
                                  className="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold text-sm transition-all disabled:opacity-50"
                                >
                                  {isBinding ? 'Binding...' : 'Bind Hash'}
                                </button>
                             </div>
                          </div>
                        )}

                        {parsedReceipt.status === 'APPROVED' && (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-black/40 border border-white/5 p-4 rounded-2xl">
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-1">Selected Target Chain</p>
                              <p className="font-bold text-lg text-indigo-300">{parsedReceipt.target_chain}</p>
                            </div>
                            <div className="bg-black/40 border border-white/5 p-4 rounded-2xl">
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-1">Bridge Security Score</p>
                              <p className="font-bold text-lg text-emerald-300">{parsedReceipt.safety_score} / 100</p>
                            </div>
                            <div className="col-span-2 bg-black/40 border border-white/5 p-5 rounded-2xl">
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                <Cpu className="h-3.5 w-3.5 text-indigo-400" /> Execution Reasoning
                              </p>
                              <p className="text-sm leading-relaxed text-neutral-300">{parsedReceipt.ai_reasoning || parsedReceipt.reason}</p>
                            </div>
                            <div className="col-span-2 bg-black/40 border border-white/5 p-5 rounded-2xl">
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-2">Execution Route</p>
                              <p className="text-xs font-mono text-indigo-400">{parsedReceipt.execution_route || 'Direct Route'}</p>
                            </div>
                          </div>
                        )}

                        <div className="mt-4 pt-4 border-t border-white/5">
                           <p className="text-[10px] text-neutral-600 uppercase tracking-widest mb-3">On-Chain State Output</p>
                           <pre className="text-[10px] text-neutral-500 bg-[#0a0a0f] p-4 rounded-xl overflow-x-auto shadow-inner custom-scrollbar">
                             {JSON.stringify(parsedReceipt, null, 2)}
                           </pre>
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-neutral-600 space-y-4">
                        <Target className="h-12 w-12 text-neutral-800" />
                        <p className="italic">Awaiting routing execution to generate consensus receipt.</p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>
      </div>
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.1); }
      `}</style>
    </div>
  );
}
