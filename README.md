# Kumbaya DEX Load Testing Suite

Comprehensive load testing suite for Kumbaya DEX on MegaETH. This suite tests both RPC infrastructure (read operations) and sequencer capacity (transaction throughput).

## Overview

This test suite is designed to stress-test MegaETH infrastructure to ensure optimal performance for the Kumbaya DEX. Tests are **intentionally designed without rate limiting or backoff** - failures indicate infrastructure issues that need to be addressed.

**45 tests** across 4 test files covering RPC reads, load testing, transaction encoding, and frontend patterns.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run all tests
pnpm test

# Run specific test suites
pnpm test:rpc           # Basic RPC read operations
pnpm test:load:rpc      # RPC load tests
pnpm test:load:tx       # Transaction simulation tests
pnpm test:load:frontend # Frontend pattern tests
```

## Test Categories

### 1. RPC Read Tests (`src/tests/rpc-reads.test.ts`) - 5 tests

Basic functional tests for RPC read operations:
- Pool state reads (slot0, liquidity, tokens, fee)
- Factory lookups (getPool, feeAmountTickSpacing)

### 2. RPC Load Tests (`src/load-tests/rpc-load.test.ts`) - 10 tests

Stress tests for RPC infrastructure:

| Test | Description | Expected Behavior |
|------|-------------|-------------------|
| Burst: 100 slot0 reads | 100 concurrent pool state reads | All should succeed |
| Burst: 100 quotes | 100 concurrent quote requests | All should succeed |
| Burst: 200 mixed reads | 200 concurrent varied reads | All should succeed |
| Sustained: 10 req/s × 10s | Continuous load | No rate limits |
| Sustained: 50 req/s × 5s | Higher sustained load | No rate limits |
| Simulated swap page | Realistic user session | All should succeed |
| 10 concurrent users | Multiple user simulation | All should succeed |

### 3. Transaction Tests (`src/load-tests/tx-load.test.ts`) - 20 tests

Transaction encoding and simulation:
- **SwapRouter02**: exactInputSingle encoding, various amounts
- **Liquidity ops**: mint, decreaseLiquidity, collect encoding
- **Universal Router**: V3_SWAP_EXACT_IN, WRAP_ETH, UNWRAP_WETH, multi-command
- **Gas estimation**: Quote gas estimates
- **Router verification**: SwapRouter02 configuration reads

### 4. Frontend Pattern Tests (`src/load-tests/frontend-patterns.test.ts`) - 10 tests

Tests simulating actual frontend RPC patterns:

| Test | Description |
|------|-------------|
| Multicall3 batch | Batch slot0 + liquidity via `tryAggregate` |
| 10 pool concurrent fetch | Parallel pool state fetches |
| Multi-fee-tier discovery | Pool discovery across 0.01%, 0.05%, 0.3%, 1% tiers |
| Factory getPool lookup | Pool address lookup for all fee tiers |
| Batched QuoterV2 quotes | Multiple route quotes in single multicall |
| Frontend route discovery | Complete swap routing simulation |
| Chunked quote requests | QuoterV2 chunking pattern |
| 5 concurrent sessions | Concurrent frontend session simulation |
| 20 concurrent multicalls | High concurrency multicall stress test |
| 50 mixed multicalls | Mixed quote + pool state requests |

## Load Generation Scripts

For sustained load testing, use the standalone scripts:

### Quote Load (`src/scripts/load-quotes.ts`)

```bash
# 10 requests/second for 60 seconds (default)
npx tsx src/scripts/load-quotes.ts

# Custom configuration
npx tsx src/scripts/load-quotes.ts --rps=50 --duration=120

# Test against testnet
npx tsx src/scripts/load-quotes.ts --network=testnet
```

### Pool State Read Load (`src/scripts/load-pool-reads.ts`)

```bash
# 50 requests/second for 60 seconds (default)
npx tsx src/scripts/load-pool-reads.ts

# High load test
npx tsx src/scripts/load-pool-reads.ts --rps=100 --duration=30
```

### Swap Transaction Load (`src/scripts/load-swaps.ts`)

⚠️ **Requires funded wallet**

```bash
# Dry run (simulation only)
npx tsx src/scripts/load-swaps.ts --dry-run --count=10

# Live transactions
npx tsx src/scripts/load-swaps.ts \
  --private-key=0x... \
  --tps=2 \
  --count=20 \
  --amount=0.001
