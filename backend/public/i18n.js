/**
 * Eisy Myanmar — lightweight i18n (English / Myanmar)
 * Usage: I18n.t('card_requests'), data-i18n="card_requests" on static elements
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'eisy_lang';
  const DEFAULT_LANG = 'en';
  const SUPPORTED = ['en', 'my'];

  const messages = {
    en: {
      // Language switcher
      lang_switcher_label: 'Select language',
      lang_my: '🇲🇲 မြန်မာ',
      lang_en: '🇬🇧 EN',

      brand_sub: 'Virtual Card Platform',

      nav_dashboard: 'Dashboard',
      nav_my_cards: 'My Cards',
      nav_deposits: 'Deposit & History',
      nav_p2p: 'P2P Express',
      nav_rates: 'Exchange Rates & Fees',
      nav_settings: 'Settings & Security',
      nav_admin_portal: 'Admin Portal',
      nav_user_app: 'User App',

      // Navigation — admin
      nav_admin_deposits: 'Deposits',
      nav_admin_cards: 'Cards',
      nav_admin_users: 'Users',
      nav_admin_transactions: 'Transactions',
      nav_admin_revenue: 'Revenue & Profit',
      nav_admin_support: 'Support',
      nav_admin_kyc: 'KYC Requests',
      nav_admin_settings: 'Rates & Fees',

      // Header / common
      header_signed_in_as: 'Signed in as',
      header_admin_panel: 'Admin control panel',
      header_mmk_wallet: 'MMK Wallet',
      header_usdt_wallet: 'USDT Wallet',
      header_mmk_wallet_hint: 'Cards, reloads & bank withdrawal · no MMK→USDT convert',
      account_menu: 'Account',
      account_security_heading: 'Account & security',
      wallet_actions_label: 'Wallet actions',
      btn_unlock_pin: 'Unlock PIN',
      btn_register_bio: 'Register Biometrics',
      btn_logout: 'Logout',
      btn_refresh: 'Refresh',
      btn_submit: 'Submit',
      btn_cancel: 'Cancel',
      btn_save: 'Save',
      btn_close: 'Close',
      btn_copy: 'Copy',
      btn_clear: 'Clear',
      btn_edit: 'Edit',
      btn_reject: 'Reject',
      btn_approve: 'Approve',
      btn_issue_card: 'Issue Card',
      btn_reload_card: 'Reload Card',
      btn_top_up_usdt: 'Top Up USDT',
      btn_sell_convert_usdt: 'Sell USDT / Convert to MMK',
      btn_withdraw_usdt: 'Withdraw USDT',
      btn_withdraw_mmk: 'Withdraw to Bank',
      withdraw_usdt_title: 'Withdraw USDT',
      withdraw_usdt_hint: 'Withdraw USDT to a crypto wallet, or convert at the platform rate and receive MMK in your bank account. MMK wallet → USDT exchange is not available.',
      withdraw_mmk_title: 'Withdraw MMK to Bank',
      withdraw_mmk_hint: 'Transfer your MMK wallet balance directly to your bank account. MMK cannot be converted to USDT inside the app.',
      withdraw_payout_method: 'Payout Method',
      withdraw_method_crypto: 'Crypto Wallet (USDT)',
      withdraw_method_bank: 'Bank Account (USDT → MMK)',
      withdraw_network: 'Network',
      withdraw_wallet_address: 'Destination Wallet Address',
      withdraw_bank_name: 'Bank Name',
      withdraw_account_name: 'Account Holder Name',
      withdraw_account_number: 'Account Number',
      withdraw_amount_usdt: 'Withdrawal Amount (USDT)',
      withdraw_amount_mmk: 'Withdrawal Amount (MMK)',
      withdraw_preview: 'Withdrawal Preview',
      withdraw_preview_method: 'Method',
      withdraw_preview_fee: 'Fee',
      withdraw_preview_net_usdt: 'Net USDT',
      withdraw_preview_mmk_payout: 'MMK to Bank',
      withdraw_preview_net_mmk: 'Net to Bank',
      btn_submit_withdraw: 'Submit Withdrawal Request',
      open_menu: 'Open menu',
      close_menu: 'Close menu',
      copied: 'Copied to clipboard!',
      loading: 'Loading…',
      dev_mode: 'Dev mode',

      // Rates
      current_rate: 'Current Rate',
      current_rate_loading: 'Current Rate: loading…',
      todays_exchange_rate: "Today's Exchange Rate",
      todays_rate: "Today's rate",

      // Wallet / home
      wallet_overview: 'Wallet Overview',
      pin_protected: 'PIN Protected',
      wallet_deposit: 'Wallet Deposit',
      issue_card: 'Issue Card',
      reload_card_action: 'Reload Card',
      quick_actions: 'Quick Actions',
      view_my_cards: 'View My Cards',
      make_deposit: 'Make a Deposit',
      view_rates_fees: 'View Rates & Fees',
      activity_log: 'Activity Log',
      active_requests: 'Active Requests',
      view_history: 'View History',
      active_requests_hint: 'Track card and deposit requests awaiting admin approval.',
      loading_requests: 'Loading requests…',
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      selected_card: 'Selected Card',
      card_status: 'Card Status',
      usdt_wallet_hint: 'TRC20 / BEP20 deposit · 1 USDT ≈ 1 USD to card (after fee)',
      nav_usdt_wallet: 'USDT Wallet',
      btn_manage_usdt_wallet: 'Manage Wallet',
      usdt_wallet_page_title: 'USDT Wallet',
      usdt_wallet_page_desc: 'View your platform balance, copy deposit addresses (TRC20 / BEP20 / ERC20), link external wallets, and track USDT activity.',
      usdt_wallet_balance_heading: 'Your USDT Balance',
      usdt_deposit_addresses: 'Deposit Addresses',
      usdt_deposit_addresses_hint: 'Send USDT to the platform address on your chosen network. Include your deposit reference in the memo if your wallet supports it.',
      usdt_link_external_wallet: 'Link External Wallet',
      usdt_link_external_hint: 'Save a personal TRC20, BEP20, or ERC20 address for withdrawals and optional on-chain balance checks.',
      network: 'Network',
      wallet_address: 'Wallet Address',
      label_optional: 'Label (optional)',
      link_wallet: 'Link Wallet',
      no_linked_wallets: 'No linked wallets yet.',
      usdt_transaction_history: 'USDT Transaction History',
      refresh: 'Refresh',
      usdt_available_balance: 'Available',
      usdt_locked_balance: 'Locked (Escrow)',
      usdt_total_balance: 'Total',
      usdt_escrow_holds: 'Active Escrow Holds',
      usdt_escrow_holds_hint: 'USDT locked during active P2P trades. Released to the buyer when the trade completes, or returned to you if cancelled.',
      usdt_internal_transfer: 'Send USDT to Another User',
      usdt_internal_transfer_hint: 'Instant internal transfer from your available USDT balance. The recipient must have an Eisy Myanmar account.',
      recipient_email: 'Recipient email',
      amount_usdt: 'Amount (USDT)',
      note_optional: 'Note (optional)',
      send_usdt: 'Send USDT',

      // Cards page
      cards_page_desc: 'View card status, reveal details when needed, and reload your virtual cards.',
      your_virtual_cards: 'Your Virtual Cards',
      prev_card: '‹ Prev',
      next_card: 'Next ›',
      apply_new_card: 'Apply for New Card',
      apply_new_card_hint: 'Pay from your MMK or USDT wallet, or via KBZPay/WavePay manual deposit. Wallet payments are held until an admin issues your card (usually 15–30 mins).',
      initial_card_load: 'Initial Card Load Amount (USD)',
      min_initial_deposit: 'Minimum initial deposit: $10.00',
      pay_from: 'Pay From',
      pay_mmk_wallet_issuance: 'MMK Wallet — card issuance (admin processed)',
      pay_usdt_wallet_issuance: 'USDT Wallet (1 USDT ≈ 1 USD, admin processed)',
      pay_kbzpay: 'KBZPay (Manual Deposit)',
      pay_wavepay: 'WavePay (Manual Deposit)',
      pay_mmk_wallet_reload: 'MMK Wallet — card reloads only (instant)',
      pay_usdt_wallet_reload: 'USDT Wallet (Instant — 1:1 USD)',
      initial_card_load_row: 'Initial Card Load',
      card_issuance_fee: '+ Card Issuance Fee',
      total_usd_required: '= Total USD Required',
      total_payable_mmk: 'Total Payable (MMK)',
      total_payable_usdt: 'Total Payable (USDT)',
      submit_card_request: 'Submit Card Request',
      virtual_card: 'Virtual Card',
      status: 'Status',
      show_card_details: 'Show Card Details',
      top_up_card: 'Top Up Card',
      top_up_reload_card: 'Top Up / Reload Card',
      card_pending_notice: 'This card request is pending admin approval. You\'ll receive your card number once issued.',
      card_reload_history: 'Card Reload History',
      card_reload_history_hint: 'Top-up requests to your virtual card — wallet funds are held until admin approves.',
      loading_reload_history: 'Loading reload history…',
      copy_card_number: 'Copy Card Number',
      copy_all_details: 'Copy All Details',
      holder: 'HOLDER',
      exp: 'EXP',
      cvv: 'CVV',

      // Deposits page
      deposits_page_title: 'Deposit & Reload History',
      deposits_page_desc: 'Reload a virtual card or top up your MMK wallet (for card issuance & reloads only) via KBZPay/WavePay.',
      reload_topup_card: 'Reload / Top-Up Card',
      reload_topup_hint: 'Select a card and pay from your wallet. Funds are deducted immediately and held until admin approves the reload.',
      start_card_reload: 'Start Card Reload',
      top_up_wallet: 'Top Up Wallet',
      deposit_tab_mmk: 'MMK — KPay / WavePay',
      deposit_tab_usdt: 'USDT — TRC20 / BEP20',
      mmk_wallet_restriction: 'MMK wallet is for cards, reloads, and bank withdrawals only. MMK → USDT conversion is not available.',
      deposit_mmk_hint: 'Top up via KBZPay or WavePay. Upload transaction proof & TxID after payment.',
      amount_mmk: 'Amount (MMK)',
      method: 'Method',
      generate_ref_deposit: 'Generate Ref Code & Deposit',

      // Modal — reload
      reload_modal_title: 'Reload / Top-Up Card',
      reload_modal_hint: 'Pay via KBZPay/WavePay — funds are converted at today\'s rate and added to your selected card after admin approval.',
      target_card: 'Target Card',
      select_active_card: '— Select an active card —',
      only_active_cards: 'Only active cards are shown.',
      topup_amount_mmk: 'Top-Up Amount (MMK)',
      topup_amount_usdt: 'Top-Up Amount (USDT)',
      reload_min_mmk_hint: 'Minimum top-up: 10,000 MMK — $3.50 USD service fee added on top',
      reload_min_usdt_hint: 'Minimum top-up: $5.00 USDT — $3.50 USD service fee added on top',

      // Admin — deposits
      wallet_deposit_requests: 'Wallet Deposit Requests',
      all_statuses: 'All statuses',
      pending_review: 'Pending review',
      verified: 'Verified',
      rejected: 'Rejected',
      loading_deposits: 'Loading deposits…',
      p2p_disputes: 'P2P Disputes — Needs Review',
      p2p_disputes_hint: 'Users flagged orders with payment proof. Force-release USDT or refund escrow after review.',
      loading_disputes: 'Loading disputes…',

      // Admin — cards
      virtual_card_management: 'Virtual Card Management',
      virtual_card_mgmt_hint: 'Approve card applications and reload requests — no per-transaction spending management.',
      card_requests: 'Card Requests',
      card_requests_hint: 'Pending applications awaiting manual card details from admin.',
      loading_card_requests: 'Loading card requests…',
      issue_update_card: 'Issue / Update Card',
      issue_update_card_hint: 'Issue a new card manually or edit an existing issued card — click Edit in the table below to pre-fill this form.',
      user_id: 'User ID',
      card_id: 'Card ID',
      card_id_placeholder: 'Leave empty to issue new',
      card_number: 'Card Number',
      expiry: 'Expiry (MM/YY)',
      admin_notes: 'Admin Notes',
      admin_notes_placeholder: 'Optional internal note',
      clear_form: 'Clear Form',
      save_changes_update: 'Save Changes / Update Card',
      issued_cards_status: 'Issued Cards — Status Control',
      issued_cards_hint: 'Update lifecycle status for issued virtual cards. Optional reason is shown to the user when suspended or frozen.',
      loading_issued_cards: 'Loading issued cards…',
      card_reload_requests: 'Card Reload Requests',
      card_reload_requests_hint: 'Wallet funds were deducted when the user submitted — approve to credit the card or reject to refund.',
      loading_reload_requests: 'Loading reload requests…',
      no_pending_card_requests: 'No pending card requests.',
      no_pending_reloads: 'No pending card reload requests.',
      no_issued_cards: 'No issued virtual cards yet.',

      // Status labels
      pending_approval: 'Pending Approval',
      pending_issuance: 'PENDING_ISSUANCE',
      active: 'ACTIVE',
      suspended: 'SUSPENDED',
      frozen: 'FROZEN',
      terminated: 'TERMINATED',
      pending: 'Pending',

      // Card wallet hints
      card_wallet_ok_mmk: 'MMK wallet sufficient — {{available}} available ({{required}} required). Card request will be processed by Admin shortly (usually within 15-30 mins).',
      card_wallet_err_mmk: 'Insufficient MMK wallet. Need {{required}}, you have {{available}}. Top up first.',
      card_wallet_ok_usdt: 'USDT wallet sufficient — {{available}} available ({{required}} required). Card request will be processed by Admin shortly (usually within 15-30 mins).',
      card_wallet_err_usdt: 'Insufficient USDT wallet. Need {{required}}, you have {{available}}. Top up first.',
      card_request_submitted: 'Card request submitted!',
      card_request_submitted_log: 'Card request submitted — {{amount}} deducted, pending admin issuance',
      card_request_pending_msg: 'Card request will be processed by Admin shortly (usually within 15-30 mins).',
      card_request_deducted: '{{amount}} deducted from your wallet.',

      // Settings
      settings_security: 'Settings & Security',
      kyc_verification: 'KYC Verification',
      identity_status: 'Identity status:',
      kyc_hint: 'Required to post P2P ads and trade on the marketplace.',
      complete_kyc: 'Complete KYC',
      account: 'Account',
      support: 'Support',
      subject: 'Subject',
      message: 'Message',
      open_support_ticket: 'Open Support Ticket',

      // Table headers
      th_id: 'ID',
      th_user: 'User',
      th_status: 'Status',
      th_holder: 'Holder',
      th_pricing: 'Pricing',
      th_deposit_ref: 'Deposit Ref',
      th_requested: 'Requested',
      th_actions: 'Actions',
      th_amount: 'Amount',
      th_date: 'Date',
      th_card: 'Card',
      th_type: 'Type',
      th_description: 'Description',

      // Auth
      sign_in: 'Sign In',
      register: 'Register',
      send_otp: 'Send OTP',
      verify_pin: 'Verify PIN',
      forgot_pin: 'Forgot PIN / Reset to 123456',
    },
    my: {
      lang_switcher_label: 'ဘာသာစကား ရွေးချယ်ရန်',
      lang_my: '🇲🇲 မြန်မာ',
      lang_en: '🇬🇧 EN',

      brand_sub: 'ဒစ်ဂျစ်တယ်ကတ် ပလက်ဖောင်း',

      nav_dashboard: 'ပင်မစာမျက်နှာ',
      nav_my_cards: 'ကျွန်ုပ်၏ကတ်များ',
      nav_deposits: 'ငွေသွင်းနှင့် မှတ်တမ်း',
      nav_p2p: 'P2P Express',
      nav_rates: 'ငွေလဲနှုန်းနှင့် ဝန်ဆောင်ခ',
      nav_settings: 'ဆက်တင်နှင့် လုံခြုံရေး',
      nav_admin_portal: 'အက်ဒ်မင် ပေါ်တယ်',
      nav_user_app: 'အသုံးပြုသူ အက်ပ်',

      nav_admin_deposits: 'ငွေသွင်းမှုများ',
      nav_admin_cards: 'ကတ်များ',
      nav_admin_users: 'အသုံးပြုသူများ',
      nav_admin_transactions: 'ငွေလွှဲမှတ်တမ်း',
      nav_admin_revenue: 'ဝင်ငွေနှင့် အမြတ်',
      nav_admin_support: 'အကူအညီ',
      nav_admin_kyc: 'KYC တောင်းဆိုမှုများ',
      nav_admin_settings: 'ငွေလဲနှုန်းနှင့် ဝန်ဆောင်ခ',

      header_signed_in_as: 'ဝင်ရောက်ထားသူ',
      header_admin_panel: 'အက်ဒ်မင် ထိန်းချုပ်မှု',
      header_mmk_wallet: 'MMK ပိုက်ဆံအိတ်',
      header_usdt_wallet: 'USDT ပိုက်ဆံအိတ်',
      header_mmk_wallet_hint: 'ကတ်၊ ငွေဖြည့်နှင့် ဘဏ်ငွေထုတ် · MMK→USDT လဲလှယ်မရ',
      account_menu: 'အကောင့်',
      account_security_heading: 'အကောင့်နှင့် လုံခြုံရေး',
      wallet_actions_label: 'ပိုက်ဆံအိတ် လုပ်ဆောင်ချက်များ',
      btn_unlock_pin: 'PIN ဖွင့်ရန်',
      btn_register_bio: 'ဇီဝမက်ထရစ် မှတ်ပုံတင်ရန်',
      btn_logout: 'ထွက်ရန်',
      btn_refresh: 'ပြန်တင်ရန်',
      btn_submit: 'တင်သွင်းမည်',
      btn_cancel: 'ပယ်ဖျက်မည်',
      btn_save: 'သိမ်းမည်',
      btn_close: 'ပိတ်မည်',
      btn_copy: 'ကူးယူမည်',
      btn_clear: 'ရှင်းမည်',
      btn_edit: 'ပြင်ဆင်မည်',
      btn_reject: 'ငြင်းပယ်မည်',
      btn_approve: 'အတည်ပြုမည်',
      btn_issue_card: 'ကတ်ထုတ်ပေးမည်',
      btn_reload_card: 'ကတ်ငွေဖြည့်မည်',
      btn_top_up_usdt: 'USDT ငွေဖြည့်မည်',
      btn_sell_convert_usdt: 'USDT ရောင်းမည် / MMK သို့လဲမည်',
      btn_withdraw_usdt: 'USDT ငွေထုတ်မည်',
      btn_withdraw_mmk: 'ဘဏ်သို့ ငွေထုတ်မည်',
      withdraw_usdt_title: 'USDT ငွေထုတ်ရန်',
      withdraw_usdt_hint: 'USDT ကို crypto wallet သို့ ထုတ်နိုင်သည် သို့မဟုတ် ပလက်ဖောင်းနှုန်းဖြင့် MMK အဖြစ် ဘဏ်အကောင့်သို့ လက်ခံနိုင်သည်။ App အတွင်း MMK → USDT လဲလှယ်မရပါ။',
      withdraw_mmk_title: 'MMK ကို ဘဏ်သို့ ငွေထုတ်ရန်',
      withdraw_mmk_hint: 'MMK ပိုက်ဆံအိတ်မှ တိုက်ရိုက် ဘဏ်အကောင့်သို့ ထုတ်နိုင်သည်။ App အတွင်း MMK ကို USDT သို့ မလဲနိုင်ပါ။',
      withdraw_payout_method: 'ငွေထုတ်နည်းလမ်း',
      withdraw_method_crypto: 'Crypto Wallet (USDT)',
      withdraw_method_bank: 'ဘဏ်အကောင့် (USDT → MMK)',
      withdraw_network: 'ကွန်ရက်',
      withdraw_wallet_address: 'လက်ခံမည့် Wallet လိပ်စာ',
      withdraw_bank_name: 'ဘဏ်အမည်',
      withdraw_account_name: 'အကောင့်ပိုင်ရှင်အမည်',
      withdraw_account_number: 'အကောင့်နံပါတ်',
      withdraw_amount_usdt: 'ထုတ်မည့်ပမာဏ (USDT)',
      withdraw_amount_mmk: 'ထုတ်မည့်ပမာဏ (MMK)',
      withdraw_preview: 'ငွေထုတ် အနှစ်ချုပ်',
      withdraw_preview_method: 'နည်းလမ်း',
      withdraw_preview_fee: 'ဝန်ဆောင်ခ',
      withdraw_preview_net_usdt: 'ရရှိမည့် USDT',
      withdraw_preview_mmk_payout: 'ဘဏ်သို့ MMK',
      withdraw_preview_net_mmk: 'ဘဏ်သို့ ရောက်မည့်ငွေ',
      btn_submit_withdraw: 'ငွေထုတ် တောင်းဆိုမည်',
      open_menu: 'မီနူးဖွင့်ရန်',
      close_menu: 'မီနူးပိတ်ရန်',
      copied: 'ကလစ်ဘုတ်သို့ ကူးယူပြီးပါပြီ!',
      loading: 'တင်နေသည်…',
      dev_mode: 'Dev mode',

      current_rate: 'လက်ရှိ ပေါက်ဈေး',
      current_rate_loading: 'လက်ရှိ ပေါက်ဈေး — တင်နေသည်…',
      todays_exchange_rate: 'ယနေ့ ငွေလဲနှုန်း',
      todays_rate: 'ယနေ့နှုန်း',

      wallet_overview: 'ပိုက်ဆံအိတ် အနှစ်ချုပ်',
      pin_protected: 'PIN ကာကွယ်ထားသည်',
      wallet_deposit: 'ပိုက်ဆံအိတ် ငွေသွင်းရန်',
      issue_card: 'ကတ်လျှောက်မည်',
      reload_card_action: 'ကတ်ငွေဖြည့်မည်',
      quick_actions: 'အမြန်လုပ်ဆောင်ချက်များ',
      view_my_cards: 'ကျွန်ုပ်၏ကတ်များ',
      make_deposit: 'ငွေသွင်းမည်',
      view_rates_fees: 'ငွေလဲနှုန်းနှင့် ဝန်ဆောင်ခ',
      activity_log: 'လုပ်ဆောင်ချက် မှတ်တမ်း',
      active_requests: 'ဆောင်ရွက်ဆဲ တောင်းဆိုမှုများ',
      view_history: 'မှတ်တမ်းကြည့်ရန်',
      active_requests_hint: 'အက်ဒ်မင် အတည်ပြုရန် စောင့်နေသော ကတ်နှင့် ငွေသွင်း တောင်းဆိုမှုများ။',
      loading_requests: 'တောင်းဆိုမှုများ တင်နေသည်…',
      name: 'အမည်',
      email: 'အီးမေးလ်',
      phone: 'ဖုန်း',
      selected_card: 'ရွေးထားသောကတ်',
      card_status: 'ကတ်အခြေအနေ',
      usdt_wallet_hint: 'TRC20 / BEP20 ငွေသွင်း · 1 USDT ≈ 1 USD (ဝန်ဆောင်ခ နှုတ်ပြီး)',
      nav_usdt_wallet: 'USDT ပိုက်ဆံအိတ်',
      btn_manage_usdt_wallet: 'ပိုက်ဆံအိတ် စီမံရန်',
      usdt_wallet_page_title: 'USDT ပိုက်ဆံအိတ်',
      usdt_wallet_page_desc: 'လက်ကျန်ငွေကြည့်ရန်၊ ငွေသွင်းလိပ်စာ (TRC20 / BEP20 / ERC20) ကူးယူရန်၊ ပြင်ပ wallet ချိတ်ရန်နှင့် USDT မှတ်တမ်းကြည့်ရန်။',
      usdt_wallet_balance_heading: 'သင့် USDT လက်ကျန်ငွေ',
      usdt_deposit_addresses: 'ငွေသွင်း လိပ်စာများ',
      usdt_deposit_addresses_hint: 'ရွေးထားသော ကွန်ရက်ပေါ်ရှိ ပလက်ဖောင်းလိပ်စာသို့ USDT ပို့ပါ။ Wallet က memo ပံ့ပိုးပါက ငွေသွင်းအကိုးအကားကို ထည့်ပါ။',
      usdt_link_external_wallet: 'ပြင်ပ Wallet ချိတ်ဆက်ရန်',
      usdt_link_external_hint: 'ငွေထုတ်နှင့် လက်ကျန်စစ်ဆေးရန် သင့် TRC20၊ BEP20 သို့မဟုတ် ERC20 လိပ်စာကို သိမ်းပါ။',
      network: 'ကွန်ရက်',
      wallet_address: 'Wallet လိပ်စာ',
      label_optional: 'အမည်တပ်ရန် (မထည့်လည်းရ)',
      link_wallet: 'Wallet ချိတ်ဆက်မည်',
      no_linked_wallets: 'ချိတ်ဆက်ထားသော wallet မရှိသေးပါ။',
      usdt_transaction_history: 'USDT ငွေလွှဲမှတ်တမ်း',
      refresh: 'ပြန်တင်ရန်',
      usdt_available_balance: 'သုံးနိုင်ငွေ',
      usdt_locked_balance: 'လော့ခ်ထားငွေ (Escrow)',
      usdt_total_balance: 'စုစုပေါင်း',
      usdt_escrow_holds: 'ဆောင်ရွက်ဆဲ Escrow',
      usdt_escrow_holds_hint: 'P2P ကုန်သွယ်မှုအတွင်း ယာယီလော့ခ်ထားသော USDT။ အရောင်းအဝယ်ပြီးပါက ဝယ်သူထံ လွှဲပေးမည်၊ ပယ်ဖျက်ပါက သင့်ထံ ပြန်ရမည်။',
      usdt_internal_transfer: 'အခြားအသုံးပြုသူထံ USDT ပို့ရန်',
      usdt_internal_transfer_hint: 'သုံးနိုင်သော USDT မှ ချက်ချင်း အတွင်းပို့ဆောင်မှု။ လက်ခံသူတွင် Eisy Myanmar အကောင့်ရှိရမည်။',
      recipient_email: 'လက်ခံသူ အီးမေးလ်',
      amount_usdt: 'ပမာဏ (USDT)',
      note_optional: 'မှတ်ချက် (မထည့်လည်းရ)',
      send_usdt: 'USDT ပို့မည်',

      cards_page_desc: 'ကတ်အခြေအနေကြည့်ရန်၊ လိုအပ်သည့်အခါ အသေးစိတ်ဖော်ပြရန်နှင့် ဒစ်ဂျစ်တယ်ကတ်များသို့ ငွေဖြည့်ရန်။',
      your_virtual_cards: 'သင့် ဒစ်ဂျစ်တယ်ကတ်များ',
      prev_card: '‹ ယခင်',
      next_card: 'နောက် ›',
      apply_new_card: 'ကတ်အသစ် လျှောက်ရန်',
      apply_new_card_hint: 'MMK သို့မဟုတ် USDT ပိုက်ဆံအိတ်မှ ပေးချေနိုင်သည်၊ သို့မဟုတ် KBZPay / WavePay ဖြင့် ကိုယ်တိုင်ငွေသွင်းနိုင်သည်။ ပိုက်ဆံအိတ်မှ ပေးချေပါက အက်ဒ်မင်က ကတ်ထုတ်ပေးသည်အထိ ယာယီထိန်းသိမ်းထားမည် (ပုံမှန် ၁၅–၃၀ မိနစ်)။',
      initial_card_load: 'ကတ်အစ ငွေဖြည့်ပမာဏ (USD)',
      min_initial_deposit: 'အနည်းဆုံး အစငွေဖြည့် — $10.00',
      pay_from: 'ပေးချေမည့်နေရာ',
      pay_mmk_wallet_issuance: 'MMK ပိုက်ဆံအိတ် — ကတ်ထုတ်ပေးခြင်း (အက်ဒ်မင် ဆောင်ရွက်မည်)',
      pay_usdt_wallet_issuance: 'USDT ပိုက်ဆံအိတ် (1 USDT ≈ 1 USD၊ အက်ဒ်မင် ဆောင်ရွက်မည်)',
      pay_kbzpay: 'KBZPay (ကိုယ်တိုင် ငွေသွင်း)',
      pay_wavepay: 'WavePay (ကိုယ်တိုင် ငွေသွင်း)',
      pay_mmk_wallet_reload: 'MMK ပိုက်ဆံအိတ် — ကတ်ငွေဖြည့်သာ (ချက်ချင်း)',
      pay_usdt_wallet_reload: 'USDT ပိုက်ဆံအိတ် (ချက်ချင်း — 1:1 USD)',
      initial_card_load_row: 'ကတ်အစ ငွေဖြည့်',
      card_issuance_fee: '+ ကတ်ထုတ်ပေးခ',
      total_usd_required: '= စုစုပေါင်း USD',
      total_payable_mmk: 'ပေးချေရမည့် စုစုပေါင်း (MMK)',
      total_payable_usdt: 'ပေးချေရမည့် စုစုပေါင်း (USDT)',
      submit_card_request: 'ကတ်လျှောက်လွှာ တင်သွင်းမည်',
      virtual_card: 'ဒစ်ဂျစ်တယ်ကတ်',
      status: 'အခြေအနေ',
      show_card_details: 'ကတ်အသေးစိတ် ပြမည်',
      top_up_card: 'ကတ်ငွေဖြည့်မည်',
      top_up_reload_card: 'ကတ်ငွေဖြည့်မည်',
      card_pending_notice: 'ဤကတ်လျှောက်လွှာကို အက်ဒ်မင် အတည်ပြုရန် စောင့်နေပါသည်။ ထုတ်ပေးပြီးပါက ကတ်နံပါတ် ရရှိမည်။',
      card_reload_history: 'ကတ်ငွေဖြည့် မှတ်တမ်း',
      card_reload_history_hint: 'ဒစ်ဂျစ်တယ်ကတ်သို့ ငွေဖြည့် တောင်းဆိုမှုများ — အက်ဒ်မင် အတည်ပြုသည်အထိ ပိုက်ဆံအိတ်မှ ငွေကို ယာယီထိန်းသိမ်းထားမည်။',
      loading_reload_history: 'ငွေဖြည့်မှတ်တမ်း တင်နေသည်…',
      copy_card_number: 'ကတ်နံပါတ် ကူးယူမည်',
      copy_all_details: 'အသေးစိတ်အားလုံး ကူးယူမည်',
      holder: 'HOLDER',
      exp: 'EXP',
      cvv: 'CVV',

      deposits_page_title: 'ငွေသွင်းနှင့် ငွေဖြည့်မှတ်တမ်း',
      deposits_page_desc: 'ဒစ်ဂျစ်တယ်ကတ် ငွေဖြည့်ရန် သို့မဟုတ် MMK ပိုက်ဆံအိတ် (ကတ်ထုတ်ပေးခြင်းနှင့် ငွေဖြည့်အတွက်သာ) ကို KBZPay / WavePay ဖြင့် ငွေသွင်းပါ။',
      reload_topup_card: 'ကတ်ငွေဖြည့်ရန်',
      reload_topup_hint: 'ကတ်ရွေးပြီး ပိုက်ဆံအိတ်မှ ပေးချေပါ။ အက်ဒ်မင် အတည်ပြုသည်အထိ ငွေကို ချက်ချင်းနှုတ်၍ ယာယီထိန်းသိမ်းထားမည်။',
      start_card_reload: 'ကတ်ငွေဖြည့် စတင်မည်',
      top_up_wallet: 'ပိုက်ဆံအိတ် ငွေဖြည့်မည်',
      deposit_tab_mmk: 'MMK — KBZPay / WavePay',
      deposit_tab_usdt: 'USDT — TRC20 / BEP20',
      mmk_wallet_restriction: 'MMK ပိုက်ဆံအိတ်သည် ကတ်၊ ငွေဖြည့်နှင့် ဘဏ်ငွေထုတ်အတွက်သာ။ MMK → USDT လဲလှယ်မရပါ။',
      deposit_mmk_hint: 'KBZPay သို့မဟုတ် WavePay ဖြင့် ငွေသွင်းပါ။ ပေးချေပြီးနောက် အထောက်အထားနှင့် TxID တင်ပါ။',
      amount_mmk: 'ပမာဏ (MMK)',
      method: 'နည်းလမ်း',
      generate_ref_deposit: 'ကိုးကားကုဒ် ထုတ်၍ ငွေသွင်းမည်',

      reload_modal_title: 'ကတ်ငွေဖြည့်ရန်',
      reload_modal_hint: 'KBZPay / WavePay ဖြင့် ပေးချေပါ — ယနေ့နှုန်းဖြင့် လဲလှယ်ပြီး အက်ဒ်မင် အတည်ပြုပြီးနောက် ရွေးထားသောကတ်သို့ ထည့်မည်။',
      target_card: 'ငွေဖြည့်မည့်ကတ်',
      select_active_card: '— အသုံးပြုနိုင်သော ကတ်ရွေးပါ —',
      only_active_cards: 'အသုံးပြုနိုင်သော ကတ်များသာ ပြသထားသည်။',
      topup_amount_mmk: 'ငွေဖြည့်ပမာဏ (MMK)',
      topup_amount_usdt: 'ငွေဖြည့်ပမာဏ (USDT)',
      reload_min_mmk_hint: 'အနည်းဆုံး ငွေဖြည့် — 10,000 MMK (ဝန်ဆောင်ခ $3.50 USD ထပ်ပေါင်းမည်)',
      reload_min_usdt_hint: 'အနည်းဆုံး ငွေဖြည့် — $5.00 USDT (ဝန်ဆောင်ခ $3.50 USD ထပ်ပေါင်းမည်)',

      wallet_deposit_requests: 'ပိုက်ဆံအိတ် ငွေသွင်း တောင်းဆိုမှုများ',
      all_statuses: 'အခြေအနေအားလုံး',
      pending_review: 'စစ်ဆေးဆဲ',
      verified: 'အတည်ပြုပြီး',
      rejected: 'ငြင်းပယ်ပြီး',
      loading_deposits: 'ငွေသွင်းမှုများ တင်နေသည်…',
      p2p_disputes: 'P2P အငြင်းပွားမှုများ — စစ်ဆေးရန်',
      p2p_disputes_hint: 'အသုံးပြုသူများက ငွေပေးချေ အထောက်အထားဖြင့် အမှတ်အသားပြုထားသော အော်ဒါများ။ စစ်ဆေးပြီးနောက် USDT ကို အတင်းလွှဲပေးခြင်း သို့မဟုတ် escrow ပြန်အမ်းခြင်း။',
      loading_disputes: 'အငြင်းပွားမှုများ တင်နေသည်…',

      virtual_card_management: 'ဒစ်ဂျစ်တယ်ကတ် စီမံခန့်ခွဲမှု',
      virtual_card_mgmt_hint: 'ကတ်လျှောက်လွှာနှင့် ငွေဖြည့် တောင်းဆိုမှုများကို အတည်ပြုပါ — ငွေသုံးစွဲမှု တစ်ခုချင်းစီကို စီမံမည်မဟုတ်ပါ။',
      card_requests: 'ကတ် လျှောက်လွှာများ',
      card_requests_hint: 'အက်ဒ်မင်မှ ကတ်အသေးစိတ် ထည့်သွင်းရန် စောင့်နေသော လျှောက်လွှာများ။',
      loading_card_requests: 'ကတ်လျှောက်လွှာများ တင်နေသည်…',
      issue_update_card: 'ကတ်ထုတ်ပေး / ပြင်ဆင်ရန်',
      issue_update_card_hint: 'ကတ်အသစ်ကို ကိုယ်တိုင် ထုတ်ပေးနိုင်သည် သို့မဟုတ် ထုတ်ပြီးသား ကတ်ကို ပြင်နိုင်သည် — အောက်ဇယားရှိ ပြင်ဆင်မည် ကိုနှိပ်၍ ဖောင်ကို အလိုအလျောက် ဖြည့်ပါ။',
      user_id: 'အသုံးပြုသူ ID',
      card_id: 'ကတ် ID',
      card_id_placeholder: 'ကတ်အသစ်ထုတ်ရန် ဗလာထားပါ',
      card_number: 'ကတ်နံပါတ်',
      expiry: 'သက်တမ်းကုန် (MM/YY)',
      admin_notes: 'အက်ဒ်မင် မှတ်ချက်',
      admin_notes_placeholder: 'အတွင်းပိုင်း မှတ်ချက် (မထည့်လည်းရ)',
      clear_form: 'ဖောင်ရှင်းမည်',
      save_changes_update: 'ပြောင်းလဲမှု သိမ်း / ကတ် အပ်ဒိတ်',
      issued_cards_status: 'ထုတ်ပြီးကတ်များ — အခြေအနေ ထိန်းချုပ်မှု',
      issued_cards_hint: 'ထုတ်ပြီး ဒစ်ဂျစ်တယ်ကတ်များ၏ အခြေအနေကို ပြောင်းနိုင်သည်။ ရပ်ဆိုင်း/အေးခဲထားပါက အကြောင်းရင်းကို အသုံးပြုသူအား ပြသမည်။',
      loading_issued_cards: 'ထုတ်ပြီးကတ်များ တင်နေသည်…',
      card_reload_requests: 'ကတ်ငွေဖြည့် တောင်းဆိုမှုများ',
      card_reload_requests_hint: 'တင်သွင်းချိန်တွင် ပိုက်ဆံအိတ်မှ ငွေနှုတ်ပြီးသား — အတည်ပြုပါက ကတ်သို့ ထည့်မည်၊ ငြင်းပယ်ပါက ပြန်အမ်းမည်။',
      loading_reload_requests: 'ငွေဖြည့် တောင်းဆိုမှုများ တင်နေသည်…',
      no_pending_card_requests: 'စောင့်ဆိုင်းနေသော ကတ်လျှောက်လွှာ မရှိပါ။',
      no_pending_reloads: 'စောင့်ဆိုင်းနေသော ကတ်ငွေဖြည့် တောင်းဆိုမှု မရှိပါ။',
      no_issued_cards: 'ထုတ်ပြီး ဒစ်ဂျစ်တယ်ကတ် မရှိသေးပါ။',

      pending_approval: 'အတည်ပြုရန် စောင့်ဆိုင်းဆဲ',
      pending_issuance: 'ထုတ်ပေးရန် စောင့်ဆိုင်းဆဲ',
      active: 'အသုံးပြုနိုင်',
      suspended: 'ရပ်ဆိုင်းထား',
      frozen: 'အေးခဲထား',
      terminated: 'ပယ်ဖျက်ပြီး',
      pending: 'စောင့်ဆိုင်းဆဲ',

      card_wallet_ok_mmk: 'MMK ပိုက်ဆံအိတ် လုံလောက်သည် — လက်ရှိ {{available}} (လိုအပ် {{required}})။ အက်ဒ်မင်က မကြာမီ ဆောင်ရွက်မည် (ပုံမှန် ၁၅–၃၀ မိနစ်)။',
      card_wallet_err_mmk: 'MMK ပိုက်ဆံအိတ် မလုံလောက်ပါ။ လိုအပ် {{required}}၊ လက်ရှိ {{available}}။ ဦးစွာ ငွေဖြည့်ပါ။',
      card_wallet_ok_usdt: 'USDT ပိုက်ဆံအိတ် လုံလောက်သည် — လက်ရှိ {{available}} (လိုအပ် {{required}})။ အက်ဒ်မင်က မကြာမီ ဆောင်ရွက်မည် (ပုံမှန် ၁၅–၃၀ မိနစ်)။',
      card_wallet_err_usdt: 'USDT ပိုက်ဆံအိတ် မလုံလောက်ပါ။ လိုအပ် {{required}}၊ လက်ရှိ {{available}}။ ဦးစွာ ငွေဖြည့်ပါ။',
      card_request_submitted: 'ကတ်လျှောက်လွှာ တင်သွင်းပြီးပါပြီ!',
      card_request_submitted_log: 'ကတ်လျှောက်လွှာ တင်သွင်းပြီး — {{amount}} နှုတ်ယူထားပြီး အက်ဒ်မင် ထုတ်ပေးရန် စောင့်နေသည်',
      card_request_pending_msg: 'အက်ဒ်မင်က မကြာမီ ဆောင်ရွက်မည် (ပုံမှန် ၁၅–၃၀ မိနစ်)။',
      card_request_deducted: 'သင့်ပိုက်ဆံအိတ်မှ {{amount}} နှုတ်ယူပြီးပါပြီ။',

      settings_security: 'ဆက်တင်နှင့် လုံခြုံရေး',
      kyc_verification: 'KYC အတည်ပြုခြင်း',
      identity_status: 'ကိုယ်ရေးအခြေအနေ —',
      kyc_hint: 'P2P ကြော်ငြာတင်ခြင်းနှင့် စျေးကွက်တွင် ကုန်သွယ်ရန် လိုအပ်သည်။',
      complete_kyc: 'KYC ပြီးအောင်လုပ်မည်',
      account: 'အကောင့်',
      support: 'အကူအညီ',
      subject: 'ခေါင်းစဉ်',
      message: 'စာသား',
      open_support_ticket: 'အကူအညီ တောင်းဆိုမည်',

      th_id: 'ID',
      th_user: 'အသုံးပြုသူ',
      th_status: 'အခြေအနေ',
      th_holder: 'ပိုင်ရှင်',
      th_pricing: 'ဈေးနှုန်း',
      th_deposit_ref: 'ငွေသွင်း ကိုးကား',
      th_requested: 'တောင်းဆိုချိန်',
      th_actions: 'လုပ်ဆောင်ချက်',
      th_amount: 'ပမာဏ',
      th_date: 'ရက်စွဲ',
      th_card: 'ကတ်',
      th_type: 'အမျိုးအစား',
      th_description: 'ဖော်ပြချက်',

      sign_in: 'ဝင်ရောက်ရန်',
      register: 'အကောင့်ဖွင့်ရန်',
      send_otp: 'OTP ပို့မည်',
      verify_pin: 'PIN အတည်ပြုမည်',
      forgot_pin: 'PIN မေ့နေပါသလား / 123456 သို့ ပြန်သတ်မှတ်မည်',
    }
  };

  let currentLang = DEFAULT_LANG;
  const listeners = new Set();

  function normalizeLang(lang) {
    const code = String(lang || '').toLowerCase();
    return SUPPORTED.includes(code) ? code : DEFAULT_LANG;
  }

  function interpolate(text, params) {
    if (!params || typeof text !== 'string') return text;
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => (
      params[key] != null ? String(params[key]) : `{{${key}}}`
    ));
  }

  function t(key, params) {
    const k = String(key || '').replace(/\./g, '_');
    const dict = messages[currentLang] || messages.en;
    const fallback = messages.en;
    const raw = dict[k] ?? fallback[k] ?? k;
    return interpolate(raw, params);
  }

  function getLang() {
    return currentLang;
  }

  function setLang(lang) {
    const next = normalizeLang(lang);
    if (next === currentLang) return currentLang;
    currentLang = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (_) { /* ignore */ }
    document.documentElement.lang = next === 'my' ? 'my' : 'en';
    apply(document);
    syncLanguageSwitcherUI();
    listeners.forEach((fn) => {
      try { fn(next); } catch (e) { console.warn('[I18n] listener error', e); }
    });
    document.dispatchEvent(new CustomEvent('eisy:langchange', { detail: { lang: next } }));
    return next;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = t(key);
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key));
    });
    scope.querySelectorAll('select option[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = t(key);
    });
  }

  function syncLanguageSwitcherUI() {
    document.querySelectorAll('.lang-switcher [data-lang]').forEach((btn) => {
      const active = btn.dataset.lang === currentLang;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function initLanguageSwitcher(mountEl) {
    if (!mountEl) return;
    mountEl.innerHTML =
      '<div class="lang-switcher" role="group" aria-label="' + t('lang_switcher_label') + '">' +
        '<button type="button" class="lang-btn" data-lang="my" aria-pressed="false">' + t('lang_my') + '</button>' +
        '<button type="button" class="lang-btn" data-lang="en" aria-pressed="false">' + t('lang_en') + '</button>' +
      '</div>';
    mountEl.querySelectorAll('[data-lang]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.lang !== currentLang) setLang(btn.dataset.lang);
      });
    });
    syncLanguageSwitcherUI();
  }

  function init() {
    let stored = DEFAULT_LANG;
    try {
      stored = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
    } catch (_) { /* ignore */ }
    currentLang = normalizeLang(stored);
    document.documentElement.lang = currentLang === 'my' ? 'my' : 'en';
    apply(document);
    initLanguageSwitcher(document.getElementById('langSwitcher'));
    initLanguageSwitcher(document.getElementById('langSwitcherAdmin'));
  }

  const I18n = {
    t,
    getLang,
    setLang,
    apply,
    init,
    onChange,
    initLanguageSwitcher,
    STORAGE_KEY,
    SUPPORTED,
  };

  global.I18n = I18n;
  global.t = t;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof window !== 'undefined' ? window : global));
