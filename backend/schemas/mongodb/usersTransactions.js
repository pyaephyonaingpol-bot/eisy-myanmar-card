/**
 * MongoDB / Mongoose schemas: Users + Transactions
 *
 * Users:        { id, email, username, balance (default 0), createdAt, updatedAt }
 * Transactions: { id, userId, type: deposit|withdraw, amount, currency: USDT,
 *                 status: pending|completed|rejected, txId?, createdAt }
 *
 * Usage:
 *   const { User, Transaction } = require('./usersTransactions');
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const TRANSACTION_TYPES = ['deposit', 'withdraw'];
const TRANSACTION_STATUSES = ['pending', 'completed', 'rejected'];
const CURRENCIES = ['USDT'];

const UserSchema = new Schema(
  {
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      unique: true,
    },
    username: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
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

UserSchema.pre('validate', function ensureIdentity(next) {
  if (!this.email && !this.username) {
    next(new Error('User requires email or username'));
    return;
  }
  next();
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
      validate: {
        validator: (v) => Number.isFinite(v) && v > 0,
        message: 'amount must be a positive number',
      },
    },
    currency: {
      type: String,
      enum: CURRENCIES,
      required: true,
      default: 'USDT',
    },
    status: {
      type: String,
      enum: TRANSACTION_STATUSES,
      required: true,
      default: 'pending',
      index: true,
    },
    /** Optional external id (manual / blockchain / provider tracking) */
    txId: {
      type: String,
      default: null,
      sparse: true,
      unique: true,
      trim: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
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

TransactionSchema.virtual('id').get(function getId() {
  return this._id.toHexString();
});

TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ type: 1, status: 1 });

const User = mongoose.models.User || mongoose.model('User', UserSchema);
const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', TransactionSchema);

module.exports = {
  TRANSACTION_TYPES,
  TRANSACTION_STATUSES,
  CURRENCIES,
  UserSchema,
  TransactionSchema,
  User,
  Transaction,
};
