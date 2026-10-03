import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import WidgetApp from './widget/WidgetApp';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WidgetApp />
  </StrictMode>,
);
