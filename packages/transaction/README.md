# @astroid/transaction

Transaction & proposal resource for the Astroid SDK — plus dependency-free
Stellar transaction builders for agent payment workflows.

## Payment builders

```ts
import { Account } from '@stellar/stellar-base';
import {
  buildPaymentTransaction,
  buildTransaction,
  encodeTransaction,
} from '@astroid/transaction';

// Native XLM transfer with a memo:
const tx = buildPaymentTransaction({
  source: account,                       // stellar-base Account (carries sequence)
  networkPassphrase: Networks.TESTNET,
  destination: 'G…',
  asset: 'XLM',
  amount: '10.5',
  memoText: 'reimburse',                 // ≤ 28 UTF-8 bytes
});

// Issued asset (CODE:ISSUER) with an explicit fee bid:
const usdcTx = buildPaymentTransaction({
  source: account,
  networkPassphrase: Networks.TESTNET,
  destination: 'G…',
  asset: `USDC:${issuer}`,
  amount: '25',
  fee: 500,
});

// Serialize to the base64 XDR envelope the Astroid API expects:
const xdr = encodeTransaction(tx);
```

- `buildPaymentTransaction(options)` — one `payment` operation; accepts `XLM`,
  a bare asset code, or `CODE:ISSUER`. Returns an **unsigned** transaction.
- `buildTransaction(options, operations)` — assemble any operation list.
- `encodeTransaction(tx | xdr)` — base64 XDR envelope (pass-through for strings).

## Fee bounds

Every builder enforces the Astroid transaction standards before constructing:

| Rule | Bound |
| --- | --- |
| Integer stroops | `fee` must be a non-negative integer |
| Network floor | `fee ≥ 100` stroops **per operation** (`MIN_BASE_FEE_STROOPS`) |
| Safety ceiling | `fee ≤ 10,000,000` stroops total (`MAX_TOTAL_FEE_STROOPS`) |
| Operation limit | at most 100 operations per transaction (`MAX_OPERATIONS`) |
| Memo | text memos ≤ 28 UTF-8 bytes (`MAX_MEMO_TEXT_BYTES`) |

Violations throw a structured `ValidationError` with a machine-readable
`code`: `INVALID_FEE`, `FEE_BELOW_MINIMUM`, `FEE_BID_TOO_HIGH`,
`TOO_MANY_OPERATIONS`, or `INVALID_MEMO`.

The default fee is `'100'` (single-operation network floor). Transactions come
back unsigned — sign locally (wallet package offline signer) and submit via the
transaction resource or `submit.ts`.
