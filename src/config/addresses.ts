/**
 * Kumbaya DEX Contract Addresses
 * Source: integrator-kit/addresses/megaETH-mainnet.json
 */

export const MEGAETH_MAINNET = {
  chainId: 4326,
  chainName: 'MegaETH',
  rpc: 'https://mainnet.megaeth.com/rpc',
  blockExplorer: 'https://megaeth.blockscout.com/',
  contracts: {
    WETH9: '0x4200000000000000000000000000000000000006' as const,
    UniswapV3Factory: '0x68b34591f662508076927803c567Cc8006988a09' as const,
    NonfungiblePositionManager: '0x2b781C57e6358f64864Ff8EC464a03Fdaf9974bA' as const,
    SwapRouter02: '0xE5BbEF8De2DB447a7432A47EBa58924d94eE470e' as const,
    UniversalRouter: '0xAAB1C664CeaD881AfBB58555e6A3a79523D3e4C0' as const,
    QuoterV2: '0x1F1a8dC7E138C34b503Ca080962aC10B75384a27' as const,
    Permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const,
    Multicall2: '0xf6f404ac6289ab8eB1caf244008b5F073d59385c' as const,
    Multicall: '0xeeb4a1001354717598Af33f3585B66F9de7e7b27' as const,
    Multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11' as const,
    TickLens: '0x9c22f028e0a1dc76EB895a1929DBc517c9D0593e' as const,
    V3Migrator: '0xE2702742F78b84F2032C5A36082b199E2d62aAB0' as const,
    UniswapV3Staker: '0x9F393A399321110Fb7D85aCc812b8e48A7c569aC' as const,
  },
  // Known tokens
  tokens: {
    WETH: '0x4200000000000000000000000000000000000006' as const,
    DUCK: '0x021ee124cF23D302A7f725AE7a01B77A8ce9782B' as const,
    FLUFFEY: '0xC5808cF8Be4e4CE012aA65bf6F60E24A3cC82071' as const,
  },
  // Known pools with liquidity
  pools: {
    // DUCK/WETH 1% fee - has liquidity
    'DUCK-WETH-10000': {
      address: '0xab72F355eE690252A07D197B2A17E3a232419f39' as const,
      token0: '0x021ee124cF23D302A7f725AE7a01B77A8ce9782B' as const, // DUCK
      token1: '0x4200000000000000000000000000000000000006' as const, // WETH
      fee: 10000,
    },
    // FLUFFEY/WETH 0.3% fee - has liquidity
    'FLUFFEY-WETH-3000': {
      address: '0x775c5B9A73f80889CCdd3da91F0bA61069E48E83' as const,
      token0: '0x4200000000000000000000000000000000000006' as const, // WETH
      token1: '0xC5808cF8Be4e4CE012aA65bf6F60E24A3cC82071' as const, // FLUFFEY
      fee: 3000,
    },
  },
  poolInitCodeHash: '0x851d77a45b8b9a205fb9f44cb829cceba85282714d2603d601840640628a3da7' as const,
} as const;

export const MEGAETH_TESTNET = {
  chainId: 6343,
  chainName: 'MegaETH Testnet',
  rpc: 'https://timothy.megaeth.com/rpc',
  blockExplorer: 'https://megaeth-testnet-v2.blockscout.com/',
  contracts: {
    WETH9: '0x4200000000000000000000000000000000000006' as const,
    UniswapV3Factory: '0x53447989580f541bc138d29A0FcCf72AfbBE1355' as const,
    NonfungiblePositionManager: '0x367f9db1F974eA241ba046b77B87C58e2947d8dF' as const,
    SwapRouter02: '0x8268DC930BA98759E916DEd4c9F367A844814023' as const,
    UniversalRouter: '0x7E6c4Ada91e432efe5F01FbCb3492Bd3eb7ccD2E' as const,
    QuoterV2: '0xfb230b93803F90238cB03f254452bA3a3b0Ec38d' as const,
    Permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const,
    Multicall: '0xC2C69F04026E8a8D2C9F09dD0D7fc4b1105f7c89' as const,
    TickLens: '0x6D65B4854944Fd93Cd568bb1B54EE22Fe9BF2faa' as const,
  },
  tokens: {
    WETH: '0x4200000000000000000000000000000000000006' as const,
    USDC: '0x75139A9559c9CD1aD69B7E239C216151D2c81e6f' as const,
    USDT: '0x8E1eb0b74A0aC37abaa0f75C598A681975896900' as const,
  },
  pools: {
    // WETH/USDC 0.01% fee
    'WETH-USDC-100': {
      address: '0xe8c130e4001Dc9526408F69976c762113f88E784' as const,
      token0: '0x4200000000000000000000000000000000000006' as const, // WETH
      token1: '0x75139A9559c9CD1aD69B7E239C216151D2c81e6f' as const, // USDC
      fee: 100,
    },
    // WETH/USDC 0.3% fee
    'WETH-USDC-3000': {
      address: '0x5d27D14c3f514969D083E1C8D7C9c0463D8EA795' as const,
      token0: '0x4200000000000000000000000000000000000006' as const, // WETH
      token1: '0x75139A9559c9CD1aD69B7E239C216151D2c81e6f' as const, // USDC
      fee: 3000,
    },
  },
  poolInitCodeHash: '0x851d77a45b8b9a205fb9f44cb829cceba85282714d2603d601840640628a3da7' as const,
} as const;

// Common fee tiers
export const FEE_TIERS = {
  LOWEST: 100,    // 0.01%
  LOW: 500,       // 0.05%
  MEDIUM: 3000,   // 0.3%
  HIGH: 10000,    // 1%
} as const;

// Tick spacing by fee tier
export const TICK_SPACING: Record<number, number> = {
  [FEE_TIERS.LOWEST]: 1,
  [FEE_TIERS.LOW]: 10,
  [FEE_TIERS.MEDIUM]: 60,
  [FEE_TIERS.HIGH]: 200,
} as const;

export type NetworkConfig = typeof MEGAETH_MAINNET | typeof MEGAETH_TESTNET;

export function getNetwork(chainId: number): NetworkConfig {
  if (chainId === 4326) return MEGAETH_MAINNET;
  if (chainId === 6343) return MEGAETH_TESTNET;
  throw new Error(`Unknown chain ID: ${chainId}`);
}

// Default to mainnet for load testing
export const DEFAULT_NETWORK = MEGAETH_MAINNET;
