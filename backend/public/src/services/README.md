# Frontend services (Step 3)

Domain API clients for the SPA. Classic scripts attach to `window.EisyServices`.

| Module | Namespace |
|--------|-----------|
| `apiClient.js` | `EisyServices.api` |
| `depositApi.js` | `EisyServices.deposit` |
| `usdtWalletApi.js` | `EisyServices.usdtWallet` |
| `withdrawalApi.js` | `EisyServices.withdrawal` |
| `cardsApi.js` | `EisyServices.cards` |
| `accountApi.js` | `EisyServices.kyc` / `.support` / `.transactions` |
| `p2pApi.js` | `EisyServices.p2p` |
| `supabaseService.js` | ES module → `window.SupabaseBridge` |

Load after `auth.js` (except supabase, which is `type="module"`).
