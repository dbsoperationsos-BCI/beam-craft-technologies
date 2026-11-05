"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPublicInvitation } from "@/services/invitations/public-invitation.service";
import "./invitation.css";

/*
 * A client's invitation, as a guest opens it at `/inv/<token>`.
 *
 * It opens on a curtain - tap to open - because a phone will not play sound before the guest has
 * touched the page; the tap that opens it starts the song, ten seconds of it from the second the
 * client chose, on a loop, with a button to mute it. Then the design's artwork with its top and
 * bottom pieces moving in, the names in the design's face, and section by section as the guest
 * scrolls: the message, a countdown, the events with directions, and a WhatsApp reply. What floats
 * over the page - sparkles, petals, balloons, light - and how each part comes in is the design's
 * theme (`style`). Everything written is the client's own; nothing here is made up.
 */

const PARTICLES = 18;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The parts of a date the design sets out: "DEC", "12", "2026", "Saturday". Null without a date. */
function dateParts(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return null;
  const date = new Date(`${day}T00:00:00`);
  return {
    month: date.toLocaleDateString("en-IN", { month: "short" }).toUpperCase(),
    day: String(date.getDate()),
    year: String(date.getFullYear()),
    weekday: date.toLocaleDateString("en-IN", { weekday: "long" }),
    long: date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
  };
}

