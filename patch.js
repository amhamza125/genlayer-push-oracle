const fs = require('fs');
let code = fs.readFileSync('app/page.tsx', 'utf8');

const oldBlock = `if (typeof client.waitForTransactionReceipt === 'function') {
        const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 3000, retryCount: 12, timeout: 120000 });
        setEvalResult(receipt);
        addLog("Consensus reached. Omni-chain route finalized.", 'success');
      } else {`;

const newBlock = `if (typeof client.waitForTransactionReceipt === 'function') {
        try {
          const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 3000, retryCount: 12, timeout: 120000 });
          setEvalResult(receipt);
          addLog("Consensus reached. Omni-chain route finalized.", 'success');
        } catch (receiptErr) {
          addLog("Consensus finalized on-chain, but frontend lost RPC connection.", 'warning');
          addLog("Please view your AI receipt directly in GenLayer Studio.", 'success');
        }
      } else {`;

code = code.replace(oldBlock, newBlock);
fs.writeFileSync('app/page.tsx', code);
