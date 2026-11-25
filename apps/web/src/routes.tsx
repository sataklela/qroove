import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router';
import { EventPage } from './attendee/EventPage';
import { Landing } from './landing/Landing';
import { Privacy } from './landing/Privacy';
import { Terms } from './landing/Terms';
import { Layout } from './shared/Layout';
import { MenuProvider } from './shared/menu';

const CreateEvent = lazy(() => import('./admin/CreateEvent'));
const AdminEntry = lazy(() => import('./admin/AdminEntry'));
const AdminPage = lazy(() => import('./admin/AdminPage'));
const Historical = lazy(() => import('./admin/Historical'));

/** Old links: the player now lives on the organiser page. */
function PlayerRedirect() {
  const { eventId = '' } = useParams();
  return <Navigate to={`/admin/${eventId}`} replace />;
}

export function AppRoutes() {
  return (
    <MenuProvider>
      <Layout>
        <Suspense fallback={<p role="status">Loading…</p>}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/e/:slug" element={<EventPage />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/new" element={<CreateEvent />} />
            <Route path="/import" element={<Navigate to="/new#playlist" replace />} />
            <Route path="/a/:eventId" element={<AdminEntry mode="link" />} />
            <Route path="/claim/:eventId" element={<AdminEntry mode="claim" />} />
            <Route path="/admin/:eventId" element={<AdminPage />} />
            <Route path="/h/:slug" element={<Historical />} />
            <Route path="/player/:eventId" element={<PlayerRedirect />} />
            <Route path="*" element={<Landing />} />
          </Routes>
        </Suspense>
      </Layout>
    </MenuProvider>
  );
}
