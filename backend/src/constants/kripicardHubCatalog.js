/**
 * Starter catalog for Kripicard Hub service categories.
 * Prices are USD base amounts before the flat $1 processing fee.
 */
'use strict';

const KRIPICARD_HUB_CATALOG = {
  sms: [
    {
      product_id: 'sms-us-10min',
      name: 'US SMS number · 10 minutes',
      description: 'Receive one verification SMS on a US number',
      price_usd: 0.8,
    },
    {
      product_id: 'sms-uk-10min',
      name: 'UK SMS number · 10 minutes',
      description: 'Receive one verification SMS on a UK number',
      price_usd: 1.2,
    },
    {
      product_id: 'sms-any-rental-1d',
      name: 'Any country SMS rental · 1 day',
      description: 'Rent a number for repeated SMS for 24 hours',
      price_usd: 4.5,
    },
  ],
  sim_topup: [
    {
      product_id: 'sim-topup-5',
      name: 'SIM Top-Up · $5',
      description: 'Mobile airtime credit equivalent to $5',
      price_usd: 5,
    },
    {
      product_id: 'sim-topup-10',
      name: 'SIM Top-Up · $10',
      description: 'Mobile airtime credit equivalent to $10',
      price_usd: 10,
    },
    {
      product_id: 'sim-topup-20',
      name: 'SIM Top-Up · $20',
      description: 'Mobile airtime credit equivalent to $20',
      price_usd: 20,
    },
  ],
  esim: [
    {
      product_id: 'esim-global-1gb-7d',
      name: 'Global eSIM · 1GB / 7 days',
      description: 'Travel data pack with QR activation',
      price_usd: 9,
    },
    {
      product_id: 'esim-us-5gb-30d',
      name: 'USA eSIM · 5GB / 30 days',
      description: 'US coverage data package',
      price_usd: 18,
    },
    {
      product_id: 'esim-eu-10gb-30d',
      name: 'Europe eSIM · 10GB / 30 days',
      description: 'Multi-country EU data package',
      price_usd: 28,
    },
  ],
  gift_cards: [
    {
      product_id: 'gift-itunes-10',
      name: 'App Store & iTunes · $10',
      description: 'Digital gift card code delivered by email',
      price_usd: 10,
    },
    {
      product_id: 'gift-amazon-25',
      name: 'Amazon · $25',
      description: 'Digital gift card code delivered by email',
      price_usd: 25,
    },
    {
      product_id: 'gift-google-play-15',
      name: 'Google Play · $15',
      description: 'Digital gift card code delivered by email',
      price_usd: 15,
    },
  ],
  social_media: [
    {
      product_id: 'social-ig-boost-1k',
      name: 'Instagram boost starter',
      description: 'Starter social engagement package',
      price_usd: 6,
    },
    {
      product_id: 'social-tt-boost-1k',
      name: 'TikTok boost starter',
      description: 'Starter social engagement package',
      price_usd: 7,
    },
    {
      product_id: 'social-x-boost-1k',
      name: 'X / Twitter boost starter',
      description: 'Starter social engagement package',
      price_usd: 5,
    },
  ],
  proxies: [
    {
      product_id: 'proxy-residential-1gb',
      name: 'Residential proxy · 1GB',
      description: 'Rotating residential bandwidth',
      price_usd: 8,
    },
    {
      product_id: 'proxy-datacenter-30d',
      name: 'Datacenter proxy · 30 days',
      description: 'Dedicated datacenter IP for 30 days',
      price_usd: 12,
    },
    {
      product_id: 'proxy-mobile-5gb',
      name: 'Mobile proxy · 5GB',
      description: 'Mobile carrier IP bandwidth',
      price_usd: 22,
    },
  ],
};

module.exports = {
  KRIPICARD_HUB_CATALOG,
};
