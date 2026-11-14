import type { ReactNode } from "react";

export type IconName =
  | "activity"
  | "inbox"
  | "message"
  | "search"
  | "server"
  | "sliders"
  | "arrow-left"
  | "sun"
  | "moon"
  | "x"
  | "chevron-left"
  | "chevron-right"
  | "terminal"
  | "code"
  | "file"
  | "file-plus"
  | "pencil"
  | "globe"
  | "bot"
  | "image"
  | "layers"
  | "bulb";

const PATHS: Record<IconName, ReactNode> = {
  activity: <path d="M3 12h4l2.5-7 4 14 2.5-7H21" />,
  inbox: (
    <>
      <path d="M4 13V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7" />
      <path d="M4 13h4l2 3h4l2-3h4v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z" />
    </>
  ),
  message: (
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  server: (
    <>
      <rect x="4" y="4" width="16" height="6" rx="1.5" />
      <rect x="4" y="14" width="16" height="6" rx="1.5" />
      <path d="M8 7h.01M8 17h.01" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h4m4 0h8M4 17h10m4 0h2" />
      <circle cx="10" cy="7" r="2" />
      <circle cx="16" cy="17" r="2" />
    </>
  ),
  "arrow-left": <path d="M19 12H5m7 7-7-7 7-7" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
    </>
  ),
  moon: <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  "chevron-left": <path d="m15 18-6-6 6-6" />,
  "chevron-right": <path d="m9 18 6-6-6-6" />,
  terminal: (
    <>
      <path d="M4 6h16v13H4z" />
      <path d="M8 11l2 2-2 2" />
      <path d="M13 15h3" />
    </>
  ),
  code: (
    <>
      <path d="M9 8l-4 4 4 4" />
      <path d="M15 8l4 4-4 4" />
      <path d="M13 5l-2 14" />
    </>
  ),
  file: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M10 12h6M10 16h6" />
    </>
  ),
  "file-plus": (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M12 12v5M9.5 14.5h5" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L18 10l-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4a14 14 0 0 1 0 16 14 14 0 0 1 0-16" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 4v4" />
      <circle cx="12" cy="3.4" r="1" />
      <path d="M9 13h.01M15 13h.01M9.5 16h5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 15l-5-4-6 6" />
    </>
  ),
  layers: (
    <>
      <path d="M12 4 3 9l9 5 9-5-9-5z" />
      <path d="M3 14l9 5 9-5" />
    </>
  ),
  bulb: (
    <>
      <path d="M12 3a5 5 0 0 0-3 9v2h6v-2a5 5 0 0 0-3-9z" />
      <path d="M10 18h4M10.5 21h3" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
