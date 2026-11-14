import type { ReactNode } from "react";

// デザインのキャンバスで使っているアイコン。装飾なので、読み上げからは外す。
type IconSpec = {
  readonly paths: ReactNode;
  readonly strokeWidth?: number;
  readonly filled?: boolean;
};

const ICONS = {
  database: {
    strokeWidth: 1.8,
    paths: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
        <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
      </>
    ),
  },
  chevronDown: { strokeWidth: 2.4, paths: <path d="m6 9 6 6 6-6" /> },
  chevronRight: { strokeWidth: 2.4, paths: <path d="m9 6 6 6-6 6" /> },
  chevronLeft: { strokeWidth: 2, paths: <path d="m15 18-6-6 6-6" /> },
  pageNext: { strokeWidth: 2, paths: <path d="m9 6 6 6-6 6" /> },
  search: {
    strokeWidth: 2,
    paths: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
  },
  table: {
    strokeWidth: 1.8,
    paths: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M9 10v10" />
      </>
    ),
  },
  view: {
    strokeWidth: 1.8,
    paths: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  lock: {
    strokeWidth: 2,
    paths: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </>
    ),
  },
  play: {
    filled: true,
    paths: <path d="M7 4.5v15a1 1 0 0 0 1.5.87l12-7.5a1 1 0 0 0 0-1.74l-12-7.5A1 1 0 0 0 7 4.5Z" />,
  },
  stop: { filled: true, paths: <rect x="5" y="5" width="14" height="14" rx="2" /> },
  plus: { strokeWidth: 2.2, paths: <path d="M12 5v14M5 12h14" /> },
  close: { strokeWidth: 2.2, paths: <path d="M6 6l12 12M18 6 6 18" /> },
  copy: {
    strokeWidth: 1.8,
    paths: (
      <>
        <rect x="9" y="9" width="12" height="12" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </>
    ),
  },
  alert: {
    strokeWidth: 2,
    paths: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </>
    ),
  },
  warning: {
    strokeWidth: 2,
    paths: (
      <>
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </>
    ),
  },
} satisfies Record<string, IconSpec>;

export type IconName = keyof typeof ICONS;

export function Icon(props: {
  readonly name: IconName;
  readonly size?: number;
  readonly className?: string;
}) {
  const { name, size = 14, className } = props;
  const spec: IconSpec = ICONS[name];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={spec.filled ? "currentColor" : "none"}
      stroke={spec.filled ? "none" : "currentColor"}
      strokeWidth={spec.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {spec.paths}
    </svg>
  );
}
