import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PartyPopper, QrCode, ScanLine, SlidersHorizontal, Smartphone } from 'lucide-react';
import { adminApi, organiserPath } from '../admin/adminApi';
import { api, ApiError } from '../shared/api';
import { CodeInput } from '../shared/CodeInput';
import { InfoTip } from '../shared/InfoTip';
import { isAndroidBrowser, isApp, scanRoomCode } from '../shared/native';

/** Everything fits one phone screen: the code boxes come first, like a quiz app. */
export function Landing() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const go = useNavigate();
  const app = isApp();

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
        ) : app ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void scanRoomCode().then((path) => {
                if (path) go(path);
                else if (path === null) setProblem('That is not a Qroove room code.');
              })
            }
          >
            <ScanLine aria-hidden size={20} /> Scan QR
          </button>
        ) : (
          <p className="muted landing-hint">
            <QrCode aria-hidden size={20} /> or scan the QR
          </p>
        )}
      </div>
      <div className="landing-actions">
        <button
          type="button"
          className="btn primary landing-host"
          disabled={busy}
          onClick={() => void create()}
        >
          <PartyPopper aria-hidden size={22} /> Host an event
        </button>
        <Link to="/new" className="btn ghost" aria-label="Plan in detail" title="Plan in detail">
          <SlidersHorizontal aria-hidden size={20} />
        </Link>
        <InfoTip label="What Host an event sets up">
          2 hours · Salsa and Bachata in turn · 20 songs each. Change any of it once the music is
          on.
        </InfoTip>
      </div>
      {isAndroidBrowser() ? (
        // Hosting from an Android phone: the app keeps the screen on and rides out a weak network.
        <a className="btn ghost small landing-android" href="/docs/guide/android">
          <Smartphone aria-hidden size={18} /> Android app
        </a>
      ) : null}
    </div>
  );
}
