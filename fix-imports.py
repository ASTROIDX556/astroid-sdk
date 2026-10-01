import re

with open('packages/types/src/schemas.ts', 'r') as f:
    content = f.read()

import_block = """import type { Agent, Wallet, Transaction } from './entities.js';
import type { Policy, PolicySet, TransactionDetails } from './policy.js';
import type { Budget } from './budget.js';
import type { CreateTransactionInput, CreateAgentInput, CreatePolicyInput, CreateBudgetInput, TransferInput } from './dto.js';"""

content = re.sub(r"import type {\s*Agent,\s*Wallet,\s*Policy,\s*PolicySet,\s*TransactionDetails,\s*Budget,\s*Transaction,\s*CreateTransactionInput,\s*CreateAgentInput,\s*CreatePolicyInput,\s*CreateBudgetInput,\s*TransferInput,\s*} from '\./dto\.js';", import_block, content)

with open('packages/types/src/schemas.ts', 'w') as f:
    f.write(content)
