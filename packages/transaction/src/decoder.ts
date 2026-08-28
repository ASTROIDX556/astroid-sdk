import { TransactionBuilder, Transaction, FeeBumpTransaction, Asset } from '@stellar/stellar-base';
import { ValidationError } from '@astroid/errors';

export interface BaseOperation {
  type: string;
  sourceAccount?: string;
}

export interface PaymentOperation extends BaseOperation {
  type: 'payment';
  destination: string;
  asset: string;
  amount: string;
}

export interface PathPaymentStrictReceiveOperation extends BaseOperation {
  type: 'pathPaymentStrictReceive';
  sendAsset: string;
  sendMax: string;
  destination: string;
  destAsset: string;
  destAmount: string;
  path: string[];
}

export interface PathPaymentStrictSendOperation extends BaseOperation {
  type: 'pathPaymentStrictSend';
  sendAsset: string;
  sendAmount: string;
  destination: string;
  destAsset: string;
  destMin: string;
  path: string[];
}

export interface ManageDataOperation extends BaseOperation {
  type: 'manageData';
  name: string;
  value: string | null;
}

export interface ChangeTrustOperation extends BaseOperation {
  type: 'changeTrust';
  line: string;
  limit: string;
}

export interface CreateAccountOperation extends BaseOperation {
  type: 'createAccount';
  destination: string;
  startingBalance: string;
}

export interface AccountMergeOperation extends BaseOperation {
  type: 'accountMerge';
  destination: string;
}

export interface GenericOperation extends BaseOperation {
  type: string;
  details: Record<string, unknown>;
}

export type DecodedOperation =
  | PaymentOperation
  | PathPaymentStrictReceiveOperation
  | PathPaymentStrictSendOperation
  | ManageDataOperation
  | ChangeTrustOperation
  | CreateAccountOperation
  | AccountMergeOperation
  | GenericOperation;

export interface DecodedTxPayload {
  sourceAccount: string;
  sequenceNumber: string;
  fee: string;
  memo: {
    type: string;
    value: string | null;
  };
  operations: DecodedOperation[];
}

function formatAsset(asset: unknown): string {
  if (!asset) return 'unknown';
  if (asset instanceof Asset) {
    return asset.isNative() ? 'XLM' : `${asset.code}:${asset.issuer}`;
  }
  // In stellar-base, asset might be plain objects or instances
  const a = asset as { code?: string; issuer?: string };
  if (a.code && a.issuer) {
    return `${a.code}:${a.issuer}`;
  } else if (a.code === 'XLM' || (asset as any).type === 'native') {
    return 'XLM';
  }
  return String(asset);
}

function decodeOperation(op: any): DecodedOperation {
  const base: BaseOperation = {
    type: op.type,
    ...(op.source && { sourceAccount: op.source }),
  };

  switch (op.type) {
    case 'payment':
      return {
        ...base,
        type: 'payment',
        destination: op.destination,
        asset: formatAsset(op.asset),
        amount: String(op.amount),
      };
    case 'pathPaymentStrictReceive':
      return {
        ...base,
        type: 'pathPaymentStrictReceive',
        sendAsset: formatAsset(op.sendAsset),
        sendMax: String(op.sendMax),
        destination: op.destination,
        destAsset: formatAsset(op.destAsset),
        destAmount: String(op.destAmount),
        path: Array.isArray(op.path) ? op.path.map(formatAsset) : [],
      };
    case 'pathPaymentStrictSend':
      return {
        ...base,
        type: 'pathPaymentStrictSend',
        sendAsset: formatAsset(op.sendAsset),
        sendAmount: String(op.sendAmount),
        destination: op.destination,
        destAsset: formatAsset(op.destAsset),
        destMin: String(op.destMin),
        path: Array.isArray(op.path) ? op.path.map(formatAsset) : [],
      };
    case 'manageData':
      return {
        ...base,
        type: 'manageData',
        name: op.name,
        value: op.value ? Buffer.from(op.value).toString('base64') : null,
      };
    case 'changeTrust':
      return {
        ...base,
        type: 'changeTrust',
        line: formatAsset(op.line),
        limit: String(op.limit),
      };
    case 'createAccount':
      return {
        ...base,
        type: 'createAccount',
        destination: op.destination,
        startingBalance: String(op.startingBalance),
      };
    case 'accountMerge':
      return {
        ...base,
        type: 'accountMerge',
        destination: op.destination,
      };
    default: {
      const details: Record<string, unknown> = {};
      for (const key of Object.keys(op)) {
        if (key !== 'type' && key !== 'source') {
          details[key] = op[key];
        }
      }
      return {
        ...base,
        type: op.type,
        details,
      };
    }
  }
}

/**
 * Decodes a Stellar XDR transaction envelope into a structured, human-readable TypeScript object.
 *
 * @param xdr - Base64 encoded Stellar transaction envelope XDR.
 * @param networkPassphrase - Target network passphrase (e.g., 'Public Global Stellar Network ; September 2015').
 * @returns DecodedTxPayload containing extracted transaction details.
 * @throws ValidationError if the XDR is malformed or invalid.
 */
export function decodeTransactionXDR(xdr: string, networkPassphrase: string): DecodedTxPayload {
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch (err: unknown) {
    throw new ValidationError('Invalid transaction XDR', {
      code: 'VALIDATION_ERROR', // Assuming ApiErrorCode.VALIDATION_ERROR maps to 'VALIDATION_ERROR'
      cause: err,
    });
  }

  // Handle FeeBumpTransaction by decoding its inner transaction
  const innerTx = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;

  let memoValue: string | null = null;
  if (innerTx.memo && innerTx.memo.type !== 'none') {
    memoValue = innerTx.memo.value ? String(innerTx.memo.value) : null;
  }

  return {
    sourceAccount: innerTx.source,
    sequenceNumber: innerTx.sequence,
    fee: innerTx.fee,
    memo: {
      type: innerTx.memo ? innerTx.memo.type : 'none',
      value: memoValue,
    },
    operations: innerTx.operations.map(decodeOperation),
  };
}
