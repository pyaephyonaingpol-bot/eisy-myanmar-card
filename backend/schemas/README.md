# Users & Transactions schemas

Primary database for this app: **SQLite / LibSQL** (`backend/src/models/` + `backend/migrations/`).

Portable MongoDB / PostgreSQL contracts live under this folder for alternate deployments.

## Fields

### User
| Field | Type | Notes |
|-------|------|--------|
| `id` | integer / UUID / ObjectId | Primary key |
| `email` / `username` | string | At least one identity field |
| `balance` | number | Default `0`, ≥ 0 |
| `createdAt` | datetime | |
| `updatedAt` | datetime | |

### Transaction
| Field | Type | Notes |
|-------|------|--------|
| `id` | integer / UUID / ObjectId | Primary key |
| `userId` | FK | → User |
| `type` | enum | `deposit` \| `withdraw` |
| `amount` | number | Must be > 0 |
| `currency` | enum | `USDT` |
| `status` | enum | `pending` \| `completed` \| `rejected` |
| `txId` | string \| null | Optional manual / blockchain tracking id |
| `createdAt` | datetime | |

## Live app (SQLite / LibSQL)

| Piece | Path |
|-------|------|
| Migration | `backend/migrations/034_user_transactions.sql` |
| User model | `backend/src/models/User.js` (`toWalletPublic`) |
| Transaction model | `backend/src/models/Transaction.js` |

```js
const { User, Transaction } = require('./src/models');

const user = await User.findById(1);
User.toWalletPublic(user);
// { id, email, username, balance, createdAt, updatedAt }

await Transaction.create({
  userId: 1,
  type: 'deposit',
  amount: 50,
  currency: 'USDT',
  status: 'pending',
  txId: '0xabc…',
});
```

DB columns use snake_case (`user_id`, `tx_id`, `created_at`). Use `Transaction.toPublic(row)` for camelCase API shape.

> Existing wallet tables (`deposit_requests_v2`, `usdt_withdrawal_requests`, `transaction_logs`, …) remain the operational payment flows. `transactions` is the unified deposit/withdraw ledger model matching this contract.

## PostgreSQL

```bash
psql "$DATABASE_URL" -f backend/schemas/postgres/users_transactions.sql
```

## MongoDB (Mongoose)

```js
const { User, Transaction } = require('./schemas/mongodb/usersTransactions');

await User.create({ email: 'a@b.com', balance: 0 });
await Transaction.create({
  userId,
  type: 'deposit',
  amount: 50,
  currency: 'USDT',
  status: 'pending',
  txId: 'BP123…',
});
```

Atlas validators: `backend/schemas/mongodb/jsonSchema.js`.
