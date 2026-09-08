import { t, type Locale } from '@/lib/i18n';

type FeatureKey = 'timeTravel' | 'lifeJourney' | 'autoOrganize';

/**
 * Frank #0906 round-13 (P2 #9): features section upgrade.
 *
 * The original features section was three tiny cards with an
 * emoji + title + a one-line body. P2 #9 asked for real
 * screenshots / demos — Frank didn't want to manage per-page
 * screenshot assets, so this renders three inline SVG mockups
 * that show what the feature actually looks like.
 *
 *   - timeTravel: a video-player timeline with cyan playhead
 *     and three photo thumbnails appearing as the year
 *     progresses (1990 → 2026).
 *   - lifeJourney: a stylized globe with 7 photo markers
 *     clustered around the user's photo locations.
 *   - autoOrganize: a 4-cell upload grid where each photo
 *     gets an auto-tagged chip (📍 Beijing, 📷 Canon, 🌳
 *     Scenery) — what the EXIF pipeline produces on upload.
 *
 * All three are pure SVG, no JS animation, dark-mode-aware.
 * Light-mode colors: black/dark gray. Dark-mode colors: white
 * / light gray via Tailwind `dark:` variants.
 */
export function FeaturesGrid({ locale }: { locale: Locale }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      <FeatureCard
        locale={locale}
        featureKey="timeTravel"
        demo={<TimeTravelDemo />}
      />
      <FeatureCard
        locale={locale}
        featureKey="lifeJourney"
        demo={<LifeJourneyDemo />}
      />
      <FeatureCard
        locale={locale}
        featureKey="autoOrganize"
        demo={<AutoOrganizeDemo />}
      />
    </div>
  );
}

function FeatureCard({
  locale,
  featureKey,
  demo,
}: {
  locale: Locale;
  featureKey: FeatureKey;
  demo: React.ReactNode;
}) {
  const title = t(
    locale,
    `features.${featureKey}.title` as
      | 'features.timeTravel.title'
      | 'features.lifeJourney.title'
      | 'features.autoOrganize.title',
  );
  const body = t(
    locale,
    `features.${featureKey}.body` as
      | 'features.timeTravel.body'
      | 'features.lifeJourney.body'
      | 'features.autoOrganize.body',
  );
  const demoLabel = t(locale, `features.${featureKey}.demoLabel` as
    | 'features.timeTravel.demoLabel'
    | 'features.lifeJourney.demoLabel'
    | 'features.autoOrganize.demoLabel');
  const icon = {
    timeTravel: '⏳',
    lifeJourney: '🌏',
    autoOrganize: '📷',
  }[featureKey];
  return (
    <article className="overflow-hidden rounded-lg border border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.02]">
      <div className="border-b border-black/10 bg-black/[0.04] px-4 py-3 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl" aria-hidden="true">
              {icon}
            </span>
            <h3 className="text-base font-medium text-black dark:text-white">
              {title}
            </h3>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-black/40 dark:text-white/40">
            {demoLabel}
          </span>
        </div>
      </div>
      {/* SVG demo frame — fixed 16:10 aspect ratio so all three
          cards line up regardless of the inner content. */}
      <div className="aspect-[16/10] w-full overflow-hidden bg-white dark:bg-black">
        {demo}
      </div>
      <div className="p-5">
        <p className="text-sm leading-relaxed text-black/70 dark:text-white/75">
          {body}
        </p>
      </div>
    </article>
  );
}

// ─── Demo 1: Time Travel timeline ──────────────────────────────────────

