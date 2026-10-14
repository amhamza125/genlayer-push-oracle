// Adversarial test suite for NexusIntentRouter v4 (push oracle).
// Run: node run.mjs  (reads ../test-deploy.json for the contract address)
// Writes: po-v4-results.json
// Design notes:
// - AI consensus outcomes are nondeterministic: routing tests assert the tx
//   FINALIZED and the status is one of the contract's valid terminal verdicts,
//   never that the AI must APPROVE.
// - Lifecycle tests (bind/report/cancel) adaptively use whichever honest
//   intents the AI approved.
// - Revert expectations are checked against the GenVM stderr in the receipt.

import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { parseEther } from 'viem';
import { readFileSync, writeFileSync } from 'fs';
import { createHash, randomBytes } from 'crypto';

const DEPLOY = JSON.parse(readFileSync(new URL('../../test-deploy.json', import.meta.url)));
const ADDR = DEPLOY.contract;
if (!ADDR) { console.error('No contract address in test-deploy.json'); process.exit(1); }

const _key = process.env.GL_TEST_PRIVATE_KEY;
if (!_key) { console.error('Set GL_TEST_PRIVATE_KEY to a funded StudioNet test key before running.'); process.exit(1); }
const ownerW = { privateKey: _key.startsWith('0x') ? _key : '0x' + _key };
const owner = privateKeyToAccount(ownerW.privateKey);
const secondKey = generatePrivateKey();
const second = privateKeyToAccount(secondKey);

const ownerClient = createClient({ chain: studionet, account: owner });
const secondClient = createClient({ chain: studionet, account: second });
const ro = createClient({ chain: studionet });

const results = { contract: ADDR, scenarios: [], txs: [] };
const RUN = 'V4T-' + Date.now().toString(36).toUpperCase();
let n = 0;
const nid = () => `${RUN}-${String(++n).padStart(2, '0')}`;

function log(...a) { console.log('[v4test]', ...a); }
const isFin = (t) => t && (t.statusName === 'FINALIZED' || String(t.status) === '7');
const stName = (t) => t ? (t.statusName || String(t.status)) : 'NONE';

async function waitFinalized(hash, minutes = 14) {
  const deadline = Date.now() + minutes * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      const t = await ro.getTransaction({ hash });
      if (isFin(t)) return t;
    } catch {}
    await new Promise(r => setTimeout(r, 15000));
  }
  throw new Error('timeout waiting FINALIZED for ' + hash);
}

async function getStderr(hash) {
  for (const c of [ownerClient, ro]) {
    try {
      const rc = await c.waitForTransactionReceipt({ hash, retries: 40, interval: 10000 });
      const err = rc?.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr;
      if (err) return err;
    } catch {}
  }
  return 'RECEIPT_UNAVAILABLE';
}

function pass(name, detail) { results.scenarios.push({ name, pass: true, detail }); log('PASS', name, '-', detail); }
function fail(name, detail) { results.scenarios.push({ name, pass: false, detail }); log('FAIL', name, '-', detail); }

// ---- payload builder (mirrors dashboard canonicalization) ----
function canonicalPayload(obj) {
  const sortedKeys = Object.keys(obj).sort();
  const out = {};
  for (const k of sortedKeys) {
    if (k === 'chain_metrics') {
      const m = obj[k], cm = {};
      for (const mk of Object.keys(m).sort()) {
        const inner = m[mk], ci = {};
        for (const ik of Object.keys(inner).sort()) ci[ik] = String(inner[ik]);
        cm[mk] = ci;
      }
      out[k] = cm;
    } else out[k] = String(obj[k]);
  }
  return JSON.stringify(out);
}
function honestPayload(over = {}) {
  // Realistic telemetry, roughly tracking live oracle TVL ordering
  // (ETH > SOL > BASE > ARB > NEAR per api.llama.fi/chains), so the v4
  // oracle cross-check passes and the AI judges a genuine routing intent.
  const metrics = {
    ETHEREUM: { avg_gas_usd: '2.40', bridge_security_score: '99', liquidity_depth_usd: '85000000000' },
    ARBITRUM: { avg_gas_usd: '0.08', bridge_security_score: '94', liquidity_depth_usd: '1800000000' },
    BASE:     { avg_gas_usd: '0.02', bridge_security_score: '92', liquidity_depth_usd: '8000000000' },
    SOLANA:   { avg_gas_usd: '0.002', bridge_security_score: '90', liquidity_depth_usd: '12000000000' },
    NEAR:     { avg_gas_usd: '0.01', bridge_security_score: '88', liquidity_depth_usd: '450000000' },
  };
  const base = {
    asset: 'USDC',
    chain_metrics: metrics,
    deposit_amount: '1000.000000',
    payload_timestamp: Math.floor(Date.now() / 1000).toString(),
    source_chain: 'ETHEREUM',
    source_tx_hash: '',
    user_intent: 'Route this asset to whichever chain provides the deepest liquidity and highest 24h volume.',
    ...over,
  };
  const canon = canonicalPayload(base);
  const h = createHash('sha256').update(canon).digest('hex');
  return { canon, h };
}
const randTxHash = () => '0x' + randomBytes(32).toString('hex');

