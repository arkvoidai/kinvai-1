import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { loadPublicConfig } from './lib/config';
import './index.css';

// Resolve server-injected or API-backed public configuration before any data/auth
// providers initialize, preventing a first render with an unconfigured Supabase client.
void loadPublicConfig().finally(() => {
  const root = document.getElementById('root');
  if (!root) throw new Error('Kinvai root element was not found.');
  createRoot(root).render(<App />);
});
