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


## Transaction simulation (pre-flight)

Simulate a transaction **before** broadcasting it to avoid wasting fees on a
rejection. `simulateTransaction` accepts a built `Transaction`, a
`FeeBumpTransaction`, or a base64 XDR envelope, and never throws — every
failure comes back as a structured `viable: false` result:

```ts
import { simulateTransaction } from '@astroid/transaction';
const result = await simulateTransaction(unsignedTx, {
  networkPassphrase: Networks.TESTNET,
  client: astroid.http, // optional remote dry-run via /transactions/simulate
  horizonUrl: 'https://horizon-testnet.stellar.org', // optional live fee sample
});

if (!result.viable) {
  // result.errorCode / result.errorMessage / result.diagnostics explain why.
}
```

The remote simulation response is parsed into the typed views from
`@astroid/types` (`TransactionSimulationRemoteResult`,
`TransactionSimulationDiagnostics`, `TransactionResourceEstimate`,
`TransactionFeeBumpSuggestion`) — never returned raw:

- **Failed simulations** surface `result.diagnostics` with the Stellar result
  codes (`tx_failed`, per-operation codes), the failing operation index and any
  API-provided detail.
- **Fee-bump requirements** surface `result.feeBumpSuggestion`
  (`required`, `suggestedFee`, `suggestedBaseFee`, optional `suggestedFeeSource`
  and `reason`) and set `errorCode: 'FEE_BUMP_REQUIRED'`. A reported minimum
  fee above the envelope's current bid is treated the same way — it is never
  silently swallowed. Suggested amounts appear exactly as the backend reported
  them; nothing is invented when a field is missing.
- **Resource estimation anomalies** (partial, malformed or missing resource
  blocks) keep only the well-formed metrics on `result.resourceUsage` — missing
  fields are omitted rather than zero-filled — and a non-object API body
  returns `errorCode: 'MALFORMED_RESPONSE'` instead of crashing.