async function route(client, intentId, canon, hashHex) {
  const h = await client.writeContract({
    address: ADDR, functionName: 'route_cross_chain_intent',
    args: [intentId, canon, hashHex], value: 0n,
  });
  results.txs.push(h);
  return h;
}
async function readIntent(id) {
  const r = await ro.readContract({ address: ADDR, functionName: 'get_intent', args: [id] });
  return typeof r === 'string' ? JSON.parse(r) : r;
}
async function expectRevert(name, txFn, snippet) {
  try {
    const h = await txFn();
    results.txs.push(h);
    await waitFinalized(h, 10);
    const err = await getStderr(h);
    if (err.includes('Exception:') || err.includes('UserError')) {
      if (snippet && !err.includes(snippet)) fail(name, `reverted but message missing "${snippet}": ${err.split('\n').filter(l=>l.trim()).pop()}`);
      else pass(name, `reverted as expected (${(err.split('\n').filter(l=>l.trim()).pop() || '').slice(0, 90)})`);
    } else fail(name, 'tx FINALIZED without GenVM exception; stderr=' + err.slice(0, 120));
  } catch (e) { fail(name, 'threw before revert check: ' + e.message.slice(0, 120)); }
}
async function govWrite(name, client, fn, args, snippet) {
  try {
    const h = await client.writeContract({ address: ADDR, functionName: fn, args, value: 0n });
    results.txs.push(h);
    await waitFinalized(h, 10);
    const err = await getStderr(h);
    if (snippet) {
      if (err.includes(snippet)) pass(name, `reverted as expected (${snippet})`);
      else fail(name, `expected revert "${snippet}", stderr=` + err.slice(0, 140));
    } else {
      if (err.includes('Exception:')) fail(name, 'unexpected revert: ' + err.split('\n').filter(l=>l.trim()).pop());
      else pass(name, 'executed cleanly');
    }
  } catch (e) { fail(name, 'threw: ' + e.message.slice(0, 120)); }
}

// ================= SETUP =================
log('contract:', ADDR, '| run:', RUN);
const ov = JSON.parse(await ro.readContract({ address: ADDR, functionName: 'get_protocol_overview', args: [] }));
ov.version.includes('4.0') ? pass('setup: v4 deployed', ov.version) : fail('setup: v4 deployed', ov.version);
ov.active_status === 'OPERATIONAL' ? pass('setup: operational', '') : fail('setup: operational', ov.active_status);

// fund second wallet
{
  const h = await ownerClient.sendTransaction({ to: second.address, value: parseEther('0.5') });
  results.txs.push(h); await waitFinalized(h, 8);
  pass('setup: funded second wallet', second.address);
}

// ================= A. GOVERNANCE =================
await expectRevert('A1 non-owner cannot pause', () =>
  secondClient.writeContract({ address: ADDR, functionName: 'set_paused', args: [true], value: 0n }), 'Only the protocol owner');
