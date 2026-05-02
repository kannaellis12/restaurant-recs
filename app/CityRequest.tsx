"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CITIES } from "@/lib/cities";

/**
 * Locked-input typeahead for "request a city" submissions. The input
 * is gated to Mapbox Geocoding suggestions (types=place, no free-fill)
 * so every saved request has a stable place_id we can group by in the
 * admin queue.
 *
 * Dedup: a localStorage list of submitted place_ids prevents the same
 * browser from spamming the same city. The list also drives the
 * RequestedCityBanner — once one of those cities lands in CITIES, we
 * surface a "your request is now live" link the next time the user
 * shows up.
 */

type StoredRequest = {
  /** Mapbox feature id, e.g. "place.12345". Stable per place across
   *  Mapbox's catalog — primary dedup key. */
  id: string;
  /** Bare city name from Mapbox's `text` field, e.g. "Seattle". Used
   *  to match against CITIES.name when we render the live-banner. */
  city: string;
  place_name: string;
};

const STORAGE_KEY = "ror_city_requests";
const DISMISSED_KEY = "ror_city_request_banner_dismissed";

function readStored<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can fail in private mode; the dedup is best-effort.
  }
}

type MapboxFeature = {
  id: string;
  place_name: string;
  text: string;
  center: [number, number];
  context?: Array<{ id: string; text: string }>;
};

type Suggestion = {
  id: string;
  place_name: string;
  city: string;
  region: string | null;
  country: string | null;
  longitude: number;
  latitude: number;
};

function pickContext(f: MapboxFeature, kind: string): string | null {
  const hit = f.context?.find((c) => c.id.startsWith(`${kind}.`));
  return hit?.text ?? null;
}

/* ---------- The request form ----------------------------------------- */

type CityRequestProps = {
  /** When true, drops the "Don't see your city?" label and shrinks the
   *  input so the widget fits inline in the homepage nav bar. */
  compact?: boolean;
};

