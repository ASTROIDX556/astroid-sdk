# @astroid/utils

Small, dependency-free helpers used across the Astroid SDK — and handy in your
own app code.

```ts
import { formatAsset, truncateMiddle, isStellarAddress, normalizePagination } from '@astroid/utils';

formatAsset('150', 'USDC');        // "150.00 USDC"
truncateMiddle('GABC…long…WXYZ');  // "GABC…WXYZ"
isStellarAddress('GABC...');       // true / false
normalizePagination({ limit: 999 }); // clamped to { page: 1, limit: 100 }
```

- **date** — `nowIso`, `parseDate`, `toIso`, `unixSeconds`, `isExpired`, `addSeconds`, `relativeTime`.
- **pagination** — `normalizePagination`, `buildPaginationMeta`, `hasNextPage`, `nextPage`.
- **format** — `formatAmount`, `formatAsset`, `truncateMiddle`, `formatPercent`.
- **asset** — `isNativeAsset`, `isValidAssetCode`, `assetIdentifier`, `parseAssetIdentifier`, `isStellarAddress`.
- **validation** — `isEmail`, `isPositiveAmount`, `isUuid`, `validateTransfer`, `assertDefined`.
