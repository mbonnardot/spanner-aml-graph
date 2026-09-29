import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@carbon/react';
import './styles/index.scss';
import { App } from './App';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <Theme theme="g100">
      <App />
    </Theme>
  </StrictMode>
);