export function CityRequest({ compact = false }: CityRequestProps = {}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedCity, setSubmittedCity] = useState<string | null>(null);
  const [duplicateCity, setDuplicateCity] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Click-outside / Escape close the suggestions panel.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Debounced fetch to Mapbox Geocoding. types=place restricts to
  // city-level results so the user can't request a country or a POI.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return;
    const handle = window.setTimeout(async () => {
      try {
        const url =
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
          `?types=place&limit=5&access_token=${token}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as { features?: MapboxFeature[] };
        const out = (data.features ?? []).map<Suggestion>((f) => ({
          id: f.id,
          place_name: f.place_name,
          city: f.text,
          region: pickContext(f, "region"),
          country: pickContext(f, "country"),
          longitude: f.center[0],
          latitude: f.center[1],
        }));
        setSuggestions(out);
        setOpen(out.length > 0);
      } catch {
        // Network / CORS / rate-limit failures are silent — the user
        // will just see no suggestions and can try a different query.
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const onSelect = async (s: Suggestion) => {
    setOpen(false);
    setError(null);
    setQuery(s.place_name);

    const stored = readStored<StoredRequest[]>(STORAGE_KEY, []);
    if (stored.some((r) => r.id === s.id)) {
      setDuplicateCity(s.city);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/city-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          place_id: s.id,
          place_name: s.place_name,
          city: s.city,
          region: s.region,
          country: s.country,
          longitude: s.longitude,
          latitude: s.latitude,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Could not save your request.");
      }
      writeStored(STORAGE_KEY, [
        ...stored,
        { id: s.id, city: s.city, place_name: s.place_name },
      ]);
      setSubmittedCity(s.city);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Once we have a submission (success or duplicate), the form
  // collapses into an editorial confirmation line. Both states resolve
  // to a "request another" reset.
  if (submittedCity || duplicateCity) {
    const isDup = !!duplicateCity;
    const city = (submittedCity ?? duplicateCity)!;
    return (
      <div className="font-mono text-mono-sm uppercase tracking-[0.04em] text-ink-3 flex items-baseline gap-2 flex-wrap">
        <span className="text-accent">●</span>
        <span className="text-ink">
          {isDup
            ? `You've already requested ${city}.`
            : `Got it — ${city} added to the queue.`}
        </span>
        <button
          type="button"
          onClick={() => {
            setQuery("");
            setSuggestions([]);
            setSubmittedCity(null);
            setDuplicateCity(null);
          }}
          className="text-accent hover:text-accent-deep cursor-pointer"
        >
          Request another →
        </button>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setError(null);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        placeholder="Request a city…"
        aria-label="Request a city"
        autoComplete="off"
        spellCheck={false}
        disabled={submitting}
        className={
          compact
            ? "w-full font-mono text-mono-sm uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-3 border border-rule-strong bg-paper px-2.5 py-1 text-ink focus:outline-none focus:border-ink disabled:opacity-60"
            : "w-full font-mono text-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-3 border border-rule-strong bg-paper px-3 py-2 text-ink focus:outline-none focus:border-ink disabled:opacity-60"
        }
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 z-30 max-h-72 overflow-y-auto bg-paper border border-rule-strong shadow-md"
        >
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s)}
                className="w-full text-left px-3 py-2 hover:bg-paper-2 cursor-pointer font-body text-body-sm text-ink"
              >
                {s.place_name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-2 font-mono text-mono-sm uppercase tracking-[0.04em] text-flag">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- Live-city banner ----------------------------------------- */

/**
 * Surfaces a "your requested city is now live" banner the next time
 * the user visits, if any of their previously-submitted requests has
 * since landed in CITIES. Match is case-insensitive on city name —
 * Mapbox's `text` field reliably matches the editorial city name we
 * store in `lib/cities.ts` for our covered cities.
 *
 * Renders nothing on the server (no localStorage) to avoid a
 * hydration mismatch — the banner pops in after first paint.
 */
export function RequestedCityBanner() {
  const [mounted, setMounted] = useState(false);
  const [matches, setMatches] = useState<Array<{ slug: string; name: string; reqId: string }>>([]);

  useEffect(() => {
    setMounted(true);
    const stored = readStored<StoredRequest[]>(STORAGE_KEY, []);
    const dismissed = readStored<string[]>(DISMISSED_KEY, []);
    const live: Array<{ slug: string; name: string; reqId: string }> = [];
    for (const req of stored) {
      if (dismissed.includes(req.id)) continue;
      const hit = CITIES.find(
        (c) => c.name.toLowerCase() === req.city.toLowerCase(),
      );
      if (hit) live.push({ slug: hit.slug, name: hit.name, reqId: req.id });
    }
    setMatches(live);
  }, []);

  // Track dismissals via localStorage so the banner stays gone across
  // visits, not just the current session.
  const dismiss = useMemo(
    () => (reqId: string) => {
      const dismissed = readStored<string[]>(DISMISSED_KEY, []);
      if (!dismissed.includes(reqId)) {
        writeStored(DISMISSED_KEY, [...dismissed, reqId]);
      }
      setMatches((prev) => prev.filter((m) => m.reqId !== reqId));
    },
    [],
  );

  if (!mounted || matches.length === 0) return null;

  return (
    <div className="border-b border-rule bg-accent-soft">
      {matches.map((m) => (
        <div
          key={m.reqId}
          className="px-4 sm:px-6 py-2 flex items-center justify-between gap-3"
        >
          <p className="font-mono text-mono-sm uppercase tracking-[0.04em] text-accent-deep min-w-0 truncate">
            <span className="text-accent mr-2">●</span>
            Your requested city,{" "}
            <Link
              href={`/${m.slug}`}
              className="text-ink underline decoration-rule-strong underline-offset-[3px] hover:decoration-ink"
            >
              {m.name}
            </Link>
            , is now live.
          </p>
          <button
            type="button"
            onClick={() => dismiss(m.reqId)}
            aria-label={`Dismiss ${m.name} announcement`}
            className="shrink-0 text-accent-deep hover:text-ink cursor-pointer text-base leading-none p-1"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
