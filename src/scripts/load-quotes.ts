#!/usr/bin/env tsx
/**
 * Quote Load Generation Script
 *
 * Generates sustained quote request load against the RPC.
 * This is a read-only operation that simulates swap price checks.
 *
 * Usage:
 *   npx tsx src/scripts/load-quotes.ts [options]
 *
 * Options:
 *   --rps=N       Requests per second (default: 10)
 *   --duration=N  Duration in seconds (default: 60)
 *   --network=N   Network: mainnet or testnet (default: mainnet)
 */

import { createPublicClient, http, parseEther, type Address } from 'viem';
import { MEGAETH_MAINNET, MEGAETH_TESTNET } from '../config/addresses.js';
import { QUOTER_V2_ABI } from '../abis/index.js';
import { megaethMainnet, megaethTestnet, createMetrics, recordSuccess, recordError, printMetricsSummary } from '../utils/client.js';

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    rps: 10,
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

async function main() {
  const options = parseArgs();
  const network = options.network === 'mainnet' ? MEGAETH_MAINNET : MEGAETH_TESTNET;
  const chain = options.network === 'mainnet' ? megaethMainnet : megaethTestnet;

  console.log(`\n🚀 Starting Quote Load Test`);
  console.log(`   Network: ${network.chainName}`);
  console.log(`   RPC: ${network.rpc}`);
  console.log(`   Target: ${options.rps} req/s for ${options.duration}s`);
  console.log(`   Expected total: ${options.rps * options.duration} requests\n`);

  const client = createPublicClient({
    chain,
    transport: http(network.rpc, { retryCount: 0 }),
  });

  // Select pool based on network
  const pool = options.network === 'mainnet'
    ? network.pools['DUCK-WETH-10000']
    : network.pools['WETH-USDC-3000'];

  if (!pool) {
    console.error('No pool configured for this network');
    process.exit(1);
  }

  console.log(`   Pool: ${pool.address}`);
  console.log(`   Token0: ${pool.token0}`);
  console.log(`   Token1: ${pool.token1}`);
  console.log(`   Fee: ${pool.fee / 10000}%\n`);

  const metrics = createMetrics();
  const startTime = Date.now();
  const endTime = startTime + options.duration * 1000;
  const intervalMs = 1000 / options.rps;

  const pendingRequests: Promise<void>[] = [];
  let requestIndex = 0;

  // Generate requests at specified rate
  while (Date.now() < endTime) {
    const reqStart = Date.now();
    const currentIndex = requestIndex++;

    // Vary the amount slightly to avoid caching
    const amountIn = parseEther('0.01') + BigInt(currentIndex);

    const request = client.simulateContract({
      address: network.contracts.QuoterV2 as Address,
      abi: QUOTER_V2_ABI,
      functionName: 'quoteExactInputSingle',
      args: [
        {
          tokenIn: pool.token1 as Address,
          tokenOut: pool.token0 as Address,
          amountIn,
          fee: pool.fee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    }).then(() => {
      recordSuccess(metrics, Date.now() - reqStart);
    }).catch((error) => {
      recordError(metrics, error as Error);
    });

    pendingRequests.push(request);

    // Progress indicator every 10 seconds
    if (requestIndex % (options.rps * 10) === 0) {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`   Progress: ${requestIndex} requests sent (${elapsed}s elapsed)`);
    }

    // Wait for next interval
    const elapsed = Date.now() - reqStart;
    if (elapsed < intervalMs) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs - elapsed));
    }
  }

  // Wait for all pending requests to complete
  console.log(`\n   Waiting for ${pendingRequests.length} pending requests...`);
  await Promise.all(pendingRequests);

  metrics.totalDurationMs = Date.now() - startTime;

  printMetricsSummary(metrics, `Quote Load Test (${options.rps} req/s x ${options.duration}s)`);

  // Exit with error code if there were rate limit errors
  if (metrics.rateLimitErrors > 0) {
    console.log('\n❌ RATE LIMIT ERRORS DETECTED');
    console.log('   The RPC infrastructure could not handle the requested load.');
    console.log(`   Rate limit errors: ${metrics.rateLimitErrors}`);
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
