import React from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Bullseye, Spinner } from '@patternfly/react-core';
import '@patternfly/patternfly/patternfly.css';
import '@patternfly/patternfly/patternfly-addons.css';
import App from './app';
import cockpit from './platform/cockpit';
import { isPreviewMode } from './services/api/preview';
import './platform/platform.scss';

function Main() {
  const [allowed, setAllowed] = React.useState<boolean | null>(isPreviewMode() ? true : null);
  React.useEffect(() => {
    if (isPreviewMode()) return;
    const permission = cockpit.permission({ admin: true });
    const changed = () => setAllowed(permission.allowed === true ? true : permission.allowed === false ? false : null);
    permission.addEventListener('changed', changed);
    changed();
    return () => permission.removeEventListener('changed', changed);
  }, []);
  if (allowed === null) return <Bullseye><Spinner aria-label="관리자 권한 확인 중" /></Bullseye>;
  if (!allowed) return <Alert variant="warning" title="Cockpit에서 관리자 접근을 활성화해 주세요." />;
  return <App />;
}

function synchronizeTheme() {
  let source = document.documentElement;
  try { source = window.parent.document.documentElement; } catch { /* Use the local theme. */ }
  const dark = () => document.documentElement.classList.toggle('pf-v6-theme-dark',
    /pf-v6-theme-dark|pf-v5-theme-dark|theme-dark|pf-m-dark/.test(source.className));
  dark();
  if (source !== document.documentElement) new MutationObserver(dark).observe(source, { attributes: true, attributeFilter: ['class'] });
}
synchronizeTheme();
createRoot(document.getElementById('status')!).render(<Main />);