function TimeTravelDemo() {
  return (
    <svg
      viewBox="0 0 320 200"
      className="h-full w-full"
      role="img"
      aria-label="Time Travel demo"
    >
      {/* Mini "browser" window header */}
      <rect x="0" y="0" width="320" height="22" className="fill-black/5 dark:fill-white/5" />
      <circle cx="10" cy="11" r="3" className="fill-rose-400/70" />
      <circle cx="20" cy="11" r="3" className="fill-amber-400/70" />
      <circle cx="30" cy="11" r="3" className="fill-emerald-400/70" />
      <text
        x="160"
        y="14"
        textAnchor="middle"
        fontSize="9"
        className="fill-black/50 dark:fill-white/50"
      >
        TimeTravel · 1990 → 2026
      </text>
      {/* Year labels at top */}
      <text
        x="20"
        y="38"
        fontSize="8"
        className="fill-black/40 dark:fill-white/40"
      >
        1990
      </text>
      <text
        x="300"
        y="38"
        fontSize="8"
        textAnchor="end"
        className="fill-black/40 dark:fill-white/40"
      >
        2026
      </text>
      {/* Cyan range overlay (selected window) */}
      <rect
        x="140"
        y="46"
        width="100"
        height="10"
        rx="5"
        className="fill-cyan-500/30 dark:fill-cyan-400/30"
      />
      {/* Timeline bar */}
      <rect
        x="20"
        y="48"
        width="280"
        height="6"
        rx="3"
        className="fill-black/10 dark:fill-white/15"
      />
      {/* Photo chapter ticks */}
      {(
        [
          [40, 1992],
          [70, 1996],
          [110, 2002],
          [155, 2008],
          [195, 2013],
          [230, 2017],
          [270, 2022],
        ] as Array<[number, number]>
      ).map(([x, year]) => (
        <line
          key={year}
          x1={x}
          y1="46"
          x2={x}
          y2="56"
          strokeWidth="1.5"
          className="stroke-cyan-600/80 dark:stroke-cyan-400/80"
        />
      ))}
      {/* Playhead */}
      <circle
        cx="190"
        cy="51"
        r="5"
        className="fill-cyan-500 dark:fill-cyan-400"
      />
      {/* Date label above playhead */}
      <text
        x="190"
        y="72"
        textAnchor="middle"
        fontSize="9"
        className="fill-black/70 dark:fill-white/70"
      >
        2013.03
      </text>
      {/* Three photo thumbnails popping up above the bar */}
      {[150, 190, 230].map((x, i) => (
        <g key={i}>
          <rect
            x={x - 14}
            y="86"
            width="28"
            height="28"
            rx="3"
            className="fill-black/10 stroke-black/15 dark:fill-white/10 dark:stroke-white/20"
          />
          {/* Stylized photo content */}
          <rect
            x={x - 12}
            y="88"
            width="24"
            height="20"
            rx="2"
            className={
              i === 0
                ? 'fill-amber-300/70 dark:fill-amber-500/40'
                : i === 1
                  ? 'fill-emerald-300/70 dark:fill-emerald-500/40'
                  : 'fill-sky-300/70 dark:fill-sky-500/40'
            }
          />
        </g>
      ))}
      {/* Playback row at bottom */}
      <g transform="translate(0,160)">
        <circle cx="160" cy="0" r="11" className="fill-black dark:fill-white" />
        <polygon
          points="156,-5 156,5 166,0"
          className="fill-white dark:fill-black"
        />
        <text
          x="20"
          y="3"
          fontSize="8"
          className="fill-black/50 dark:fill-white/50"
        >
          ⏮
        </text>
        <text
          x="300"
          y="3"
          textAnchor="end"
          fontSize="8"
          className="fill-black/50 dark:fill-white/50"
        >
          ⏭
        </text>
        {/* Speed pills */}
        <g transform="translate(220,-12)">
          <rect
            width="80"
            height="20"
            rx="10"
            className="fill-black/5 dark:fill-white/10"
          />
          <rect
            x="2"
            y="2"
            width="18"
            height="16"
            rx="8"
            className="fill-black dark:fill-white"
          />
          <text
            x="11"
            y="14"
            textAnchor="middle"
            fontSize="8"
            className="fill-white dark:fill-black"
          >
            1×
          </text>
          <text
            x="30"
            y="14"
            fontSize="8"
            className="fill-black/55 dark:fill-white/55"
          >
            2×
          </text>
          <text
            x="49"
            y="14"
            fontSize="8"
            className="fill-black/55 dark:fill-white/55"
          >
            4×
          </text>
          <text
            x="68"
            y="14"
            fontSize="8"
            className="fill-black/55 dark:fill-white/55"
          >
            0.5×
          </text>
        </g>
      </g>
    </svg>
  );
}

// ─── Demo 2: Life Journey globe ───────────────────────────────────────

