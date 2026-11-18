import ReactDOM from 'react-dom/client';
import '@/assets/tailwind.css';
import { LangProvider } from '@/components/i18n';
import { PdfPanel } from '@/components/pdf/PdfPanel';
ReactDOM.createRoot(document.getElementById('root')!).render(<LangProvider><PdfPanel /></LangProvider>);