```

## Contract Addresses (MegaETH Mainnet)

| Contract | Address |
|----------|---------|
| WETH9 | `0x4200000000000000000000000000000000000006` |
| UniswapV3Factory | `0x68b34591f662508076927803c567Cc8006988a09` |
| SwapRouter02 | `0xE5BbEF8De2DB447a7432A47EBa58924d94eE470e` |
| UniversalRouter | `0xAAB1C664CeaD881AfBB58555e6A3a79523D3e4C0` |
| QuoterV2 | `0x1F1a8dC7E138C34b503Ca080962aC10B75384a27` |
| NonfungiblePositionManager | `0x2b781C57e6358f64864Ff8EC464a03Fdaf9974bA` |
| Multicall | `0xeeb4a1001354717598Af33f3585B66F9de7e7b27` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| TickLens | `0x9c22f028e0a1dc76EB895a1929DBc517c9D0593e` |

## Test Pools

### Mainnet (Chain ID: 4326)

| Pool | Address | Fee |
|------|---------|-----|
| DUCK/WETH | `0xab72F355eE690252A07D197B2A17E3a232419f39` | 1% |
| FLUFFEY/WETH | `0x775c5B9A73f80889CCdd3da91F0bA61069E48E83` | 0.3% |

### Testnet (Chain ID: 6343)

| Pool | Address | Fee |
|------|---------|-----|
| WETH/USDC | `0xe8c130e4001Dc9526408F69976c762113f88E784` | 0.01% |
| WETH/USDC | `0x5d27D14c3f514969D083E1C8D7C9c0463D8EA795` | 0.3% |

## API Methods Tested

### Read Operations (eth_call)

| Method | Contract | Description |
|--------|----------|-------------|
| `slot0()` | Pool | Current price/tick |
| `liquidity()` | Pool | Current liquidity |
| `token0()`, `token1()` | Pool | Pool tokens |
| `fee()` | Pool | Fee tier |
| `ticks(int24)` | Pool | Tick data |
| `tickBitmap(int16)` | Pool | Tick bitmap |
| `getPool(address,address,uint24)` | Factory | Pool lookup |
| `feeAmountTickSpacing(uint24)` | Factory | Tick spacing |
| `quoteExactInputSingle(...)` | QuoterV2 | Swap quote |
| `quoteExactOutputSingle(...)` | QuoterV2 | Reverse quote |
| `balanceOf(address)` | ERC20/NFT | Token balance |
| `positions(uint256)` | NFT PM | Position details |
| `aggregate(...)` | Multicall | Batch calls |
| `tryAggregate(bool,Call[])` | Multicall3 | Batch calls (frontend pattern) |

### Write Operations (eth_sendRawTransaction)

| Method | Contract | Description |
|--------|----------|-------------|
| `exactInputSingle(...)` | SwapRouter02 | Single-hop swap (exact input) |
| `exactOutputSingle(...)` | SwapRouter02 | Single-hop swap (exact output) |
| `execute(bytes,bytes[],uint256)` | UniversalRouter | Multi-command execution |
| `mint(...)` | NFT PM | Add liquidity |
| `increaseLiquidity(...)` | NFT PM | Increase position |
| `decreaseLiquidity(...)` | NFT PM | Decrease position |
| `collect(...)` | NFT PM | Collect fees |

### Universal Router Commands

| Command | Byte | Description |
|---------|------|-------------|
| V3_SWAP_EXACT_IN | `0x00` | V3 swap with exact input |
| V3_SWAP_EXACT_OUT | `0x01` | V3 swap with exact output |
| WRAP_ETH | `0x0b` | Wrap ETH to WETH |
| UNWRAP_WETH | `0x0c` | Unwrap WETH to ETH |

## Metrics Collected

- **Request count**: Total, successful, failed
- **Error breakdown**: Rate limit errors vs other errors
- **Latency**: Average, P50, P95, P99
- **Throughput**: Requests per second achieved
- **Error messages**: First 5 errors logged

## Expected Results

For a production-ready RPC infrastructure:

| Metric | Target |
|--------|--------|
| Burst capacity | 200+ concurrent requests |
| Sustained read load | 100+ req/s |
| Quote throughput | 50+ req/s |
| Rate limit errors | 0 |
| P99 latency | < 500ms |

## Troubleshooting Rate Limits

If tests fail with rate limit errors:

1. **Check error messages** for specific limits hit
2. **Note the threshold** where failures start
3. **Document patterns** - burst vs sustained failures
4. **Report to MegaETH team** with test output

## Project Structure

```
load-testing/
├── src/
│   ├── config/
│   │   └── addresses.ts          # Contract addresses and pools
│   ├── abis/
│   │   └── index.ts              # Minimal ABIs for testing
│   ├── utils/
│   │   └── client.ts             # Viem client setup, metrics
│   ├── tests/
│   │   └── rpc-reads.test.ts     # Basic RPC tests (5 tests)
│   ├── load-tests/
│   │   ├── rpc-load.test.ts      # RPC stress tests (10 tests)
│   │   ├── tx-load.test.ts       # Transaction encoding tests (20 tests)
│   │   └── frontend-patterns.test.ts  # Frontend Multicall3 patterns (10 tests)
│   └── scripts/
│       ├── load-quotes.ts        # Quote load generator
│       ├── load-pool-reads.ts    # Pool read generator
│       └── load-swaps.ts         # Swap tx generator
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## License

MIT
