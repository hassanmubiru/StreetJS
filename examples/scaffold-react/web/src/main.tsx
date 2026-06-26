import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createStreetClient } from '@streetjs/client';
import { StreetProvider } from '@streetjs/react';
import { App } from './App';

const client = createStreetClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  credentials: 'include',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StreetProvider client={client}>
      <App />
    </StreetProvider>
  </StrictMode>,
);