function LifeJourneyDemo() {
  return (
    <svg
      viewBox="0 0 320 200"
      className="h-full w-full"
      role="img"
      aria-label="Life Journey demo"
    >
      {/* Mini "browser" window header */}
      <rect x="0" y="0" width="320" height="22" className="fill-black/5 dark:fill-white/5" />
      <circle cx="10" cy="11" r="3" className="fill-rose-400/70" />
      <circle cx="20" cy="11" r="3" className="fill-amber-400/70" />
      <circle cx="30" cy="11" r="3" className="fill-emerald-400/70" />
      <text
        x="160"
        y="14"
        textAnchor="middle"
        fontSize="9"
        className="fill-black/50 dark:fill-white/50"
      >
        LifeJourney · 7 地点 · 224 张照片
      </text>
      {/* Globe outline */}
      <circle
        cx="160"
        cy="120"
        r="70"
        className="fill-black/[0.04] stroke-black/20 dark:fill-white/[0.06] dark:stroke-white/25"
        strokeWidth="1"
      />
      {/* Latitude/longitude grid */}
      <ellipse
        cx="160"
        cy="120"
        rx="70"
        ry="22"
        className="fill-none stroke-black/15 dark:stroke-white/20"
        strokeWidth="0.5"
      />
      <ellipse
        cx="160"
        cy="120"
        rx="70"
        ry="44"
        className="fill-none stroke-black/15 dark:stroke-white/20"
        strokeWidth="0.5"
      />
      <line
        x1="90"
        y1="120"
        x2="230"
        y2="120"
        className="stroke-black/15 dark:stroke-white/20"
        strokeWidth="0.5"
      />
      <line
        x1="160"
        y1="50"
        x2="160"
        y2="190"
        className="stroke-black/15 dark:stroke-white/20"
        strokeWidth="0.5"
      />
      {/* Stylized continents — three abstract blobs so the SVG
          doesn't try to render real cartography */}
      <path
        d="M120 95 Q130 85 145 90 Q155 95 150 110 Q140 120 125 115 Q115 105 120 95Z"
        className="fill-black/15 dark:fill-white/25"
      />
      <path
        d="M170 105 Q190 100 205 115 Q200 135 180 130 Q165 120 170 105Z"
        className="fill-black/15 dark:fill-white/25"
      />
      <path
        d="M105 140 Q120 135 130 150 Q125 165 110 162 Q98 152 105 140Z"
        className="fill-black/15 dark:fill-white/25"
      />
      {/* Photo markers (cyan dots, with cluster badge variation) */}
      {(
        [
          [120, 100, 1, 'Tokyo'],
          [145, 95, 47, 'Beijing'],
          [185, 115, 1, 'Seoul'],
          [200, 120, 1, 'Shenzhen'],
          [115, 150, 12, 'Hong Kong'],
          [170, 145, 1, 'Taipei'],
          [195, 140, 3, 'Osaka'],
        ] as Array<[number, number, number, string]>
      ).map(([x, y, count, label]) => {
        const isCluster = count > 1;
        return (
          <g key={label}>
            {isCluster ? (
              <>
                <circle
                  cx={x}
                  cy={y}
                  r="8"
                  className="fill-cyan-500 dark:fill-cyan-400"
                />
                <text
                  x={x}
                  y={y + 3}
                  textAnchor="middle"
                  fontSize="8"
                  fontWeight="bold"
                  className="fill-white dark:fill-black"
                >
                  {count}
                </text>
              </>
            ) : (
              <circle
                cx={x}
                cy={y}
                r="4"
                className="fill-cyan-500 dark:fill-cyan-400"
              />
            )}
            <text
              x={x}
              y={y - 12}
              textAnchor="middle"
              fontSize="7"
              className="fill-black/65 dark:fill-white/65"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Demo 3: Auto Organize EXIF pipeline ──────────────────────────────

function AutoOrganizeDemo() {
  return (
    <svg
      viewBox="0 0 320 200"
      className="h-full w-full"
      role="img"
      aria-label="Auto Organize demo"
    >
      {/* Mini "browser" window header */}
      <rect x="0" y="0" width="320" height="22" className="fill-black/5 dark:fill-white/5" />
      <circle cx="10" cy="11" r="3" className="fill-rose-400/70" />
      <circle cx="20" cy="11" r="3" className="fill-amber-400/70" />
      <circle cx="30" cy="11" r="3" className="fill-emerald-400/70" />
      <text
        x="160"
        y="14"
        textAnchor="middle"
        fontSize="9"
        className="fill-black/50 dark:fill-white/50"
      >
        Auto-Organize · EXIF + GPS
      </text>
      {/* 2×2 photo grid */}
      {(
        [
          [40, 40, 'fill-amber-300/70 dark:fill-amber-500/40', 'beijing'],
          [170, 40, 'fill-emerald-300/70 dark:fill-emerald-500/40', 'tokyo'],
          [40, 130, 'fill-sky-300/70 dark:fill-sky-500/40', 'shenzhen'],
          [170, 130, 'fill-fuchsia-300/70 dark:fill-fuchsia-500/40', 'osaka'],
        ] as Array<[number, number, string, string]>
      ).map(([x, y, color, loc]) => (
        <g key={loc}>
          <rect
            x={x}
            y={y}
            width="110"
            height="80"
            rx="6"
            className={`${color} stroke-black/10 dark:stroke-white/10`}
          />
          {/* Auto-tag chips below the photo */}
          <g transform={`translate(${x}, ${y + 84})`}>
            {/* Location chip */}
            <rect
              width="60"
              height="14"
              rx="7"
              className="fill-black/5 dark:fill-white/10"
            />
            <text
              x="30"
              y="10"
              textAnchor="middle"
              fontSize="7"
              className="fill-black/70 dark:fill-white/70"
            >
              📍 {loc}
            </text>
            {/* Date chip */}
            <rect
              x="62"
              width="48"
              height="14"
              rx="7"
              className="fill-black/5 dark:fill-white/10"
            />
            <text
              x="86"
              y="10"
              textAnchor="middle"
              fontSize="7"
              className="fill-black/70 dark:fill-white/70"
            >
              📅 2013.03
            </text>
          </g>
        </g>
      ))}
      {/* Bottom annotation */}
      <text
        x="160"
        y="195"
        textAnchor="middle"
        fontSize="7"
        className="fill-black/40 dark:fill-white/40"
      >
        自动读取 · EXIF 拍摄时间 + GPS + 相机
      </text>
    </svg>
  );
}
