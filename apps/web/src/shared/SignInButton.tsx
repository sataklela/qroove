import type { ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import { openSignIn, isApp } from './native';

/**
 * Sign-in to Google (YouTube) or Spotify. On the site a plain link; in the app it opens a Custom
 * Tab and comes back signed in (ADR 0029).
 */
export function SignInButton({
  href,
  children,
  className = 'btn',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={`${className} sign-in`}
      href={href}
      onClick={(e) => {
        if (!isApp()) return;
        e.preventDefault();
        void openSignIn(href);
      }}
    >
      <LogIn aria-hidden size={18} /> {children}
    </a>
  );
}