await govWrite('A2 owner pause blocks routing', ownerClient, 'set_paused', [true]);
{
  const { canon, h } = honestPayload();
  await expectRevert('A2b routing while paused reverts', () => route(ownerClient, nid(), canon, h), 'paused by governance');
}
await govWrite('A2c owner unpause', ownerClient, 'set_paused', [false]);
await govWrite('A3 score 0 rejected', ownerClient, 'set_minimum_safety_score', [0], 'between 1 and 100');
await govWrite('A3b score 101 rejected', ownerClient, 'set_minimum_safety_score', [101], 'between 1 and 100');
await govWrite('A3c score 80 accepted', ownerClient, 'set_minimum_safety_score', [80]);
{
  const ov2 = JSON.parse(await ro.readContract({ address: ADDR, functionName: 'get_protocol_overview', args: [] }));
  ov2.minimum_safety_score === '80' ? pass('A3d overview reflects 80', '') : fail('A3d overview reflects 80', ov2.minimum_safety_score);
}
await govWrite('A3e score restored to 75', ownerClient, 'set_minimum_safety_score', [75]);
await govWrite('A4 unknown chain pause rejected', ownerClient, 'set_chain_paused', ['FAKECHAIN', true], 'not supported');
await govWrite('A4b pause SOLANA', ownerClient, 'set_chain_paused', ['SOLANA', true]);
{
  const { canon, h } = honestPayload({ source_chain: 'SOLANA' });
  await expectRevert('A4c routing from paused chain reverts', () => route(ownerClient, nid(), canon, h), 'Source chain is currently paused');
}
await govWrite('A4d unpause SOLANA', ownerClient, 'set_chain_paused', ['SOLANA', false]);
await govWrite('A5 non-owner cannot pause asset', secondClient, 'set_asset_paused', ['USDC', true], 'Only the protocol owner');
await govWrite('A5b pause USDC', ownerClient, 'set_asset_paused', ['USDC', true]);
{
  const { canon, h } = honestPayload();
  await expectRevert('A5c routing paused asset reverts', () => route(ownerClient, nid(), canon, h), 'Asset is currently paused');
}
await govWrite('A5d unpause USDC', ownerClient, 'set_asset_paused', ['USDC', false]);
await govWrite('A6 block sender', ownerClient, 'set_sender_blocked', [second.address, true]);
{
  const { canon, h } = honestPayload();
  await expectRevert('A6b blocked sender reverts', () => route(secondClient, nid(), canon, h), 'blocked by protocol governance');
}
await govWrite('A6c unblock sender', ownerClient, 'set_sender_blocked', [second.address, false]);

// ================= B. PAYLOAD VALIDATION =================
{
  const { canon } = honestPayload();
  const badHash = '0'.repeat(64);
  await expectRevert('B1 hash mismatch reverts', () => route(ownerClient, nid(), canon, badHash), 'SHA-256 mismatch');
}
await expectRevert('B2 malformed JSON reverts', () => route(ownerClient, nid(), 'not-json{{{', createHash('sha256').update('not-json{{{').digest('hex')), 'Malformed JSON');
{
  const p = honestPayload(); const o = JSON.parse(p.canon); delete o.asset;
  const c2 = JSON.stringify(o); const h2 = createHash('sha256').update(c2).digest('hex');
  await expectRevert('B3 missing key reverts', () => route(ownerClient, nid(), c2, h2), 'Missing mandatory');
}
{
  const p = honestPayload({ payload_timestamp: (Math.floor(Date.now() / 1000) - 120).toString() });
  await expectRevert('B4 stale payload reverts', () => route(ownerClient, p.canon ? nid() : nid(), p.canon, p.h), 'TTL');
}
{
  const p = honestPayload({ payload_timestamp: (Math.floor(Date.now() / 1000) + 120).toString() });
  await expectRevert('B5 future timestamp reverts', () => route(ownerClient, nid(), p.canon, p.h), 'TTL');
}
{
  const p = honestPayload({ source_chain: 'DOGECHAIN' });
  await expectRevert('B6 unsupported chain reverts', () => route(ownerClient, nid(), p.canon, p.h), 'not supported');
}
{
  const p = honestPayload({ deposit_amount: '0.000000' });
  await expectRevert('B7 zero deposit reverts', () => route(ownerClient, nid(), p.canon, p.h), 'strictly positive');
}
{
  const p = honestPayload({ deposit_amount: '-5.000000' });
  await expectRevert('B7b negative deposit reverts', () => route(ownerClient, nid(), p.canon, p.h), 'strictly positive');
}
{
  const p = honestPayload({ source_tx_hash: 'abc' });
  await expectRevert('B8 malformed source hash reverts', () => route(ownerClient, nid(), p.canon, p.h), 'not valid 0x-prefixed');
}
{
  const p = honestPayload(); const id = nid();
  const h1 = await route(ownerClient, id, p.canon, p.h); await waitFinalized(h1);
  pass('B9a first registration ok', id);
  const p2 = honestPayload({ deposit_amount: '2000.000000' });
  await expectRevert('B9 duplicate intent_id reverts', () => route(ownerClient, id, p2.canon, p2.h), 'already registered');
  await expectRevert('B10 payload replay reverts', () => route(ownerClient, nid(), p.canon, p.h), 'already been processed');
}

