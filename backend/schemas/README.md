# Users & Transactions schemas

Minimal wallet ledger schemas for MongoDB and PostgreSQL.

## Fields

### Users
| Field | Type | Notes |
|-------|------|--------|
| `id` | UUID / ObjectId | Primary key |
| `balance` | number | Wallet balance ≥ 0 |

### Transactions
| Field | Type | Notes |
|-------|------|--------|
| `id` | UUID / ObjectId | Primary key |
| `userId` | FK / ObjectId | → Users |
| `type` | enum | `deposit` \| `withdraw` |
| `amount` | number | Must be > 0 |
| `status` | enum | `pending` \| `processing` \| `completed` \| `failed` \| `cancelled` |
| `txId` | string \| null | External id (Binance trade no, chain hash, …); unique when set |

## PostgreSQL

```bash
psql "$DATABASE_URL" -f backend/schemas/postgres/users_transactions.sql
```

## MongoDB (Mongoose)

```js
const { User, Transaction } = require('./schemas/mongodb/usersTransactions');

await User.create({ balance: 0 });
await Transaction.create({
  userId,
  type: 'deposit',
  amount: 50,
  status: 'pending',
  txId: 'BP123…',
});
```

Atlas collection validators: `backend/schemas/mongodb/jsonSchema.js`.

> Note: the live Eisy app currently uses SQLite/LibSQL (`users`, `transaction_logs`, deposit/withdrawal tables). These schemas are the portable User/Transaction contract for MongoDB or PostgreSQL deployments.
