import { BRAND } from '@qroove/config';

export function Terms() {
  const c = BRAND.company.name;
  return (
    <article className="stack">
      <h1>Terms of service</h1>
      <p>Last updated 25 November 2026.</p>
      <p>
        {BRAND.product} is a free, open-source song queue for dance socials, offered by {c}{' '}
        (Estonia) as a community (CSR) initiative. By using the website or the Android app you agree
        to these terms. If you do not agree, please do not use {BRAND.product}.
      </p>

      <h2>The service</h2>
      <ul>
        <li>
          {BRAND.product} lets guests request songs and lets an organiser play them in a fair order.
          It is free, needs no account, and has no ads or in-app purchases.
        </li>
        <li>
          We may change, pause or stop the service, or remove events, at any time. Events end and
          their data is deleted as described in the <a href="/privacy">privacy notice</a>.
        </li>
        <li>
          The source code is licensed under the{' '}
          <a href={BRAND.licence.url}>GNU {BRAND.licence.name}</a>; that licence, not these terms,
          governs the code itself.
        </li>
      </ul>

      <h2>Music and third-party services</h2>
      <ul>
        <li>
          {BRAND.product} does not host, store, download or stream any audio. Songs play through the
          official YouTube or Spotify players, or from files on the organiser’s own device.
        </li>
        <li>
          When you use those players you also agree to their terms:{' '}
          <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>,{' '}
          <a href="https://policies.google.com/privacy">Google Privacy Policy</a> and, where used,
          the <a href="https://www.spotify.com/legal/end-user-agreement/">Spotify terms</a>.
        </li>
        <li>
          <strong>Organisers</strong> are responsible for having any licence needed to play music in
          public at their event (for example from a local music-rights society), and for the music
          files they play.
        </li>
      </ul>

      <h2>Your use</h2>
      <ul>
        <li>
          Do not use {BRAND.product} to break the law, to harass anyone, or to request or play
          content you have no right to play.
        </li>
        <li>
          Do not try to disrupt the service, get around its limits, or access events you were not
          invited to.
        </li>
        <li>
          Organisers may remove songs or guests from their event. We may remove content or block
          access that breaks these terms.
        </li>
        <li>You keep any rights you have in what you add; you let us show it within the event.</li>
      </ul>

      <h2>No warranty and liability</h2>
      <p>
        {BRAND.product} is provided free and “as is”, without warranties of any kind. We do not
        promise that it will always be available, error-free or play every song. To the extent the
        law allows, {c} is not liable for indirect or consequential loss, or for loss of data,
        arising from its use. Nothing in these terms limits liability that cannot be limited by law,
        or your rights as a consumer.
      </p>

      <h2>Law and contact</h2>
      <p>
        These terms are governed by the laws of Estonia; this does not remove the protection of the
        consumer laws of the country where you live. We may update these terms; the date above shows
        the latest version. Questions:{' '}
        <a href={`mailto:${BRAND.privacyEmail}`}>{BRAND.privacyEmail}</a>.
      </p>
    </article>
  );
}
