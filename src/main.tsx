import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './lib/theme'; // applies the saved theme before first paint
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
