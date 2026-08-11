/**
 * MongoDB / Mongoose schemas: Users + Transactions
 *
 * Users:        { id, balance }
 * Transactions: { userId, type: deposit|withdraw, amount, status, txId }
 *
 * Usage:
 *   const { User, Transaction } = require('./usersTransactions');
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const TRANSACTION_TYPES = ['deposit', 'withdraw'];
const TRANSACTION_STATUSES = ['pending', 'processing', 'completed', 'failed', 'cancelled'];

const UserSchema = new Schema(
  {
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'users',
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

UserSchema.virtual('id').get(function getId() {
  return this._id.toHexString();
});

const TransactionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: TRANSACTION_TYPES,
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: Number.MIN_VALUE,
      validate: {
        validator: (v) => Number.isFinite(v) && v > 0,
        message: 'amount must be a positive number',
      },
    },
    status: {
      type: String,
      enum: TRANSACTION_STATUSES,
      required: true,
      default: 'pending',
      index: true,
    },
    /** External provider reference (Binance merchantTradeNo, chain hash, bank ref, …) */
    txId: {
      type: String,
      default: null,
      sparse: true,
      unique: true,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'transactions',
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

TransactionSchema.index({ userId: 1, created_at: -1 });
TransactionSchema.index({ type: 1, status: 1 });

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', TransactionSchema);

module.exports = {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  UserSchema,
  TransactionSchema,
  User,
  Transaction,
};
