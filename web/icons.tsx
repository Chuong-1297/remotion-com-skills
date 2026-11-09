import React from 'react';

// Small stroke icon set (Lucide-style paths, ISC). No emoji in the UI.
type P = { size?: number; className?: string };
const make =
  (paths: React.ReactNode) =>
  ({ size = 18, className }: P) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths}
    </svg>
  );

export const IconPlus = make(<path d="M12 5v14M5 12h14" />);
export const IconSparkles = make(
  <>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </>,
);
export const IconImage = make(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="M21 15l-3.1-3.1a2 2 0 00-2.8 0L6 21" />
  </>,
);
export const IconFilm = make(
  <>
    <rect x="2" y="3" width="20" height="18" rx="2" />
    <path d="M7 3v18M17 3v18M2 8h5M2 16h5M17 8h5M17 16h5" />
  </>,
);
export const IconType = make(<path d="M4 7V4h16v3M9 20h6M12 4v16" />);
export const IconLayers = make(
  <>
    <path d="M12 2l10 5-10 5L2 7z" />
    <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
  </>,
);
export const IconArrowRight = make(<path d="M5 12h14M12 5l7 7-7 7" />);
export const IconArrowLeft = make(<path d="M19 12H5M12 19l-7-7 7-7" />);
export const IconTrash = make(<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />);
export const IconDownload = make(<path d="M12 3v12M7 10l5 5 5-5M5 21h14" />);
export const IconSettings = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </>,
);
export const IconScissors = make(
  <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
  </>,
);
export const IconCopy = make(
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </>,
);
export const IconUpload = make(<path d="M12 21V9M7 14l5-5 5 5M5 3h14" />);
export const IconX = make(<path d="M18 6L6 18M6 6l12 12" />);
export const IconExpand = make(<path d="M5 12h14M15 6l6 6-6 6M3 6v12" />);
export const IconFrame = make(
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 9h18" />
  </>,
);
export const IconGrid = make(
  <>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
  </>,
);
export const IconTimeline = make(
  <>
    <rect x="2" y="14" width="6" height="6" rx="1" />
    <rect x="9" y="14" width="6" height="6" rx="1" />
    <rect x="16" y="14" width="6" height="6" rx="1" />
    <path d="M2 4h20M2 9h12" />
  </>,
);
export const IconAlert = make(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8v4M12 16h.01" />
  </>,
);
export const IconPerson = make(
  <>
    <circle cx="12" cy="4.5" r="2" />
    <path d="M12 7v6M8 21l4-8 4 8M6 10l6-2 6 2" />
  </>,
);
export const IconWand = make(<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" />);
