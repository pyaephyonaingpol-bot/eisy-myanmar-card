/**
 * Plain JSON Schema (MongoDB Atlas / validation) for Users + Transactions.
 * Useful when not using Mongoose.
 */

const userJsonSchema = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['balance'],
    properties: {
      _id: { bsonType: 'objectId' },
      email: {
        bsonType: ['string', 'null'],
        description: 'User email (optional if username set)',
      },
      username: {
        bsonType: ['string', 'null'],
        description: 'Username (optional if email set)',
      },
      balance: {
        bsonType: ['double', 'int', 'long', 'decimal'],
        minimum: 0,
        description: 'Wallet balance — must be >= 0 (default 0)',
      },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
    },
  },
};

const transactionJsonSchema = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['userId', 'type', 'amount', 'currency', 'status'],
    properties: {
      _id: { bsonType: 'objectId' },
      userId: {
        bsonType: 'objectId',
        description: 'Reference to users._id',
      },
      type: {
        enum: ['deposit', 'withdraw'],
        description: 'Transaction type',
      },
      amount: {
        bsonType: ['double', 'int', 'long', 'decimal'],
        exclusiveMinimum: 0,
        description: 'Positive amount',
      },
      currency: {
        enum: ['USDT'],
        description: 'Currency (USDT)',
      },
      status: {
        enum: ['pending', 'completed', 'rejected'],
        description: 'Lifecycle status',
      },
      txId: {
        bsonType: ['string', 'null'],
        description: 'Optional manual / blockchain / provider tracking id',
      },
      createdAt: { bsonType: 'date' },
    },
  },
};

module.exports = {
  userJsonSchema,
  transactionJsonSchema,
};
