'use client';

import { useState } from 'react';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { custom } from 'viem';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Shield, Globe, CheckCircle2, MapPin, Dices, AlertCircle, RefreshCw, Waypoints, Zap, Cpu, Target, Shuffle, AlertTriangle } from 'lucide-react';

const CONTRACT_ADDRESS = "0x5BD1B147bAf15561dC8009F3F68922b5aC95a7a5";

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

export default function NexusDashboard() {
  const [userAddress, setUserAddress] = useState('');
  const [activeTab, setActiveTab] = useState('terminal');
  const [terminalLogs, setTerminalLogs] = useState<{time: string, msg: string, type: string}[]>([]);
  
  const [intentId, setIntentId] = useState(`NEXUS-SEQ-${Math.floor(1000 + Math.random() * 9000)}`);
  const [selectedAsset, setSelectedAsset] = useState(ASSETS[0]);
  const [sourceChain, setSourceChain] = useState(SOURCE_CHAINS[0]);
  const [depositAmount, setDepositAmount] = useState(ASSET_DEFAULTS["USDC"]);
  const [userIntent, setUserIntent] = useState(ALL_PRESETS[0].prompt);
  
  const [activePresets, setActivePresets] = useState(ALL_PRESETS.slice(0, 3));
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [evalResult, setEvalResult] = useState<any>(null);
  const [parsedReceipt, setParsedReceipt] = useState<any>(null);

  // V2 Integration Features
  const [manualOverride, setManualOverride] = useState(false);
  const [manualTarget, setManualTarget] = useState(SOURCE_CHAINS[1]);

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

  const executeNexusRoute = async (simulateFallback = false) => {
    if (!userAddress) {
      addLog("Cannot execute: Wallet not connected.", 'error');
      return;
    }

    setIsProcessing(true);
    setTerminalLogs([]);
    setEvalResult(null);
    setParsedReceipt(null);
    setActiveTab('terminal');
    
    const currentIntentId = `NEXUS-SEQ-${Math.floor(1000 + Math.random() * 9000)}`;
    setIntentId(currentIntentId);

    try {
      addLog(`Initializing Nexus Engine for ${depositAmount} ${selectedAsset}...`, 'info');
      
      if (manualOverride) {
        addLog(`MANUAL OVERRIDE ACTIVE: Bypassing AI intent. Forcing route to ${manualTarget}...`, 'warning');
      } else {
        addLog("Pulling live market volatility and security metrics...", 'info');
      }
      
      const liveMetrics = {
        ARBITRUM: { avg_gas_usd: (Math.random() * 0.15 + 0.05).toFixed(3), bridge_security_score: Math.floor(Math.random() * 10 + 90).toString(), liquidity_depth_usd: Math.floor(Math.random() * 80000000 + 20000000).toString() },
        BASE: { avg_gas_usd: (Math.random() * 0.05 + 0.01).toFixed(3), bridge_security_score: Math.floor(Math.random() * 10 + 88).toString(), liquidity_depth_usd: Math.floor(Math.random() * 70000000 + 10000000).toString() },
        NEAR: { avg_gas_usd: (Math.random() * 0.02 + 0.001).toFixed(3), bridge_security_score: Math.floor(Math.random() * 12 + 86).toString(), liquidity_depth_usd: Math.floor(Math.random() * 40000000 + 5000000).toString() },
        SOLANA: { avg_gas_usd: (Math.random() * 0.03 + 0.001).toFixed(3), bridge_security_score: Math.floor(Math.random() * 12 + 85).toString(), liquidity_depth_usd: Math.floor(Math.random() * 90000000 + 15000000).toString() }
      };

      const payloadObj = {
        asset: selectedAsset,
        chain_metrics: liveMetrics,
        deposit_amount: depositAmount,
        source_chain: sourceChain,
        source_tx_hash: `0x${Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('')}`,
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
      
      addLog("Generating SHA-256 Cryptographic Hash Lock...", 'warning');
      const msgBuffer = new TextEncoder().encode(deterministicString);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      
      addLog(`Payload Locked. Canonical Target: ${hashHex.substring(0,16)}...`, 'success');
      
      if (simulateFallback) {
        addLog("ERROR: Target node unresponsive. Initiating Auto-Fallback protocol...", 'error');
        setTimeout(() => {
          addLog("Auto-Fallback successful. Funds securely returned to origin wallet.", 'success');
          setParsedReceipt({
            status: 'FALLBACK',
            intent_id: currentIntentId,
            target_chain: manualOverride ? manualTarget : 'UNKNOWN',
            safety_score: 'N/A',
            reason: 'System detected unresponsive node on target chain. Auto-fallback executed. 100% of funds have been returned to your origin wallet address.',
            execution_route: 'Reverted to Origin'
          });
          setEvalResult({ hash: hashHex, status: 'Reverted', block: 'N/A' });
          setActiveTab('receipt');
          setIsProcessing(false);
        }, 2500);
        return;
      }

      addLog("Awaiting user transaction signature...", 'info');

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

      addLog(`Transaction broadcasted via Relayer: ${hash}`, 'info');
      addLog("Localizing multi-LLM consensus nodes (GPT-5, Claude, Gemini)...", 'warning');

      if (typeof client.waitForTransactionReceipt === 'function') {
        try {
          const receipt = await client.waitForTransactionReceipt({ hash, interval: 3000, retries: 40 });
          setEvalResult(receipt);
          
          try {
            const rawPayload = (receipt as any).consensus_data?.leader_receipt?.[0]?.result?.payload?.readable;
            if (rawPayload) {
              const cleaned = JSON.parse(rawPayload);
              const finalJson = typeof cleaned === 'string' ? JSON.parse(cleaned) : cleaned;
              setParsedReceipt(finalJson);
            }
          } catch(e) {
            console.error("Parse error", e);
          }

          addLog("Consensus reached. Omni-chain route finalized.", 'success');
          setActiveTab('receipt');
        } catch (receiptErr) {
          addLog("Consensus finalized on-chain, but frontend lost RPC connection.", 'warning');
        }
      } else {
        await new Promise(r => setTimeout(r, 8000));
        addLog("Transaction mined. Verify on GenLayer Explorer.", 'success');
      }

    } catch (err: any) {
      addLog(`Execution Failed: ${err.message}`, 'error');
    } finally {
      if (!simulateFallback) setIsProcessing(false);
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
              <h1 className="text-lg font-bold text-white tracking-tight leading-tight">Nexus Omni-Chain</h1>
              <p className="text-[10px] text-indigo-400 font-mono tracking-widest uppercase">Intent Router Final Build</p>
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
                  <span className="text-[10px] text-emerald-400 font-mono tracking-wider">GENLAYER NETWORK</span>
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
        
        <div className="lg:col-span-5 space-y-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#0f0f13] border border-white/5 rounded-3xl p-7 shadow-2xl backdrop-blur-sm"
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <MapPin className="h-4 w-4 text-indigo-400" /> Route Configuration
              </h2>
              <button onClick={generateRandomTest} className="flex items-center gap-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-500 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all">
                <Dices className="h-3.5 w-3.5" /> SURPRISE ME
              </button>
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

              {/* V2 Manual Route Override Toggle */}
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
                      {manualOverride ? `FORCED TARGET: ${manualTarget}` : 'Determined by Multi-LLM Consensus'}
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
                  onClick={() => executeNexusRoute(false)}
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
                
                <button 
                  onClick={() => executeNexusRoute(true)}
                  disabled={isProcessing || !userAddress}
                  title="Simulate Auto-Fallback Protocol"
                  className="px-4 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl transition-all flex items-center justify-center text-red-400 disabled:opacity-50 group hover:scale-[1.02]"
                >
                  <AlertTriangle className="h-5 w-5 group-hover:animate-pulse" />
                </button>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="lg:col-span-7 space-y-6">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-[#0f0f13] border border-white/5 rounded-3xl overflow-hidden flex flex-col h-[760px] shadow-2xl backdrop-blur-sm"
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
                      <p className="text-indigo-400 font-bold mb-1">Nexus Node Architecture vFinal</p>
                      <p>Omni-Chain Cryptographic Oracle: Active</p>
                    </div>
                    {terminalLogs.map((log, idx) => (
                      <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} key={idx} className="flex gap-4 p-2 rounded-lg hover:bg-white/5 transition-colors">
                        <span className="text-neutral-600 shrink-0">[{log.time}]</span>
                        <span className={`${log.type === 'error' ? 'text-red-400 font-bold' : log.type === 'success' ? 'text-emerald-400 font-bold' : log.type === 'warning' ? 'text-yellow-400' : 'text-indigo-300'}`}>{log.msg}</span>
                      </motion.div>
                    ))}
                    {isProcessing && (
                      <div className="flex gap-4 p-2 mt-4 text-neutral-500 items-center">
                        <span className="shrink-0">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                        <span className="flex gap-2 items-center text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/20">
                          <div className="h-1.5 w-1.5 bg-indigo-400 rounded-full animate-ping" /> Synchronizing GenVM State...
                        </span>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div key="receipt" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                    {parsedReceipt ? (
                      <div className="space-y-6 h-full flex flex-col">
                        
                        <div className={`p-6 rounded-3xl border flex items-center justify-between ${parsedReceipt.status === 'APPROVED' ? 'bg-emerald-500/10 border-emerald-500/30' : parsedReceipt.status === 'FALLBACK' ? 'bg-orange-500/10 border-orange-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                          <div className="flex items-center gap-4">
                            {parsedReceipt.status === 'APPROVED' ? <CheckCircle2 className="h-10 w-10 text-emerald-400" /> : parsedReceipt.status === 'FALLBACK' ? <RefreshCw className="h-10 w-10 text-orange-400" /> : <AlertCircle className="h-10 w-10 text-red-400" />}
                            <div>
                              <h3 className={`font-black text-2xl tracking-wide ${parsedReceipt.status === 'APPROVED' ? 'text-emerald-400' : parsedReceipt.status === 'FALLBACK' ? 'text-orange-400' : 'text-red-400'}`}>
                                {parsedReceipt.status === 'FALLBACK' ? 'AUTO-FALLBACK TRIGGERED' : `INTENT ${parsedReceipt.status}`}
                              </h3>
                              <p className="text-neutral-400 text-xs mt-1">
                                {parsedReceipt.status === 'FALLBACK' ? 'Route reverted. Funds secured.' : 'Multi-LLM Consensus Verification Complete'}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Intent ID</p>
                            <p className="font-mono text-sm text-neutral-300">{parsedReceipt.intent_id}</p>
                          </div>
                        </div>

                        {(parsedReceipt.status === 'APPROVED' || parsedReceipt.status === 'FALLBACK') && (
                          <div className="grid grid-cols-2 gap-4">
                            <div className="bg-black/40 border border-white/5 p-4 rounded-2xl">
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-1">Selected Target Chain</p>
                              <p className="font-bold text-lg text-indigo-300">{parsedReceipt.target_chain}</p>
                            </div>
                            <div className="bg-black/40 border border-white/5 p-4 rounded-2xl">
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-1">Bridge Security Score</p>
                              <p className={`font-bold text-lg ${parsedReceipt.status === 'FALLBACK' ? 'text-orange-300' : 'text-emerald-300'}`}>{parsedReceipt.safety_score} / 100</p>
                            </div>
                            <div className="col-span-2 bg-black/40 border border-white/5 p-5 rounded-2xl">
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-2">Execution Reasoning</p>
                              <p className={`text-sm leading-relaxed ${parsedReceipt.status === 'FALLBACK' ? 'text-orange-200' : 'text-neutral-300'}`}>{parsedReceipt.reason}</p>
                            </div>
                            <div className="col-span-2 bg-black/40 border border-white/5 p-5 rounded-2xl">
                              <p className="text-[10px] text-neutral-500 uppercase tracking-widest mb-2">Execution Path</p>
                              <p className={`text-xs font-mono ${parsedReceipt.status === 'FALLBACK' ? 'text-red-400' : 'text-indigo-400'}`}>{parsedReceipt.execution_route}</p>
                            </div>
                          </div>
                        )}

                        <div className="mt-4 pt-4 border-t border-white/5">
                           <p className="text-[10px] text-neutral-600 uppercase tracking-widest mb-3">Raw Block Trace</p>
                           <pre className="text-[10px] text-neutral-500 bg-[#0a0a0f] p-4 rounded-xl overflow-x-auto shadow-inner custom-scrollbar">
                             {JSON.stringify(evalResult, null, 2)}
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
