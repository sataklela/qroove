import { BRAND } from '@qroove/config';

export function Privacy() {
  return (
    <article className="stack">
      <h1>Privacy</h1>
      <p>Qroove needs no account. In short:</p>
      <ul>
        <li>
          This device gets a random pass for each event you join. It is stored in your browser only.
        </li>
        <li>
          We store the songs you add and the name you join with, which shows the organiser who added
          each song.
        </li>
        <li>Participant records are deleted 30 days after an event ends.</li>
        <li>No audio is stored or streamed by Qroove. There are no ads or trackers.</li>
        <li>
          Searching sends your search words to Spotify. Pasting a link sends only the song id to the
          music service it came from to read its title.
        </li>
      </ul>
      <h2>Google user data (YouTube sign-in)</h2>
      <p>
        Signing in with Google is optional. It only lets you pick songs from your own YouTube
        playlists. If you never sign in, none of this applies.
      </p>
      <h3>What we access</h3>
      <p>
        We ask for one permission, <code>youtube.readonly</code> (view your YouTube account). With
        it we read only: the names and ids of your playlists (including Liked music), the video ids
        in a playlist you open, and those videos’ titles, channel names and lengths. We do not read
        your email, contacts, history, comments or anything else, and we never change your account.
      </p>
      <h3>How we use it</h3>
      <p>
        Only to show you your playlists and their songs so you can choose songs to add to an event
        queue. Nothing else: no advertising, no profiling, no selling, and no training of AI models.
      </p>
      <h3>Who we share it with</h3>
      <p>
        We do not sell, share, transfer or disclose Google user data to anyone. Requests go only
        between your browser, our server and Google. Our hosting provider (Railway) runs the server
        that handles these requests but does not receive the data for its own use. A song you
        choose to add (its title, artist and YouTube link) becomes part of that event’s queue and is
        visible to the organiser and guests of that event, as any added song is.
      </p>
      <h3>How we protect it</h3>
      <ul>
        <li>All traffic uses HTTPS.</li>
        <li>
          Your Google sign-in token is encrypted (AES-256-GCM) and kept in a secure, HttpOnly cookie
          on your own device. It is never stored in our database and never given to the web page.
        </li>
        <li>
          Playlist and video details are fetched when you ask for them, used to answer that request,
          and not saved on our server.
        </li>
      </ul>
      <h3>How long we keep it, and how to delete it</h3>
      <ul>
        <li>
          We keep no Google user data on our server. The encrypted sign-in cookie lasts at most 180
          days.
        </li>
        <li>
          Tap “Sign out of Google” under My YouTube playlist: we revoke Qroove’s access at Google
          and delete the cookie straight away. You can also remove Qroove’s access at any time at{' '}
          <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
        </li>
        <li>
          Songs you added to a queue stay with that event; ask the organiser, or contact us, to have
          one removed.
        </li>
      </ul>
      <p>
        Qroove’s use of information received from Google APIs adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <p>
        Questions or deletion requests: email{' '}
        <a href={`mailto:${BRAND.privacyEmail}`}>{BRAND.privacyEmail}</a>.
      </p>
      <p>
        The full details are in the{' '}
        <a href={`${BRAND.docsPath}/privacy`}>privacy page in the docs</a>.
      </p>
    </article>
  );
}
