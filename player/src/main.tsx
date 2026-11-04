import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import './themes.css';
import { initializeTheme } from './theme';
import { InterfaceProvider } from './ui/InterfaceProvider';

const disposeTheme = initializeTheme();
if (import.meta.hot) import.meta.hot.dispose(disposeTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <InterfaceProvider><App /></InterfaceProvider>
    </ErrorBoundary>
  </StrictMode>,
);
