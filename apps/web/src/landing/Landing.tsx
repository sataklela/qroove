import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { adminApi, organiserPath } from '../admin/adminApi';
import { api, ApiError } from '../shared/api';
import { CodeInput } from '../shared/CodeInput';

/** Everything fits one phone screen: the code boxes come first, like a quiz app. */
export function Landing() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = useNavigate();

  async function enter(c: string) {
    setBusy(true);
    setProblem(null);
    try {
      await api.bySlug(c);
      go(`/e/${c}`);
    } catch (e) {
      setProblem(
        e instanceof ApiError && e.status === 404
          ? 'No event has that code.'
          : 'Could not check that code. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  /** One tap: an event with the default settings and starter songs, straight to the console. */
  async function create() {
    setBusy(true);
    setProblem(null);
    try {
      const made = await adminApi.create({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        starter: true,
      });
      go(organiserPath(made), { replace: true });
    } catch (e) {
      setProblem(
        e instanceof ApiError ? `${e.message} ${e.action}` : 'Could not create the event.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="landing">
      <h1>Enter code</h1>
      <CodeInput
        value={code}
        groupSize={3}
        onChange={(v) => {
          setCode(v);
          if (v.length < 6) setProblem(null);
        }}
        onComplete={(v) => void enter(v)}
        disabled={busy}
      />
      <div className="landing-msg" role="status" aria-live="polite">
        {problem ? (
          <p className="error">{problem}</p>
        ) : (
          <p className="muted">Or scan the organiser’s QR code with your camera.</p>
        )}
      </div>
      <div className="landing-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void create()}>
          Start an event now
        </button>
      </div>
      <p className="muted small landing-defaults">
        2 hours · Salsa and Bachata in turn · 20 songs each. Change any of it once the music is on.{' '}
        <Link to="/new">Plan in detail</Link>
      </p>
    </div>
  );
}