const timeLabel = (time) => {
  if (!/^\d{2}:\d{2}$/.test(time || "")) return "";
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// A map the client pasted, or a search for the place they wrote.
const directionsFor = (mapUrl, venue) => (mapUrl || (venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}` : ""));

/** A name written in a letter at a time, as if by pen (`start` staggers it after what comes before). */
function Written({ text, start = 0 }) {
  // Word by word, so a line only ever breaks between words - never inside one. Each letter's place in
  // the whole (for its delay) is worked out first.
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const firsts = words.map((_, w) => start + words.slice(0, w).reduce((sum, word) => sum + word.length + 1, 0));
  return <span className="inv-names-one" aria-label={text}>
    {words.map((word, w) => <span key={w} className="inv-word" aria-hidden="true">
      {Array.from(word).map((letter, i) => <span key={i} className="inv-letter" style={{ "--c": firsts[w] + i }}>{letter}</span>)}
    </span>)}
  </span>;
}

/** "Sanjay & Deepa" set as the design sets two names: one, the ampersand, the other. */
function Names({ names }) {
  const parts = String(names || "").split(/\s*&\s*/).filter(Boolean);
  if (parts.length !== 2) return <Written text={names} />;
  return <>
    <Written text={parts[0]} />
    <span className="inv-amp" aria-label="and" style={{ "--c": parts[0].length }}>&amp;</span>
    <Written text={parts[1]} start={parts[0].length + 2} />
  </>;
}

/** The fine gold corners of the frame around the opening words. */
function Corner({ where }) {
  return <svg className={`inv-corner inv-corner-${where}`} viewBox="0 0 60 60" aria-hidden="true">
    <path d="M2 58 V14 Q2 2 14 2 H58" />
    <path d="M10 58 V20 Q10 10 20 10 H58" />
    <circle cx="14" cy="14" r="2.4" />
  </svg>;
}

// A celebration's mark, from its name: a sun for haldi, leaves for mehandi, a note for sangeet...
const EVENT_ICONS = [
  [/haldi/i, "M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"],
  [/mehandi|mehendi/i, "M12 21c-4-3-7-7-7-11a7 7 0 0 1 14 0c0 4-3 8-7 11ZM12 21V9"],
  [/sangee?th?|music|dance/i, "M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"],
  [/reception|cocktail|party/i, "M8 3h8l-1 7a3 3 0 0 1-6 0L8 3ZM12 13v7M8 21h8"],
  [/wedding|muhur|marriage|engage/i, "M9 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM15 19a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"],
  [/baby|naming|shower|birthday|kids|newborn/i, "M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10Z"],
];
function EventIcon({ name }) {
  const path = EVENT_ICONS.find(([test]) => test.test(name || ""))?.[1] || "M12 3l2.6 5.4 5.9.9-4.3 4.1 1 5.9L12 16.5 6.8 19.3l1-5.9L3.5 9.3l5.9-.9L12 3Z";
  return <span className="inv-event-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={path} /></svg></span>;
}

/** A section's heading: the small gold words, set between fine rules. */
function Heading({ children }) {
  return <p className="inv-kicker inv-kicker-ruled"><span>{children}</span></p>;
}

const initialsOf = (names) => String(names || "").split(/\s*&\s*/).filter(Boolean).slice(0, 2).map((name) => name.trim().charAt(0).toUpperCase()).join(" & ");

/** What floats over the page, laid out the same on every render (no random numbers to mismatch). */
function Particles({ style }) {
  const items = useMemo(() => Array.from({ length: PARTICLES }, (_, i) => {
    const seed = (n) => ((i + 1) * n * 9301 + 49297) % 233280 / 233280;
    return {
      left: `${Math.round(seed(7) * 100)}%`,
      delay: `${(seed(13) * 12).toFixed(2)}s`,
      duration: `${(9 + seed(17) * 9).toFixed(2)}s`,
      size: `${(0.6 + seed(23) * 0.9).toFixed(2)}`,
      hue: Math.round(seed(29) * 4),
    };
  }), []);
  return <div className={`inv-particles inv-particles-${style}`} aria-hidden="true">
    {items.map((item, i) => <span key={i} className={`inv-p inv-p-hue${item.hue}`} style={{ "--x": item.left, "--d": item.delay, "--t": item.duration, "--s": item.size }} />)}
  </div>;
}

function Countdown({ day, time }) {
  const target = useMemo(() => (dateParts(day) ? new Date(`${day}T${time || "09:00"}:00`).getTime() : null), [day, time]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  if (!target) return null;
  const left = target - now;
  if (left <= 0) {
    return <section className="inv-section inv-reveal">
      <p className="inv-kicker">{left > -DAY_MS ? "The day is here" : "With gratitude"}</p>
      <p className="inv-lead">{left > -DAY_MS ? "Today we celebrate - we can't wait to see you." : "Thank you for celebrating with us."}</p>
    </section>;
  }
  const units = [["Days", Math.floor(left / DAY_MS)], ["Hours", Math.floor(left / 3600000) % 24], ["Minutes", Math.floor(left / 60000) % 60], ["Seconds", Math.floor(left / 1000) % 60]];
  return <section className="inv-section inv-reveal">
    <Heading>Counting down</Heading>
    <div className="inv-count" role="timer" aria-label={`${units[0][1]} days to go`}>
      {units.map(([label, value]) => <div key={label} className="inv-count-tile">
        <span className="inv-count-value" key={value}>{String(value).padStart(2, "0")}</span>
        <span className="inv-count-label">{label}</span>
      </div>)}
    </div>
  </section>;
}

function Flourish() {
  return <svg className="inv-flourish" viewBox="0 0 220 24" aria-hidden="true">
    <path d="M2 12 H86 M134 12 H218" />
    <path d="M110 3 C116 9 116 15 110 21 C104 15 104 9 110 3 Z" />
    <circle cx="94" cy="12" r="2.2" />
    <circle cx="126" cy="12" r="2.2" />
  </svg>;
}

const PinIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" /><circle cx="12" cy="10" r="2.6" /></svg>;
const WhatsAppIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 3.5A11 11 0 0 0 3.3 17.1L2 22l5-1.3A11 11 0 0 0 20.5 3.5ZM12 20.1a9 9 0 0 1-4.6-1.3l-.3-.2-3 .8.8-2.9-.2-.3a9.1 9.1 0 1 1 7.3 3.9Zm5-6.8c-.3-.1-1.6-.8-1.9-.9-.3-.1-.4-.1-.6.1l-.9 1.1c-.2.2-.3.2-.6.1a7.4 7.4 0 0 1-3.7-3.2c-.3-.5.3-.5.8-1.6.1-.2 0-.3 0-.5l-.9-2c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.9-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.6-.3Z" /></svg>;

export default function InvitationExperience({ token, previewKey = "", initial, studioName, still = false, recording = false }) {
  const [invitation, setInvitation] = useState(initial || null);
  const [failed, setFailed] = useState("");
  // closed -> opening (the curtain parts) -> open
  const [stage, setStage] = useState(still ? "open" : "closed");
  // The still front: "loading" until its pictures and faces have arrived, then "ready" to photograph.
  const [drawn, setDrawn] = useState("loading");
  const [playing, setPlaying] = useState(false);
  // The gallery photo open full size, or null.
  const [viewing, setViewing] = useState(null);
  const audio = useRef(null);
  const page = useRef(null);

  useEffect(() => {
    if (initial) return undefined;
    let active = true;
    getPublicInvitation(token, previewKey)
      .then((found) => { if (active) setInvitation(found); })
      .catch((error) => { if (active) setFailed(error.status === 404 ? "This invitation could not be found. It may have been taken down." : error.message); });
    return () => { active = false; };
  }, [token, previewKey, initial]);

  // Recorded for the Download video: the recorder steps the page frame by frame, so it - not a timer
  // running on the clock - tells the page when the doors have finished opening.
  useEffect(() => {
    if (!recording) return undefined;
    window.invitationOpened = () => setStage("open");
    return () => { delete window.invitationOpened; };
  }, [recording]);

  // The still front says when everything on it has arrived, so the picture is never half-drawn.
  useEffect(() => {
    if (!still || !invitation) return undefined;
    let active = true;
    const pictures = [invitation.coverType === "video" ? invitation.posterUrl : invitation.coverUrl, invitation.topUrl, invitation.bottomUrl, invitation.photoUrl].filter(Boolean);
    const arrive = (src) => new Promise((resolve) => {
      const picture = new window.Image();
      picture.onload = resolve;
      picture.onerror = resolve;
      picture.src = src;
    });
    Promise.all([...pictures.map(arrive), document.fonts?.ready]).then(() => {
      // One more frame, so what arrived is painted before it is photographed.
      window.requestAnimationFrame(() => { if (active) setDrawn("ready"); });
    });
    return () => { active = false; };
  }, [still, invitation]);

  // Each section comes in as it scrolls into view, once.
  useEffect(() => {
    if (stage !== "open" || !page.current) return undefined;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("inv-in");
          observer.unobserve(entry.target);
        }
      }
    }, { threshold: 0.18 });
    page.current.querySelectorAll(".inv-reveal").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [stage]);

  const song = invitation?.song;
  // Ten seconds from the chosen second, round and round.
  const loop = useCallback(() => {
    const player = audio.current;
    if (!player || !song) return;
    if (player.currentTime >= song.start + song.seconds || player.currentTime < song.start - 0.5) player.currentTime = song.start;
  }, [song]);

  const play = useCallback(async () => {
    const player = audio.current;
    if (!player || !song) return;
    try {
      if (player.currentTime < song.start || player.currentTime >= song.start + song.seconds) player.currentTime = song.start;
      await player.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, [song]);

  function open() {
    if (stage !== "closed") return;
    setStage("opening");
    void play();
    if (!recording) window.setTimeout(() => setStage("open"), 1400);
  }

  function toggleSound() {
    const player = audio.current;
    if (!player) return;
    if (playing) {
      player.pause();
      setPlaying(false);
    } else {
      void play();
    }
  }

  if (failed) {
    return <main className="inv-empty" data-invitation-state={still ? "missing" : undefined}><p>{failed}</p></main>;
  }
  if (!invitation) {
    return <main className="inv-empty"><span className="inv-loader" aria-label="Opening the invitation" /></main>;
  }
  // Made, but not yet shared by the couple (a priced design not yet paid for): a guest is told so,
  // kindly, and nothing of it is shown.
  if (invitation.locked) {
    return <main className="inv-empty inv-locked" data-invitation-state={still ? "missing" : undefined}>
      <div>
        <p className="inv-locked-kicker">Almost ready</p>
        {invitation.names ? <p className="inv-locked-names">{invitation.names}</p> : null}
        <p>This invitation hasn&apos;t been shared yet. Please check back soon.</p>
      </div>
    </main>;
  }

  const { content, style, coverUrl, topUrl, bottomUrl, photoUrl } = invitation;
  // Artwork exported as a video plays silent on a loop; where a moving picture is not wanted (the
  // still front, the curtain's doors) its first frame stands in.
  const videoArt = invitation.coverType === "video" && Boolean(coverUrl);
  const coverStill = videoArt ? invitation.posterUrl : coverUrl;
  const accent = invitation.accent || "#b08d57";
  const date = dateParts(content.date);
  const venue = [content.venue, content.address].filter(Boolean).join(", ");
  const events = content.events?.filter((event) => event.name || event.date || event.venue) || [];
  const rsvp = content.rsvpPhone ? `https://wa.me/${content.rsvpPhone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hi! Thank you for the invitation${content.names ? ` - ${content.names}` : ""}. I would love to be there.`)}` : "";
  // The studio's artwork is a picture of its own beside the words - never behind them - so the
  // words always read on the page's own paper, the way a printed invitation is laid out.
  const vars = {
    "--inv-accent": accent,
    "--inv-cover": coverStill ? `url("${coverStill}")` : "none",
  };

  return <div className={`inv-root inv-style-${style} inv-stage-${stage}${still ? " inv-still" : ""}${recording ? " inv-recording" : ""}`} style={vars} data-invitation-state={still ? drawn : undefined}>
    {song && !still ? <audio ref={audio} src={song.url} preload="auto" onTimeUpdate={loop} onEnded={() => { void play(); }} /> : null}

    {stage !== "open" && !still ? <div className="inv-curtain" role="button" tabIndex={0} aria-label="Open the invitation" onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}>
      <div className="inv-door inv-door-left" aria-hidden="true" />
      <div className="inv-door inv-door-right" aria-hidden="true" />
      <div className="inv-seal-wrap">
        <p className="inv-curtain-kicker">You&apos;re invited</p>
        <div className="inv-seal"><span>{initialsOf(content.names) || "♥"}</span></div>
        {content.names ? <p className="inv-curtain-names">{content.names}</p> : null}
        <p className="inv-tap">Tap to open{song ? " ♪" : ""}</p>
      </div>
    </div> : null}

    <main ref={page} className="inv-page">
      {still ? null : <Particles style={style} />}

      {/* The opening: the words on the page, and the studio's artwork as its own picture - below them
          on a phone, beside them on a computer - with its top and bottom pieces moving around it. */}
      <section className="inv-hero">
        <div className="inv-hero-text">
          <Corner where="tl" /><Corner where="tr" /><Corner where="bl" /><Corner where="br" />
          {content.heading ? <p className="inv-heading inv-seq" style={{ "--i": 0 }}>{content.heading}</p> : null}
          <h1 className="inv-names inv-seq" style={{ "--i": 1 }}><Names names={content.names} /></h1>
          {date ? <div className="inv-date inv-seq" style={{ "--i": 2 }}>
            <span>{date.month}</span><span className="inv-date-day">{date.day}</span><span>{date.year}</span>
          </div> : null}
          {content.time ? <p className="inv-when inv-seq" style={{ "--i": 3 }}>{date ? `${date.weekday} · ` : ""}{timeLabel(content.time)}</p> : null}
          {venue ? <p className="inv-venue inv-seq" style={{ "--i": 4 }}>{venue}</p> : null}
        </div>
        <div className="inv-art">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {topUrl ? <img src={topUrl} alt="" className="inv-layer inv-layer-top" aria-hidden="true" /> : null}
          {videoArt && !still
            ? <video src={coverUrl} poster={invitation.posterUrl || undefined} className="inv-art-image" autoPlay muted loop playsInline aria-hidden="true" />
            // eslint-disable-next-line @next/next/no-img-element
            : coverStill ? <img src={coverStill} alt="" className="inv-art-image" aria-hidden="true" /> : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {bottomUrl ? <img src={bottomUrl} alt="" className="inv-layer inv-layer-bottom" aria-hidden="true" /> : null}
        </div>
        {still ? null : <span className="inv-scroll" aria-hidden="true" />}
      </section>

      {still ? null : <div className="inv-sheet">
        {content.message || content.hosts || photoUrl ? <section className="inv-section inv-reveal">
          <Flourish />
          <p className="inv-invite-word">We invite you</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {photoUrl ? <div className="inv-photo"><img src={photoUrl} alt={content.names || "The couple"} /></div> : null}
          {content.message ? <p className="inv-lead">{content.message}</p> : null}
          {content.hosts ? <p className="inv-hosts"><span>With love,</span>{content.hosts}</p> : null}
        </section> : null}

        {/* The families: the couple and each side's parents, two photos to a card. */}
        {content.families?.some((family) => family.names || family.photos?.length) ? <section className="inv-section">
          <div className="inv-reveal"><Heading>With the blessings of</Heading></div>
          <div className="inv-families">
            {content.families.filter((family) => family.names || family.photos?.length).map((family, i) => <div key={i} className="inv-family inv-reveal" style={{ "--i": i }}>
              {family.names ? <h3 className="inv-family-names">{family.names}</h3> : null}
              {family.line ? <p className="inv-family-line">{family.line}</p> : null}
              {family.photos?.length ? <div className="inv-family-photos">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {family.photos.map((photo) => <img key={photo} src={photo} alt="" />)}
              </div> : null}
            </div>)}
          </div>
        </section> : null}

        <Countdown day={content.date} time={content.time} />

        {events.length ? <section className="inv-section inv-reveal">
          <Heading>The celebrations</Heading>
          <ol className="inv-events">
            {events.map((event, i) => {
              const when = dateParts(event.date);
              const map = directionsFor(event.mapUrl, event.venue);
              return <li key={i} className="inv-event inv-reveal" style={{ "--i": i }}>
                <span className="inv-event-dot" aria-hidden="true" />
                <div className="inv-event-card">
                  <EventIcon name={event.name} />
                  {event.name ? <h3 className="inv-event-name">{event.name}</h3> : null}
                  {when || event.time ? <p className="inv-event-when">{[when?.long, timeLabel(event.time)].filter(Boolean).join(" · ")}</p> : null}
                  {event.venue ? <p className="inv-event-venue">{event.venue}</p> : null}
                  {map ? <a className="inv-button inv-button-ghost" href={map} target="_blank" rel="noopener noreferrer"><PinIcon />Get directions</a> : null}
                </div>
              </li>;
            })}
          </ol>
        </section> : venue ? <section className="inv-section inv-reveal">
          <p className="inv-kicker">Where</p>
          <p className="inv-lead">{venue}</p>
          <a className="inv-button inv-button-ghost" href={directionsFor(content.mapUrl, venue)} target="_blank" rel="noopener noreferrer"><PinIcon />Get directions</a>
        </section> : null}

        {/* The couple's photos: a row to scroll, each opening full size. */}
        {content.gallery?.length ? <section className="inv-section inv-reveal">
          <Heading>Moments</Heading>
          <div className="inv-gallery">
            {content.gallery.map((photo, i) => <button key={photo} type="button" className="inv-gallery-item" onClick={() => setViewing(photo)} aria-label={`Photo ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="" loading="lazy" />
            </button>)}
          </div>
        </section> : null}

        {rsvp ? <section className="inv-section inv-reveal">
          <Heading>Will you join us?</Heading>
          <a className="inv-button inv-button-solid" href={rsvp} target="_blank" rel="noopener noreferrer"><WhatsAppIcon />Reply on WhatsApp</a>
        </section> : null}

        <footer className="inv-footer inv-reveal">
          <Flourish />
          <p className="inv-kicker">Save the date</p>
          {content.names ? <p className="inv-footer-names">{content.names}</p> : null}
          {date ? <p className="inv-footer-date">{date.long}</p> : null}
          <p className="inv-small">We can&apos;t wait to celebrate with you</p>
          {studioName ? <p className="inv-credit">Invitation by {studioName}</p> : null}
        </footer>
      </div>}
    </main>

    {viewing ? <div className="inv-viewer" role="dialog" aria-label="Photo" onClick={() => setViewing(null)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={viewing} alt="" />
      <button type="button" className="inv-viewer-close" aria-label="Close">×</button>
    </div> : null}
    {song && stage === "open" && !still && !recording ? <button type="button" className={`inv-sound ${playing ? "inv-sound-on" : ""}`} onClick={toggleSound} aria-label={playing ? "Mute the music" : "Play the music"}>
      <span className="inv-bars" aria-hidden="true"><i /><i /><i /><i /></span>
      {!playing ? <svg viewBox="0 0 24 24" aria-hidden="true" className="inv-muted"><path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="m17 9 4 6m0-6-4 6" /></svg> : null}
    </button> : null}
  </div>;
}
