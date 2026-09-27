"use client";

import { useState } from 'react';

const CONTRACT_ADDRESS = "0x976329B75F7B4775b59E0a66bb9BC7F037142424";

export default function NexusOracleDashboard() {
  const [intent, setIntent] = useState("Find the lowest fee chain for staking");
  const [amount, setAmount] = useState("100.50");
  const [asset, setAsset] = useState("USDC");
  
  const [manualOverride, setManualOverride] = useState(false);
  const [preferredChain, setPreferredChain] = useState("BASE");
  const [preferredRoute, setPreferredRoute] = useState("Direct Base Bridge");
  
  const [routingResult, setRoutingResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const generateHash = async (text) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleRouteIntent = async (e) => {
    e.preventDefault();
    setLoading(true);

    const intentId = `intent_${Date.now()}`;
    const sourceTxHash = `0x${Math.random().toString(16).slice(2, 42)}`;

    const payloadObj = {
      source_chain: "ETHEREUM",
      source_tx_hash: sourceTxHash,
      deposit_amount: amount,
      asset: asset,
      user_intent: intent,
      chain_metrics: {
        "BASE": { "gas_fee_usd": 0.01, "liquidity": "High", "bridge_slippage": "0.1%" },
        "SOLANA": { "gas_fee_usd": 0.001, "liquidity": "Very High", "bridge_slippage": "0.2%" },
        "ARBITRUM": { "gas_fee_usd": 0.05, "liquidity": "High", "bridge_slippage": "0.1%" },
        "NEAR": { "gas_fee_usd": 0.005, "liquidity": "Medium", "bridge_slippage": "0.15%" }
      },
      manual_override: manualOverride,
      preferred_target_chain: manualOverride ? preferredChain : "",
      preferred_route: manualOverride ? preferredRoute : ""
    };

    const payloadString = JSON.stringify(payloadObj);
    const expectedSha256 = await generateHash(payloadString);

    try {
      setTimeout(() => {
        setRoutingResult({
          intent_id: intentId,
          status: "APPROVED",
          final_target_chain: manualOverride ? preferredChain : "SOLANA",
          ai_suggested_chain: "SOLANA",
          final_execution_route: manualOverride ? preferredRoute : "Ethereum -> Wormhole -> Raydium",
          ai_suggested_route: "Ethereum -> Wormhole -> Raydium",
          manual_override_active: manualOverride,
          reason: manualOverride 
            ? `User manually overrode AI. AI suggested SOLANA, but user forced ${preferredChain}.`
            : "Solana offers optimal fees. Historically selected 42 times for this asset profile."
        });
        setLoading(false);
      }, 3000);
    } catch (error) {
      console.error("Contract execution failed:", error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 font-sans">
      <div className="max-w-3xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            Nexus Omni-Chain Router (Rev 2)
          </h1>
          <p className="text-sm text-gray-400 mt-2 font-mono">Contract: {CONTRACT_ADDRESS}</p>
        </div>

        <form onSubmit={handleRouteIntent} className="bg-gray-800 p-6 rounded-xl space-y-6 border border-gray-700">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Deposit Amount</label>
              <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white focus:border-blue-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">Asset</label>
              <input type="text" value={asset} onChange={e => setAsset(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white focus:border-blue-500 focus:outline-none" />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">User Intent Statement</label>
            <textarea value={intent} onChange={e => setIntent(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white h-24 focus:border-blue-500 focus:outline-none" />
          </div>

          <div className="p-4 bg-gray-900 rounded-lg border border-gray-700">
            <label className="flex items-center space-x-3 cursor-pointer">
              <input type="checkbox" checked={manualOverride} onChange={e => setManualOverride(e.target.checked)} className="form-checkbox h-5 w-5 text-purple-500 rounded border-gray-600 bg-gray-800" />
              <span className="font-semibold text-gray-200">Force Manual Route Override</span>
            </label>
            
            {manualOverride && (
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Preferred Target Chain</label>
                  <select value={preferredChain} onChange={e => setPreferredChain(e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded p-3 text-white">
                    <option value="BASE">Base</option>
                    <option value="ARBITRUM">Arbitrum</option>
                    <option value="SOLANA">Solana</option>
                    <option value="NEAR">Near</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-2">Custom Route Architecture</label>
                  <input type="text" value={preferredRoute} onChange={e => setPreferredRoute(e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded p-3 text-white" placeholder="e.g. Direct Native Bridge" />
                </div>
              </div>
            )}
          </div>

          <button disabled={loading} type="submit" className="w-full bg-blue-600 hover:bg-blue-700 transition-colors p-4 rounded-lg font-bold flex justify-center items-center">
            {loading ? "Resolving via AI Consensus..." : "Submit to Nexus Oracle"}
          </button>
        </form>

        {routingResult && (
          <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 space-y-4">
            <div className="flex justify-between items-center border-b border-gray-700 pb-2">
              <h2 className="text-xl font-bold">Consensus Execution Receipt</h2>
              <span className="text-xs font-mono text-gray-500">ID: {routingResult.intent_id}</span>
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="bg-gray-900 p-4 rounded-lg border border-gray-700 opacity-75">
                <h3 className="text-sm text-gray-400 mb-1">🤖 AI Suggested Route</h3>
                <p className="font-mono text-blue-400 text-lg">{routingResult.ai_suggested_chain}</p>
                <p className="text-sm mt-2 text-gray-300">{routingResult.ai_suggested_route}</p>
              </div>
              
              <div className={`p-4 rounded-lg border ${routingResult.manual_override_active ? 'border-purple-500 bg-purple-900/20' : 'border-green-500/50 bg-green-900/10'}`}>
                <h3 className="text-sm text-gray-400 mb-1">⚡ Final Executed Route</h3>
                <p className={`font-mono text-lg ${routingResult.manual_override_active ? 'text-purple-400' : 'text-green-400'}`}>
                  {routingResult.final_target_chain}
                </p>
                <p className="text-sm mt-2 text-gray-300">{routingResult.final_execution_route}</p>
              </div>
            </div>

            <div className="mt-4 p-4 bg-gray-900 rounded-lg border border-gray-800">
              <h3 className="text-sm text-gray-400 mb-1">State Transition Reasoning</h3>
              <p className="text-gray-300 italic font-mono text-sm">"{routingResult.reason}"</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
