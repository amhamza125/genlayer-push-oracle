"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Settings, Shield, Zap, RefreshCcw, CheckCircle, AlertTriangle, Terminal, Lock, Route, Activity } from 'lucide-react';

export default function NexusCrossChainUI() {
  const [amount, setAmount] = useState('1270.200424');
  const [manualOverride, setManualOverride] = useState(false);
  const [selectedChain, setSelectedChain] = useState('SOLANA');
  const [isRouting, setIsRouting] = useState(false);
  const [activeTab, setActiveTab] = useState('receipt');
  const [logs, setLogs] = useState<{time: string, msg: string, type: 'info' | 'success' | 'error'}[]>([]);
  const [status, setStatus] = useState<'idle' | 'routing' | 'success' | 'fallback'>('idle');
  const [hash, setHash] = useState('');
  
  const logsEndRef = useRef<HTMLDivElement>(null);

  const generateTime = () => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  };

  const executeRoute = (simulateFallback = false) => {
    setIsRouting(true);
    setStatus('routing');
    setLogs([]);
    setActiveTab('terminal');
    
    const randomHash = '0x' + Array.from({length: 40}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    setHash(randomHash);

    const steps = [
      { msg: 'Initializing Nexus Engine...', type: 'info' },
      { msg: 'Polling live node validators and security metrics...', type: 'info' },
      { msg: 'Generating SHA-256 Cryptography Hash Lock...', type: 'info' },
      { msg: `Payload hashed: ${randomHash.substring(0, 20)}...`, type: 'info' },
      { 
        msg: simulateFallback ? 'ERROR: Target node unresponsive. Initiating Auto-Fallback...' : 'Emitting cross-transaction signature...', 
        type: simulateFallback ? 'error' : 'info' 
      },
      { 
        msg: simulateFallback ? 'Auto-Fallback successful. Funds securely returned to origin wallet.' : 'Synchronizing State Roots... SUCCESS', 
        type: simulateFallback ? 'success' : 'success' 
      },
    ];

    let i = 0;
    const interval = setInterval(() => {
      if (i < steps.length) {
        setLogs(prev => [...prev, { time: generateTime(), msg: steps[i].msg, type: steps[i].type as any }]);
        i++;
      } else {
        clearInterval(interval);
        setIsRouting(false);
        setStatus(simulateFallback ? 'fallback' : 'success');
        setTimeout(() => setActiveTab('receipt'), 1000);
      }
    }, 1200);
  };

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  return (
    <div className="min-h-screen bg-[#0a0a0e] text-white p-4 md:p-8 font-sans selection:bg-indigo-500/30">
      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row gap-6 lg:gap-10">
        
        {/* Left Panel: Configuration */}
        <div className="w-full lg:w-[45%] flex flex-col gap-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.4)]">
              <Route className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              Nexus Cross-Chain
            </h1>
          </div>

          <div className="bg-[#12121a] border border-gray-800/60 rounded-2xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-50"></div>
            
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-4 h-4" /> Route Configuration
              </h2>
            </div>

            <div className="flex gap-2 mb-8 bg-[#1a1a24] p-1.5 rounded-lg border border-gray-800">
              {['NEXUS', 'ETH', 'SOL', 'ARB'].map(chain => (
                <button 
                  key={chain}
                  className={`flex-1 py-2 text-xs font-bold rounded-md transition-all ${selectedChain === chain ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'}`}
                  onClick={() => setSelectedChain(chain)}
                >
                  {chain}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1.5 block">TRANSACTION VOLUME</label>
                <div className="relative">
                  <input 
                    type="text" 
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-[#0a0a0e] border border-gray-800 text-2xl font-mono text-gray-100 rounded-lg p-4 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <span className="text-indigo-400 font-bold text-sm bg-indigo-500/10 px-2 py-1 rounded">MAX</span>
                  </div>
                </div>
              </div>

              {/* Force Manual Route Override Toggle */}
              <div className="bg-[#1a1a24] rounded-lg p-4 border border-gray-800/80 mt-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-gray-200">Manual Route Override</h3>
                  <p className="text-xs text-gray-500 mt-1">Bypass AI routing & select path manually</p>
                </div>
                <button 
                  onClick={() => setManualOverride(!manualOverride)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${manualOverride ? 'bg-indigo-500' : 'bg-gray-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${manualOverride ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {manualOverride && (
                <div className="animate-in fade-in slide-in-from-top-2 p-4 bg-indigo-900/10 border border-indigo-500/20 rounded-lg space-y-3">
                   <label className="text-xs text-indigo-300/70 font-medium block">CUSTOM TARGET CHAIN</label>
                   <select className="w-full bg-[#0a0a0e] border border-gray-800 text-sm text-gray-200 rounded-lg p-3 outline-none focus:border-indigo-500/50">
                     <option>Solana (Mainnet-Beta)</option>
                     <option>Ethereum (ERC-20)</option>
                     <option>Arbitrum One</option>
                   </select>
                </div>
              )}

              <div className="pt-4 space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1"><Shield className="w-3 h-3"/> Network Security</span>
                  <span className="text-emerald-400">High (Hash Validated)</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1"><Lock className="w-3 h-3"/> Cryptography</span>
                  <span className="text-gray-300">SHA-256 Hashing Active</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500 flex items-center gap-1"><RefreshCcw className="w-3 h-3"/> Auto-Fallback Mechanism</span>
                  <span className="text-indigo-400 font-medium">Ready & Armed</span>
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                <button 
                  onClick={() => executeRoute(false)}
                  disabled={isRouting}
                  className={`flex-1 py-4 rounded-xl font-bold text-sm tracking-wide flex justify-center items-center gap-2 transition-all shadow-lg
                    ${isRouting 
                      ? 'bg-indigo-600/50 text-white/50 cursor-not-allowed' 
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-indigo-500/25'}`}
                >
                  {isRouting ? <Activity className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
                  {isRouting ? 'EXECUTING...' : (manualOverride ? 'EXECUTE MANUAL ROUTE' : 'EXECUTE AI ROUTING')}
                </button>
                
                {/* Test Fallback Button */}
                <button 
                  onClick={() => executeRoute(true)}
                  disabled={isRouting}
                  title="Test Auto-Fallback Simulation"
                  className="px-4 bg-[#1a1a24] hover:bg-red-900/20 border border-gray-800 hover:border-red-500/50 rounded-xl transition-all flex items-center justify-center group"
                >
                  <AlertTriangle className="w-5 h-5 text-gray-500 group-hover:text-red-400" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Terminal & Receipt */}
        <div className="w-full lg:w-[55%] flex flex-col">
          <div className="bg-[#12121a] border border-gray-800/60 rounded-2xl shadow-xl flex flex-col h-full overflow-hidden">
            
            {/* Tabs */}
            <div className="flex border-b border-gray-800/60 bg-[#0d0d14]">
              <button 
                onClick={() => setActiveTab('terminal')}
                className={`flex-1 py-4 text-xs font-bold tracking-widest flex items-center justify-center gap-2 transition-colors ${activeTab === 'terminal' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-gray-600 hover:text-gray-400'}`}
              >
                <Terminal className="w-4 h-4" /> SYSTEM TERMINAL
              </button>
              <button 
                onClick={() => setActiveTab('receipt')}
                className={`flex-1 py-4 text-xs font-bold tracking-widest flex items-center justify-center gap-2 transition-colors ${activeTab === 'receipt' ? 'text-indigo-400 border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-gray-600 hover:text-gray-400'}`}
              >
                <CheckCircle className="w-4 h-4" /> CONSENSUS RECEIPT
              </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 p-6 relative bg-[#0a0a0e] font-mono min-h-[400px]">
              
              {activeTab === 'terminal' && (
                <div className="space-y-2 text-xs h-[400px] overflow-y-auto custom-scrollbar">
                  <div className="text-gray-600 mb-4">Nexus Node Orchestration v2.1.0<br/>Awaiting commands...</div>
                  {logs.map((log, index) => (
                    <div key={index} className="flex gap-4 opacity-0 animate-[fadeIn_0.3s_forwards]">
                      <span className="text-gray-600 shrink-0">[{log.time}]</span>
                      <span className={`${log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : 'text-indigo-300'}`}>
                        {log.msg}
                      </span>
                    </div>
                  ))}
                  <div ref={logsEndRef} />
                  {isRouting && (
                    <div className="flex gap-4 mt-2">
                      <span className="text-gray-600">[{generateTime()}]</span>
                      <span className="text-gray-400 flex items-center gap-2">
                        Processing <span className="flex gap-1"><span className="animate-bounce">.</span><span className="animate-bounce" style={{animationDelay: '0.1s'}}>.</span><span className="animate-bounce" style={{animationDelay: '0.2s'}}>.</span></span>
                      </span>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'receipt' && (
                <div className="h-full flex flex-col justify-center">
                  {status === 'idle' ? (
                    <div className="text-center text-gray-600 flex flex-col items-center gap-3">
                      <Shield className="w-12 h-12 opacity-20" />
                      <p className="text-sm font-sans">Awaiting transaction execution...</p>
                    </div>
                  ) : status === 'routing' ? (
                    <div className="text-center flex flex-col items-center gap-4">
                      <Activity className="w-10 h-10 text-indigo-500 animate-pulse" />
                      <p className="text-indigo-400 text-sm animate-pulse font-sans">Generating cryptographic receipt...</p>
                    </div>
                  ) : (
                    <div className="animate-in zoom-in-95 duration-300 space-y-6 max-w-md mx-auto w-full">
                      {/* Receipt Header */}
                      <div className={`p-4 rounded-xl border ${status === 'fallback' ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/30'} flex items-center gap-4`}>
                        {status === 'fallback' ? (
                          <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center shrink-0">
                            <RefreshCcw className="w-6 h-6 text-red-400" />
                          </div>
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                            <CheckCircle className="w-6 h-6 text-emerald-400" />
                          </div>
                        )}
                        <div>
                          <h3 className={`font-bold text-lg font-sans ${status === 'fallback' ? 'text-red-400' : 'text-emerald-400'}`}>
                            {status === 'fallback' ? 'AUTO-FALLBACK TRIGGERED' : 'INTENT APPROVED'}
                          </h3>
                          <p className="text-xs text-gray-400 font-sans mt-0.5">
                            {status === 'fallback' ? 'Route failed. Funds safely returned.' : 'Cross-chain verification complete'}
                          </p>
                        </div>
                      </div>

                      {/* Receipt Details */}
                      <div className="bg-[#12121a] rounded-lg p-5 border border-gray-800 space-y-4">
                        <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                          <span className="text-gray-500 text-xs">Destination</span>
                          <span className="text-gray-200 font-bold font-sans">{selectedChain}</span>
                        </div>
                        <div className="flex justify-between items-center border-b border-gray-800 pb-3">
                          <span className="text-gray-500 text-xs">Security Score</span>
                          <span className="text-indigo-400 font-bold font-sans">98 / 100</span>
                        </div>
                        
                        <div className="pt-2">
                          <span className="text-gray-500 text-xs block mb-2">Cryptography Hash (SHA-256)</span>
                          <div className="bg-[#0a0a0e] p-2.5 rounded border border-gray-800 text-[10px] text-gray-400 break-all">
                            {hash}
                          </div>
                        </div>

                        {status === 'fallback' && (
                          <div className="pt-2">
                             <div className="bg-red-900/10 p-3 rounded border border-red-900/30 flex items-start gap-2">
                               <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5"/>
                               <p className="text-xs text-red-200/70 font-sans leading-relaxed">
                                 System detected unresponsive node on target chain. Auto-fallback executed. <span className="text-red-400 font-bold">100% of funds</span> have been returned to your origin wallet address.
                               </p>
                             </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Required custom styles for animations */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 4px;
        }
      `}} />
    </div>
  );
}
