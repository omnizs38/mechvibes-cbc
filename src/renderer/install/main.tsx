import { createRoot } from 'react-dom/client';
import '../styles/base.css';
import './install.css';
import { InstallApp } from './InstallApp';
import { applyStoredTheme } from '../shared/theme';

applyStoredTheme();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Renderer root element is missing.');
}

createRoot(container).render(<InstallApp />);
