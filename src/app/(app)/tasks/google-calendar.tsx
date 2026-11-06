"use client";

import { useState } from "react";
import { small } from "@/components/form-styles";

/** Subscribe Google Calendar to the feed (opens Google's "add calendar" for the signed-in Gmail), or copy its address. */
export function GoogleCalendarButtons({ feed }: { feed: string }) {
  const [copied, setCopied] = useState(false);
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(feed.replace(/^https:/, "webcal:"))}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={google} target="_blank" rel="noreferrer" className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-hover)]">Add to Google Calendar</a>
      <button type="button" className={small} onClick={async () => { await navigator.clipboard.writeText(feed); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
        {copied ? "Copied" : "Copy the address"}
      </button>
    </div>
  );
}
