import { Home, LogIn } from 'lucide-react';

export function NotFoundPage() {
  return (
    <main className="not-found-page">
      <section className="not-found-content" aria-labelledby="not-found-title">
        <p className="not-found-code">404</p>
        <h1 id="not-found-title">Page not found</h1>
        <p>The page you requested does not exist.</p>
        <nav aria-label="404 navigation">
          <a href="/"><Home aria-hidden="true" />Home</a>
          <a href="/login"><LogIn aria-hidden="true" />Sign in</a>
        </nav>
      </section>
    </main>
  );
}