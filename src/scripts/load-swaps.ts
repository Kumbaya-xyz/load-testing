#!/usr/bin/env tsx
/**
 * Swap Transaction Load Generation Script
 *
 * Generates swap transactions for sequencer load testing.
 * REQUIRES: Funded wallets with ETH and tokens.
 *
 * Usage:
 *   npx tsx src/scripts/load-swaps.ts [options]
 *
 * Options:
 *   --private-key=0x...  Private key of funded wallet (REQUIRED)
 *   --tps=N              Transactions per second (default: 1)
 *   --count=N            Total number of transactions (default: 10)
 *   --amount=N           Amount in ETH per swap (default: 0.001)
 *   --network=N          Network: mainnet or testnet (default: mainnet)
 *   --dry-run            Only simulate, don't send transactions
 *
 * Example:
 *   npx tsx src/scripts/load-swaps.ts --private-key=0x... --tps=2 --count=20 --dry-run
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MEGAETH_MAINNET, MEGAETH_TESTNET } from '../config/addresses.js';
import { SWAP_ROUTER_02_ABI, QUOTER_V2_ABI, ERC20_ABI } from '../abis/index.js';
import { megaethMainnet, megaethTestnet, createMetrics, recordSuccess, recordError, printMetricsSummary } from '../utils/client.js';

interface Options {
  privateKey: string | null;
  tps: number;
  count: number;
  amount: string;
  network: 'mainnet' | 'testnet';
  dryRun: boolean;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    privateKey: null,
    tps: 1,
    count: 10,
    amount: '0.001',
    network: 'mainnet',
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--private-key=')) {
      options.privateKey = arg.split('=')[1];
    } else if (arg.startsWith('--tps=')) {
      options.tps = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--count=')) {
      options.count = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--amount=')) {
      options.amount = arg.split('=')[1];
    } else if (arg.startsWith('--network=')) {
      options.network = arg.split('=')[1] as 'mainnet' | 'testnet';
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

async function getQuote(
  client: PublicClient,
  quoterAddress: Address,
  tokenIn: Address,
  tokenOut: Address,
  fee: number,
  amountIn: bigint
): Promise<bigint> {
  const result = await client.simulateContract({
    address: quoterAddress,
    abi: QUOTER_V2_ABI,
    functionName: 'quoteExactInputSingle',
    args: [
      {
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const [amountOut] = result.result as [bigint, ...unknown[]];
  return amountOut;
}

async function main() {
  const options = parseArgs();
  const network = options.network === 'mainnet' ? MEGAETH_MAINNET : MEGAETH_TESTNET;
  const chain = options.network === 'mainnet' ? megaethMainnet : megaethTestnet;

  console.log(`\n🚀 Swap Load Test`);
  console.log(`   Network: ${network.chainName}`);
  console.log(`   Mode: ${options.dryRun ? 'DRY RUN (simulation only)' : '🔥 LIVE TRANSACTIONS'}`);
  console.log(`   Target: ${options.tps} tx/s, ${options.count} total`);
  console.log(`   Amount per swap: ${options.amount} ETH\n`);

  if (!options.privateKey && !options.dryRun) {
    console.error('❌ Error: --private-key is required for live transactions');
    console.error('   Use --dry-run for simulation mode');
    process.exit(1);
  }

  const publicClient = createPublicClient({
    chain,
    transport: http(network.rpc, { retryCount: 0 }),
  });

  let walletClient: WalletClient | null = null;
  let account: ReturnType<typeof privateKeyToAccount> | null = null;

  if (options.privateKey) {
    account = privateKeyToAccount(options.privateKey as `0x${string}`);
    walletClient = createWalletClient({
      account,
      chain,
      transport: http(network.rpc),
    });

    // Check balance
    const balance = await publicClient.getBalance({ address: account.address });
    console.log(`   Wallet: ${account.address}`);
    console.log(`   Balance: ${formatEther(balance)} ETH`);

    const requiredBalance = parseEther(options.amount) * BigInt(options.count);
    if (balance < requiredBalance) {
      console.error(`\n❌ Insufficient balance. Need at least ${formatEther(requiredBalance)} ETH`);
      process.exit(1);
    }
  }

  const pool = options.network === 'mainnet'
    ? network.pools['DUCK-WETH-10000']
    : network.pools['WETH-USDC-3000'];

  if (!pool) {
    console.error('No pool configured for this network');
    process.exit(1);
  }

  console.log(`\n   Pool: ${pool.address}`);
  console.log(`   Swapping: WETH -> ${pool.token0 === network.contracts.WETH9 ? pool.token1 : pool.token0}`);

  const amountIn = parseEther(options.amount);

  // Get initial quote
  console.log('\n   Getting initial quote...');
  const tokenIn = pool.token1 as Address; // WETH
  const tokenOut = pool.token0 as Address; // Token
  const quote = await getQuote(publicClient, network.contracts.QuoterV2 as Address, tokenIn, tokenOut, pool.fee, amountIn);
  console.log(`   ${options.amount} WETH -> ${formatEther(quote)} tokens\n`);

  const metrics = createMetrics();
  const startTime = Date.now();
  const intervalMs = 1000 / options.tps;

  const pendingTxs: Promise<void>[] = [];

  for (let i = 0; i < options.count; i++) {
    const reqStart = Date.now();
    console.log(`   Swap ${i + 1}/${options.count}...`);

    try {
      if (options.dryRun) {
        // Simulate the swap
        await publicClient.simulateContract({
          address: network.contracts.SwapRouter02 as Address,
          abi: SWAP_ROUTER_02_ABI,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn,
              tokenOut,
              fee: pool.fee,
              recipient: account?.address ?? '0x0000000000000000000000000000000000000001' as Address,
              amountIn,
              amountOutMinimum: 0n,
              sqrtPriceLimitX96: 0n,
            },
          ],
          value: amountIn, // Sending ETH for WETH swap
        });
        recordSuccess(metrics, Date.now() - reqStart);
        console.log(`     ✓ Simulated successfully`);
      } else if (walletClient && account) {
        // Send actual transaction
        const hash = await walletClient.writeContract({
          address: network.contracts.SwapRouter02 as Address,
          abi: SWAP_ROUTER_02_ABI,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn,
              tokenOut,
              fee: pool.fee,
              recipient: account.address,
              amountIn,
              amountOutMinimum: 0n, // No slippage protection for load testing
              sqrtPriceLimitX96: 0n,
            },
          ],
          value: amountIn,
        });

        console.log(`     Tx: ${hash}`);

        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        recordSuccess(metrics, Date.now() - reqStart);
        console.log(`     ✓ Confirmed in block ${receipt.blockNumber}, gas: ${receipt.gasUsed}`);
      }
    } catch (error) {
      recordError(metrics, error as Error);
      console.log(`     ✗ Failed: ${(error as Error).message.slice(0, 80)}`);
    }

    // Rate limiting
    const elapsed = Date.now() - reqStart;
    if (elapsed < intervalMs && i < options.count - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs - elapsed));
    }
  }

  await Promise.all(pendingTxs);
  metrics.totalDurationMs = Date.now() - startTime;

  printMetricsSummary(metrics, `Swap Load Test (${options.tps} tx/s x ${options.count})`);

  if (metrics.rateLimitErrors > 0) {
    console.log('\n❌ RATE LIMIT ERRORS DETECTED');
    process.exit(1);
  }

  if (metrics.failedRequests > 0) {
    console.log('\n⚠️  SOME TRANSACTIONS FAILED');
    process.exit(1);
  }

  console.log('\n✅ All transactions completed successfully');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
