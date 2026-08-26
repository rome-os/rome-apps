import { useEffect, useState } from "react";
import { fetchGithubUserProfile, peekGithubAvatarUrl, withAvatarSize } from "@/lib/helpers";

/** Retina pixel size we request from the avatar CDN (one canonical size → one cache entry). */
const AVATAR_CDN_SIZE = 160;

/**
 * The Rome logo, used as the universal avatar placeholder. Fills the container
 * (which clips it to a square or circle via `rounded` + `overflow-hidden`), so
 * an unresolved/failed avatar shows a recognizable Rome tile instead of a
 * generic silhouette.
 */
function DefaultAvatarGlyph() {
  return (
    <svg viewBox="0 0 52 52" fill="none" className="h-full w-full" aria-hidden="true">
      <rect width="52" height="52" rx="12" fill="white" />
      <g transform="translate(6 7.38) scale(0.784)" fill="#1a1a1a">
        <path d="M9.27213 35.3331H38.9233C41.3072 35.3331 43.5668 34.27 45.0866 32.4335L48.0715 28.8265C48.7983 27.9482 49.1158 26.8016 48.9444 25.6747L45.8596 5.39837C45.5623 3.44405 43.8819 2 41.9051 2H16.9889C14.4932 2 12.1405 3.16467 10.6273 5.14922L2.81921 15.3892C2.19692 16.2053 1.91212 17.2294 2.02374 18.2496L3.30773 29.9857C3.64065 33.0287 6.21098 35.3331 9.27213 35.3331Z" />
        <path d="M41.9056 0C44.8706 0.000307729 47.3913 2.16638 47.8373 5.09766L50.9213 25.374C51.1784 27.0644 50.7027 28.7843 49.6127 30.1016L46.6273 33.709C44.7276 36.0044 41.9028 37.333 38.9232 37.333H9.27185C5.19048 37.3328 1.76359 34.2603 1.3197 30.2031L0.0355225 18.4668C-0.131792 16.9367 0.295602 15.4008 1.22888 14.1768L9.03748 3.93652C10.929 1.45612 13.8693 0.000108882 16.9886 0H41.9056ZM16.9886 4C15.1171 4.00011 13.353 4.87404 12.2181 6.3623L4.40955 16.6016C4.0984 17.0096 3.95628 17.5221 4.01208 18.0322L5.29626 29.7686C5.51839 31.7969 7.23139 33.3328 9.27185 33.333H38.9232C40.711 33.333 42.4065 32.5356 43.5463 31.1582L46.5306 27.5518C46.8939 27.1127 47.0528 26.539 46.9672 25.9756L43.8822 5.69922C43.7336 4.72226 42.8938 4.00031 41.9056 4H16.9886Z" />
        <path d="M12.3794 47.5269C12.3794 45.5392 12.7709 43.571 13.5315 41.7347C14.2922 39.8983 15.4071 38.2298 16.8126 36.8243C18.218 35.4188 19.8866 34.3039 21.7229 33.5433C23.5593 32.7826 25.5275 32.3911 27.5151 32.3911C29.5028 32.3911 31.471 32.7826 33.3073 33.5433C35.1437 34.3039 36.8122 35.4188 38.2177 36.8243C39.6232 38.2298 40.7381 39.8983 41.4987 41.7347C42.2594 43.571 42.6509 45.5392 42.6509 47.5269L12.3794 47.5269Z" />
        <path d="M13.5613 6.47284L15.7849 25.1512C16.0244 27.1632 17.7306 28.6784 19.7568 28.6784H44.6983C47.1437 28.6784 49.0167 26.5036 48.6541 24.0853L45.8536 5.40689C45.56 3.4487 43.8779 2 41.8978 2H17.5333C15.1367 2 13.278 4.09306 13.5613 6.47284Z" fill="white" stroke="#1a1a1a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M35.2279 11.8394H38.2279L36.6069 15.2237L39.2279 18.8394H36.2279L33.8544 15.2237L35.2279 11.8394Z" stroke="#1a1a1a" strokeWidth="2" strokeLinejoin="round" />
        <path d="M25.5321 11.8394H28.5321L29.5321 18.8394H26.5321L25.5321 11.8394Z" stroke="#1a1a1a" strokeWidth="2" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/**
 * A GitHub avatar that resolves to the **direct CDN URL**
 * (`avatars.githubusercontent.com/u/<id>?s=…&v=4`) rather than the
 * `github.com/<login>.png` redirect, which is `cache-control: no-cache` and slow
 * to reach from some regions. Resolution is cached at every layer:
 *
 * - seeded synchronously from localStorage (`peekGithubAvatarUrl`) so a seen
 *   avatar paints with no flash;
 * - otherwise resolved via `fetchGithubUserProfile` (in-flight dedupe +
 *   localStorage cache + server-side cache behind the `github-users` endpoint);
 * - the CDN image itself is long-cacheable, so a single canonical size keeps the
 *   browser HTTP cache warm.
 *
 * The inline Rome-logo glyph sits underneath as the base layer, so there is
 * never a white blank while loading or on failure.
 */
export function GithubAvatar({
  login,
  size = 40,
  rounded = "rounded-lg",
  className = "",
}: {
  login: string | null | undefined;
  size?: number;
  rounded?: string;
  className?: string;
}) {
  const clean = (login || "").trim();
  const [src, setSrc] = useState<string | null>(() => (clean ? peekGithubAvatarUrl(clean, AVATAR_CDN_SIZE) : null));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const seeded = clean ? peekGithubAvatarUrl(clean, AVATAR_CDN_SIZE) : null;
    setSrc(seeded);
    if (!clean || seeded) return; // nothing to resolve, or already cached
    fetchGithubUserProfile(clean)
      .then((profile) => {
        if (cancelled) return;
        setSrc(profile.avatarUrl ? withAvatarSize(profile.avatarUrl, AVATAR_CDN_SIZE) : null);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [clean]);

  const showImg = !!src && !failed;

  return (
    <div
      style={{ width: size, height: size }}
      className={`relative shrink-0 overflow-hidden bg-muted ${rounded} ${className}`}
    >
      <DefaultAvatarGlyph />
      {showImg && (
        <img
          src={src}
          alt={`@${clean}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}
