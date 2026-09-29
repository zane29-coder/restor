import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { RestorApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Restaurant data changes constantly; 15s keeps screens fresh without
      // hammering the API on every focus change.
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Retrying a 401/403/404 just produces the same answer more slowly.
        if (error instanceof RestorApiError && !error.isRetryable) return false;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/*
        The app is served at `/` in development but under `/admin/` in
        production (one domain, path-based routing). Vite injects the build's
        `--base` as BASE_URL, so the router follows it automatically instead of
        needing a second, hand-maintained constant.
      */}
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
