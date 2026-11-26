import { useEffect, useRef } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { WalletBalance } from '@astroid/wallet';
import { useAstroidClient } from '../hooks.js';

export interface UseWalletBalanceOptions {
  enabled?: boolean;
  refetchInterval?: number | false;
  staleTime?: number;
  assetCode?: string;
  issuer?: string;
  lowBalanceThreshold?: number;
  onLowBalance?: (balance: WalletBalance) => void;
}

export interface UseWalletBalanceResult extends UseQueryResult<WalletBalance, Error> {
  isLowBalance: boolean;
  threshold: number | undefined;
}

export function useWalletBalance(
  walletRef: string | undefined,
  options: UseWalletBalanceOptions = {},
): UseWalletBalanceResult {
  const astroid = useAstroidClient();
  const {
    enabled = true,
    refetchInterval = false,
    staleTime,
    assetCode,
    issuer,
    lowBalanceThreshold,
    onLowBalance,
  } = options;

  const query = useQuery<WalletBalance, Error>({
    queryKey: ['astroid', 'wallets', 'balance', walletRef ?? '', { assetCode, issuer }],
    queryFn: async () => {
      if (!walletRef) {
        throw new Error('Wallet reference is required');
      }
      const isPublicKey = walletRef.startsWith('G') && walletRef.length === 56;
      let resolvedId = walletRef;
      if (isPublicKey) {
        const wallet = await astroid.wallets.getByAddress(walletRef);
        resolvedId = wallet.id;
      }
      if (assetCode) {
        return astroid.wallets.getWalletBalances(resolvedId, { assetCode, issuer });
      }
      return astroid.wallets.balance(resolvedId);
    },
    enabled: Boolean(walletRef) && enabled,
    refetchInterval,
    staleTime,
  });

  let totalBalance = 0;
  if (query.data) {
    if (Array.isArray((query.data as any).balances)) {
      for (const b of (query.data as any).balances) {
        if (!assetCode || b.asset === assetCode) {
          totalBalance += parseFloat(b.balance ?? '0');
        }
      }
    } else if (typeof (query.data as any).balance === 'string') {
      totalBalance = parseFloat((query.data as any).balance);
    }
  }

  const isLowBalance =
    lowBalanceThreshold !== undefined &&
    query.data !== undefined &&
    totalBalance <= lowBalanceThreshold;

  const onLowBalanceRef = useRef(onLowBalance);
  useEffect(() => {
    onLowBalanceRef.current = onLowBalance;
  }, [onLowBalance]);

  const prevIsLowBalanceRef = useRef(false);
  useEffect(() => {
    if (isLowBalance && !prevIsLowBalanceRef.current && query.data && onLowBalanceRef.current) {
      onLowBalanceRef.current(query.data);
    }
    prevIsLowBalanceRef.current = isLowBalance;
  }, [isLowBalance, query.data]);

  return {
    ...query,
    isLowBalance,
    threshold: lowBalanceThreshold,
  };
}
