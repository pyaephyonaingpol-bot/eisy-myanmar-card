# Shared frontend types

These describe browser-side shapes used by the SPA. Runtime remains JavaScript;
`.d.ts` files give editors/TypeScript tooling autocomplete without a build step.

When Step 3–5 introduce ES modules, import types with:

```ts
import type { DepositRequest, UserSession } from '/src/types/index.d.ts';
```