// ================= C. AI ROUTING (adaptive) =================
const VALID = ['APPROVED', 'REJECTED_BY_AI', 'REJECTED_CONSENSUS_FAILED', 'REJECTED_SAFETY_SCORE', 'REJECTED_ORACLE_UNAVAILABLE', 'REJECTED_CHAIN_PAUSED'];
let approvedAwaiting = null, approvedSubmitted = null;
for (let i = 0; i < 4 && !approvedAwaiting; i++) {
  const { canon, h } = honestPayload({ deposit_amount: (500 + i * 137).toFixed(6) });
  const id = nid();
  try {
    const rh = await route(ownerClient, id, canon, h); await waitFinalized(rh);
    const rec = await readIntent(id);
    if (!VALID.includes(rec.status)) { fail('C1 valid verdict ' + id, 'unexpected status ' + rec.status); continue; }
    const fpOk = /^[0-9a-f]{64}$/.test(rec.oracle_fingerprint || '');
    (rec.oracle_sources && fpOk)
      ? pass('C1 verdict recorded ' + id, `${rec.status} src=${rec.oracle_sources} fp=${(rec.oracle_fingerprint||'').slice(0,8)}...`)
      : fail('C1 oracle attestation ' + id, `sources=${rec.oracle_sources} fp=${rec.oracle_fingerprint}`);
    if (rec.status === 'APPROVED' && rec.bridge_state === 'AWAITING_SOURCE') approvedAwaiting = id;
  } catch (e) { fail('C1 route attempt ' + id, e.message.slice(0, 100)); }
}
{
  const { canon, h } = honestPayload({ source_tx_hash: randTxHash(), deposit_amount: '777.000000' });
  const id = nid();
  try {
    const rh = await route(ownerClient, id, canon, h); await waitFinalized(rh);
    const rec = await readIntent(id);
    VALID.includes(rec.status) ? pass('C2 pre-bound routing ' + id, `${rec.status}/${rec.bridge_state}`) : fail('C2 pre-bound routing ' + id, rec.status);
    if (rec.status === 'APPROVED' && rec.bridge_state === 'SOURCE_SUBMITTED' && rec.source_tx_hash) { approvedSubmitted = id; pass('C2b pre-bound hash stored', rec.source_tx_hash.slice(0, 18) + '...'); }
  } catch (e) { fail('C2 pre-bound routing', e.message.slice(0, 100)); }
}

