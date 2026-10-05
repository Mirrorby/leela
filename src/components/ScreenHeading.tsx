import type { ReactNode } from 'react';
import { LanguageControl } from '../i18n/LanguageControl';

export function ScreenHeading({ children }: { children: ReactNode }) {
  return <div className="screen-heading"><h1>{children}</h1><LanguageControl /></div>;
}
