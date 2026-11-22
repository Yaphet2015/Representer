import ReactDOM from 'react-dom/client';
import '@/assets/tailwind.css';
import { LangProvider } from '@/components/i18n';
import { PdfPanel } from '@/components/pdf/PdfPanel';
import { installPanelTrace } from '@/lib/pdf-panel-trace';

if (import.meta.env.VITE_RP_ENTRY_DIAG === '1') {
  const raw = new URLSearchParams(location.search).get('tab');
  const tab = raw === null ? undefined : Number(raw);
  installPanelTrace(Number.isInteger(tab) ? tab : undefined);
}
ReactDOM.createRoot(document.getElementById('root')!).render(<LangProvider><PdfPanel /></LangProvider>);