// ================= D. LIFECYCLE =================
if (approvedAwaiting) {
  const A1 = approvedAwaiting;
  await expectRevert('D1 non-creator bind reverts', () =>
    secondClient.writeContract({ address: ADDR, functionName: 'bind_source_transaction', args: [A1, randTxHash()], value: 0n }), 'Only the intent creator');
  await expectRevert('D2 bind malformed hash reverts', () =>
    ownerClient.writeContract({ address: ADDR, functionName: 'bind_source_transaction', args: [A1, '0x123'], value: 0n }), 'not valid 0x-prefixed');
  await govWrite('D3 creator binds valid hash', ownerClient, 'bind_source_transaction', [A1, randTxHash()]);
  {
    const rec = await readIntent(A1);
    rec.bridge_state === 'SOURCE_SUBMITTED' ? pass('D3b bridge state SOURCE_SUBMITTED', '') : fail('D3b bridge state', rec.bridge_state);
  }
  await expectRevert('D4 double bind reverts', () =>
    ownerClient.writeContract({ address: ADDR, functionName: 'bind_source_transaction', args: [A1, randTxHash()], value: 0n }), 'not waiting');
  await govWrite('D5 reporter confirms source', ownerClient, 'report_bridge_status', [A1, 'SOURCE_CONFIRMED', '']);
  await expectRevert('D6 non-reporter report reverts', () =>
    secondClient.writeContract({ address: ADDR, functionName: 'report_bridge_status', args: [A1, 'COMPLETED', '0xdest'], value: 0n }), 'Only the authorized Bridge Oracle');
  await govWrite('D7 set_bridge_reporter(second)', ownerClient, 'set_bridge_reporter', [second.address]);
  await expectRevert('D7b old reporter rejected', () =>
    ownerClient.writeContract({ address: ADDR, functionName: 'report_bridge_status', args: [A1, 'COMPLETED', '0xdest'], value: 0n }), 'Only the authorized Bridge Oracle');
  await govWrite('D7c new reporter completes', secondClient, 'report_bridge_status', [A1, 'COMPLETED', '0xdesthash']);
  await expectRevert('D7d terminal state locked', () =>
    secondClient.writeContract({ address: ADDR, functionName: 'report_bridge_status', args: [A1, 'COMPLETED', ''], value: 0n }), 'terminal state');
  await govWrite('D7e reporter restored to owner', ownerClient, 'set_bridge_reporter', [owner.address]);
} else {
  fail('D lifecycle', 'no APPROVED AWAITING_SOURCE intent produced; lifecycle tests skipped');
}
if (approvedSubmitted) {
  const A2 = approvedSubmitted;
  await expectRevert('D8 invalid transition reverts', () =>
    ownerClient.writeContract({ address: ADDR, functionName: 'report_bridge_status', args: [A2, 'COMPLETED', ''], value: 0n }), 'Invalid status transition');
}
// cancel flow: route fresh intent, hope for APPROVED
{
  let cId = null;
  for (let i = 0; i < 3 && !cId; i++) {
    const { canon, h } = honestPayload({ deposit_amount: (111 + i * 7).toFixed(6), asset: 'USDT' });
    const id = nid();
    const rh = await route(ownerClient, id, canon, h); await waitFinalized(rh);
    const rec = await readIntent(id);
    if (rec.status === 'APPROVED' && rec.bridge_state === 'AWAITING_SOURCE') cId = id;
  }
  if (cId) {
    await expectRevert('D9 non-creator cancel reverts', () =>
      secondClient.writeContract({ address: ADDR, functionName: 'cancel_intent', args: [cId], value: 0n }), 'Only the intent creator');
    await govWrite('D9b creator cancels', ownerClient, 'cancel_intent', [cId]);
    const rec = await readIntent(cId);
    rec.bridge_state === 'CANCELLED' ? pass('D9c bridge state CANCELLED', '') : fail('D9c bridge state', rec.bridge_state);
    await expectRevert('D9d double cancel reverts', () =>
      ownerClient.writeContract({ address: ADDR, functionName: 'cancel_intent', args: [cId], value: 0n }), 'Only intents awaiting');
    await expectRevert('D9e report on cancelled reverts', () =>
      ownerClient.writeContract({ address: ADDR, functionName: 'report_bridge_status', args: [cId, 'SOURCE_CONFIRMED', ''], value: 0n }), 'terminal state');
  } else fail('D9 cancel flow', 'no APPROVED intent for cancel test');
}

// ownership transfer
await govWrite('D10 transfer ownership to second', ownerClient, 'transfer_ownership', [second.address]);
await expectRevert('D10b old owner locked out', () =>
  ownerClient.writeContract({ address: ADDR, functionName: 'set_paused', args: [true], value: 0n }), 'Only the protocol owner');
await govWrite('D10c new owner pauses', secondClient, 'set_paused', [true]);
await govWrite('D10d ownership returned', secondClient, 'transfer_ownership', [owner.address]);
await govWrite('D10e owner unpauses', ownerClient, 'set_paused', [false]);

// ================= E. FINALIZE =================
{
  const uniq = [...new Set(results.txs)];
  const deadline = Date.now() + 20 * 60 * 1000;
  const st = {};
  while (Date.now() < deadline) {
    let all = true;
    for (const h of uniq) {
      if (st[h] === 'FINALIZED') continue;
      try { const t = await ro.getTransaction({ hash: h }); st[h] = stName(t); }
      catch { st[h] = 'ERR'; }
      if (st[h] !== 'FINALIZED' && st[h] !== '7') all = false;
    }
    if (all) break;
    await new Promise(r => setTimeout(r, 20000));
  }
  const notFin = uniq.filter(h => st[h] !== 'FINALIZED' && st[h] !== '7');
  notFin.length === 0
    ? pass('E all txs FINALIZED', `${uniq.length}/${uniq.length}`)
    : fail('E all txs FINALIZED', `${uniq.length - notFin.length}/${uniq.length} (${notFin.join(',')})`);
}

const passed = results.scenarios.filter(s => s.pass).length;
results.summary = { passed, total: results.scenarios.length };
writeFileSync(new URL('../../po-v4-results.json', import.meta.url), JSON.stringify(results, null, 2));
log(`DONE: ${passed}/${results.scenarios.length} scenarios passed`);
process.exit(passed === results.scenarios.length ? 0 : 1);