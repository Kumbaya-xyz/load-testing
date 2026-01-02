#!/usr/bin/env tsx
/**
 * Pool State Read Load Generation Script
 *
 * Generates sustained pool state read load against the RPC.
 * Simulates the continuous polling that frontends do.
 *
 * Usage:
 *   npx tsx src/scripts/load-pool-reads.ts [options]
 *
 * Options:
 *   --rps=N       Requests per second (default: 50)
 *   --duration=N  Duration in seconds (default: 60)
 *   --network=N   Network: mainnet or testnet (default: mainnet)
 */

import { createPublicClient, http, type Address } from 'viem';
import { MEGAETH_MAINNET, MEGAETH_TESTNET } from '../config/addresses.js';
import { UNISWAP_V3_POOL_ABI, ERC20_ABI } from '../abis/index.js';
import { megaethMainnet, megaethTestnet, createMetrics, recordSuccess, recordError, printMetricsSummary } from '../utils/client.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    rps: 50,
    duration: 60,
    network: 'mainnet' as 'mainnet' | 'testnet',
  };

  for (const arg of args) {
    if (arg.startsWith('--rps=')) {
      options.rps = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--duration=')) {
      options.duration = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--network=')) {
      options.network = arg.split('=')[1] as 'mainnet' | 'testnet';
    }
  }

  return options;
}

type ReadOperation = () => Promise<unknown>;

async function main() {
  const options = parseArgs();
  const network = options.network === 'mainnet' ? MEGAETH_MAINNET : MEGAETH_TESTNET;
  const chain = options.network === 'mainnet' ? megaethMainnet : megaethTestnet;

  console.log(`\n🚀 Starting Pool Read Load Test`);
  console.log(`   Network: ${network.chainName}`);
  console.log(`   RPC: ${network.rpc}`);
  console.log(`   Target: ${options.rps} req/s for ${options.duration}s`);
  console.log(`   Expected total: ${options.rps * options.duration} requests\n`);

  const client = createPublicClient({
    chain,
    transport: http(network.rpc, { retryCount: 0 }),
  });

  const pool = options.network === 'mainnet'
    ? network.pools['DUCK-WETH-10000']
    : network.pools['WETH-USDC-3000'];

  if (!pool) {
    console.error('No pool configured for this network');
    process.exit(1);
  }

  // Define the different read operations to cycle through
  const operations: ReadOperation[] = [
    // slot0 - most common read
    () => client.readContract({
      address: pool.address as Address,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: 'slot0',
    }),
    // liquidity
    () => client.readContract({
      address: pool.address as Address,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: 'liquidity',
    }),
    // token0
    () => client.readContract({
      address: pool.address as Address,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: 'token0',
    }),
    // token1
    () => client.readContract({
      address: pool.address as Address,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: 'token1',
    }),
    // fee
    () => client.readContract({
      address: pool.address as Address,
      abi: UNISWAP_V3_POOL_ABI,
      functionName: 'fee',
    }),
    // WETH totalSupply
    () => client.readContract({
      address: network.contracts.WETH9 as Address,
      abi: ERC20_ABI,
      functionName: 'totalSupply',
    }),
  ];

  const metrics = createMetrics();
  const startTime = Date.now();
  const endTime = startTime + options.duration * 1000;
  const intervalMs = 1000 / options.rps;

  const pendingRequests: Promise<void>[] = [];
  let requestIndex = 0;

  while (Date.now() < endTime) {
    const reqStart = Date.now();
    const operation = operations[requestIndex % operations.length];
    requestIndex++;

    const request = operation().then(() => {
      recordSuccess(metrics, Date.now() - reqStart);
    }).catch((error) => {
      recordError(metrics, error as Error);
    });

    pendingRequests.push(request);

    if (requestIndex % (options.rps * 10) === 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`   Progress: ${requestIndex} requests sent (${elapsed}s elapsed)`);
    }

    const elapsed = Date.now() - reqStart;
    if (elapsed < intervalMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs - elapsed));
    }
  }

  console.log(`\n   Waiting for ${pendingRequests.length} pending requests...`);
  await Promise.all(pendingRequests);

  metrics.totalDurationMs = Date.now() - startTime;

  printMetricsSummary(metrics, `Pool Read Load Test (${options.rps} req/s x ${options.duration}s)`);

  if (metrics.rateLimitErrors > 0) {
    console.log('\n❌ RATE LIMIT ERRORS DETECTED');
    console.log('   The RPC infrastructure could not handle the requested load.');
    process.exit(1);
  }

  if (metrics.failedRequests > 0) {
    console.log('\n⚠️  SOME REQUESTS FAILED');
    process.exit(1);
  }

  console.log('\n✅ All requests completed successfully');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
