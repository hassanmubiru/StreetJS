<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/ai-ui

Accessible, themeable React AI components for
[StreetJS](https://hassanmubiru.github.io/StreetJS/), built on
[`@streetjs/react`](https://www.npmjs.com/package/@streetjs/react). CSS-variable
theming with dark mode; no CSS-in-JS runtime. React is a peer dependency.

```bash
npm install @streetjs/client @streetjs/react @streetjs/ai-ui react
```

## Components

`Chat`, `StreamingMessage`, `RAGSearch`, `ToolExecutionViewer`, plus
`StreetAIStyles` (default stylesheet).

```tsx
import { StreetProvider } from '@streetjs/react';
import { createStreetClient } from '@streetjs/client';
import { Chat, StreetAIStyles } from '@streetjs/ai-ui';

const client = createStreetClient({ baseUrl: '/api', credentials: 'include' });

function Assistant() {
  return (
    <StreetProvider client={client}>
      <StreetAIStyles />
      <Chat model="gpt-4o-mini" title="Support" />
    </StreetProvider>
  );
}
```

`Chat` streams assistant tokens via `useAIChat`; `RAGSearch` renders ranked hits
via `useSearch`; `ToolExecutionViewer` inspects AI tool/function calls. Integrates
with whatever AI provider your StreetJS backend exposes.

> **Status:** `0.1.x` preview — pre-1.0. Verified by build + type-check +
> export-shape tests (not full DOM render tests).

## License

MIT
