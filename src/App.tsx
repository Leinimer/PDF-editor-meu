/**
 * App shell: header with branding and theme toggle, the workspace (the app
 * always shows a document — it boots into a fresh blank sheet), window-wide
 * file drop, toasts, and the busy overlay.
 */

import { useEffect, useState, type JSX } from 'react';
import { ensureDocument } from './services/new-document';
import { openFiles } from './services/open-files';
import { preloadGoogleDriveLibraries } from './services/google-picker';
import { BusyOverlay } from './ui/components/BusyOverlay';
import { Workspace } from './ui/components/Workspace';
import { PrivacyDialog } from './ui/components/dialogs/PrivacyDialog';
import { TermsDialog } from './ui/components/dialogs/TermsDialog';
import { useFileDrop } from './ui/hooks/useFileDrop';
import { Icon } from './ui/icons';
import { ToastProvider, useToasts } from './ui/toast/Toasts';

declare const __APP_VERSION__: string;

export function App(): JSX.Element {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner(): JSX.Element {
  const toasts = useToasts();

  // Boot into a blank sheet so there is always something to work on.
  useEffect(() => {
    // Preload Google scripts before a user click so OAuth can open its authorization UI reliably.
    void preloadGoogleDriveLibraries().catch((error: unknown) => {
      console.warn('Google Drive libraries are not ready yet:', error);
    });

    void ensureDocument().catch(() => {
      toasts.push('error', 'Could not create a blank document.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [legalModal, setLegalModal] = useState<'privacy' | 'terms' | null>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.toLowerCase();
      if (hash === '#privacidade' || hash === '#privacy') return 'privacy';
      if (hash === '#termos' || hash === '#terms') return 'terms';
    }
    return null;
  });

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.toLowerCase();
      if (hash === '#privacidade' || hash === '#privacy') {
        setLegalModal('privacy');
      } else if (hash === '#termos' || hash === '#terms') {
        setLegalModal('terms');
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  const closeLegalModal = () => {
    setLegalModal(null);
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  };

  const dragging = useFileDrop((files) => {
    void openFiles(files).then((result) => {
      for (const failure of result.errors) {
        toasts.push('error', `${failure.name}: ${failure.message}`);
      }
      if (result.openedFiles > 0) {
        toasts.push(
          'success',
          `Opened ${result.openedFiles} document${result.openedFiles === 1 ? '' : 's'}.`,
        );
      }
    });
  });

  return (
    <div className="app">
      <main className="app-main">
        <Workspace />
      </main>

      <footer className="app-footer">
        <p className="muted small">
          PDF Editor v{__APP_VERSION__} · A{' '}
          <a href="https://www.vensas.de" rel="noopener">
            vensas GmbH
          </a>{' '}
          product ·{' '}
          <a
            href="#privacidade"
            onClick={(e) => {
              e.preventDefault();
              setLegalModal('privacy');
              window.location.hash = 'privacidade';
            }}
          >
            Política de Privacidade
          </a>{' '}
          ·{' '}
          <a
            href="#termos"
            onClick={(e) => {
              e.preventDefault();
              setLegalModal('terms');
              window.location.hash = 'termos';
            }}
          >
            Termos de Serviço
          </a>{' '}
          ·{' '}
          <a href="https://www.vensas.de/imprint" rel="noopener">
            Imprint
          </a>{' '}
          · Open source · All processing happens locally via{' '}
          <a href="https://pdf-lib.js.org" rel="noopener">
            pdf-lib
          </a>{' '}
          and{' '}
          <a href="https://mozilla.github.io/pdf.js/" rel="noopener">
            pdf.js
          </a>{' '}
          ·{' '}
          <a href="https://github.com/vensas/pdf-editor" rel="noopener">
            Source on GitHub
          </a>
        </p>
      </footer>

      <PrivacyDialog open={legalModal === 'privacy'} onClose={closeLegalModal} />
      <TermsDialog open={legalModal === 'terms'} onClose={closeLegalModal} />

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <Icon name="upload" size={32} />
            <p>Drop PDFs to open them — each file becomes its own tab</p>
          </div>
        </div>
      )}

      <BusyOverlay />
    </div>
  );
}
