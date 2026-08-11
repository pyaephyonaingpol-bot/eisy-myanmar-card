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
      balance: {
        bsonType: ['double', 'int', 'long', 'decimal'],
        minimum: 0,
        description: 'Wallet balance — must be >= 0',
      },
      created_at: { bsonType: 'date' },
      updated_at: { bsonType: 'date' },
    },
  },
};

const transactionJsonSchema = {
  $jsonSchema: {
    bsonType: 'object',
    required: ['userId', 'type', 'amount', 'status'],
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
      status: {
        enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
        description: 'Lifecycle status',
      },
      txId: {
        bsonType: ['string', 'null'],
        description: 'External transaction / payment id',
      },
      created_at: { bsonType: 'date' },
      updated_at: { bsonType: 'date' },
    },
  },
};

module.exports = {
  userJsonSchema,
  transactionJsonSchema,
};
