// One-off generator: renders a curated, categorized subset of Tabler Icons
// (MIT licensed) to static SVG files under public/static/icons/, plus a JSON
// index the editor's icon search reads. Not part of the app build — run
// manually with `node scripts/generate-tabler-icons.cjs` whenever the
// curated list changes.
//
// Two weight folders only (outline/filled) — Tabler ships two real visual
// styles, unlike the app's older 6-weight (thin/light/regular/bold/fill/
// duotone) scheme built for a different icon set. IconsEditor.tsx maps its
// 6 weight buttons onto these two folders.

const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const TablerIcons = require("@tabler/icons-react");

const OUT_DIR = path.join(__dirname, "..", "public", "static", "icons");
const BASE_COLOR = "#111827";

// name: the bare icon name (kebab-case, matches Tabler's own file naming).
// tabler: the PascalCase export name in @tabler/icons-react (outline).
// Filled variant is looked up as `${tabler}Filled` — skipped if absent.
const CATEGORIES = [
  {
    id: "business",
    label: "Business & Finance",
    icons: [
      ["briefcase", "IconBriefcase"],
      ["chart-bar", "IconChartBar"],
      ["chart-line", "IconChartLine"],
      ["chart-pie", "IconChartPie"],
      ["coin", "IconCoin"],
      ["credit-card", "IconCreditCard"],
      ["trending-up", "IconTrendingUp"],
      ["trending-down", "IconTrendingDown"],
      ["building-bank", "IconBuildingBank"],
      ["building-skyscraper", "IconBuildingSkyscraper"],
      ["receipt", "IconReceipt"],
      ["target", "IconTarget"],
      ["presentation", "IconPresentation"],
      ["report-money", "IconReportMoney"],
      ["wallet", "IconWallet"],
      ["shopping-cart", "IconShoppingCart"],
      ["gift", "IconGift"],
      ["scale", "IconScale"],
    ],
  },
  {
    id: "communication",
    label: "Communication",
    icons: [
      ["mail", "IconMail"],
      ["phone", "IconPhone"],
      ["message", "IconMessage"],
      ["message-circle", "IconMessageCircle"],
      ["send", "IconSend"],
      ["at", "IconAt"],
      ["bell-ringing", "IconBellRinging"],
      ["microphone", "IconMicrophone"],
      ["video", "IconVideo"],
      ["headset", "IconHeadset"],
      ["speakerphone", "IconSpeakerphone"],
      ["share", "IconShare"],
      ["world", "IconWorld"],
    ],
  },
  {
    id: "people",
    label: "People & Team",
    icons: [
      ["user", "IconUser"],
      ["users", "IconUsers"],
      ["user-plus", "IconUserPlus"],
      ["user-circle", "IconUserCircle"],
      ["users-group", "IconUsersGroup"],
      ["user-check", "IconUserCheck"],
      ["crown", "IconCrown"],
      ["id-badge2", "IconIdBadge2"],
    ],
  },
  {
    id: "technology",
    label: "Technology",
    icons: [
      ["device-laptop", "IconDeviceLaptop"],
      ["device-mobile", "IconDeviceMobile"],
      ["cloud", "IconCloud"],
      ["database", "IconDatabase"],
      ["server", "IconServer"],
      ["code", "IconCode"],
      ["wifi", "IconWifi"],
      ["robot", "IconRobot"],
      ["cpu", "IconCpu"],
      ["bug", "IconBug"],
      ["shield-lock", "IconShieldLock"],
      ["plug", "IconPlug"],
      ["settings", "IconSettings"],
      ["bolt", "IconBolt"],
    ],
  },
  {
    id: "files",
    label: "Files & Documents",
    icons: [
      ["file", "IconFile"],
      ["file-text", "IconFileText"],
      ["folder", "IconFolder"],
      ["clipboard", "IconClipboard"],
      ["clipboard-check", "IconClipboardCheck"],
      ["printer", "IconPrinter"],
      ["download", "IconDownload"],
      ["upload", "IconUpload"],
      ["paperclip", "IconPaperclip"],
      ["book", "IconBook"],
      ["notebook", "IconNotebook"],
      ["file-spreadsheet", "IconFileSpreadsheet"],
    ],
  },
  {
    id: "arrows",
    label: "Arrows & Navigation",
    icons: [
      ["arrow-right", "IconArrowRight"],
      ["arrow-left", "IconArrowLeft"],
      ["arrow-up", "IconArrowUp"],
      ["arrow-down", "IconArrowDown"],
      ["arrow-narrow-right", "IconArrowNarrowRight"],
      ["chevron-right", "IconChevronRight"],
      ["refresh", "IconRefresh"],
      ["arrows-exchange", "IconArrowsExchange"],
      ["corner-down-right", "IconCornerDownRight"],
      ["arrow-big-right", "IconArrowBigRight"],
      ["route", "IconRoute"],
    ],
  },
  {
    id: "data",
    label: "Charts & Data",
    icons: [
      ["chart-area", "IconChartArea"],
      ["chart-dots", "IconChartDots"],
      ["chart-donut", "IconChartDonut"],
      ["table", "IconTable"],
      ["list-details", "IconListDetails"],
      ["gauge", "IconGauge"],
      ["percentage", "IconPercentage"],
      ["stack-2", "IconStack2"],
    ],
  },
  {
    id: "media",
    label: "Media",
    icons: [
      ["photo", "IconPhoto"],
      ["camera", "IconCamera"],
      ["movie", "IconMovie"],
      ["music", "IconMusic"],
      ["player-play", "IconPlayerPlay"],
      ["volume", "IconVolume"],
      ["mic-2", "IconMicrophone2"],
      ["palette", "IconPalette"],
      ["brush", "IconBrush"],
    ],
  },
  {
    id: "time",
    label: "Time & Planning",
    icons: [
      ["calendar", "IconCalendar"],
      ["clock", "IconClock"],
      ["hourglass", "IconHourglass"],
      ["alarm", "IconAlarm"],
      ["calendar-event", "IconCalendarEvent"],
      ["checklist", "IconChecklist"],
      ["flag", "IconFlag"],
      ["map-pin", "IconMapPin"],
    ],
  },
  {
    id: "symbols",
    label: "Symbols & Status",
    icons: [
      ["check", "IconCheck"],
      ["x", "IconX"],
      ["alert-triangle", "IconAlertTriangle"],
      ["info-circle", "IconInfoCircle"],
      ["star", "IconStar"],
      ["heart", "IconHeart"],
      ["thumb-up", "IconThumbUp"],
      ["bulb", "IconBulb"],
      ["award", "IconAward"],
      ["shield-check", "IconShieldCheck"],
      ["lock", "IconLock"],
      ["puzzle", "IconPuzzle"],
      ["rocket", "IconRocket"],
      ["leaf", "IconLeaf"],
      ["sun", "IconSun"],
      ["moon", "IconMoon"],
    ],
  },
];

function renderIcon(component) {
  return renderToStaticMarkup(
    React.createElement(component, { color: BASE_COLOR, size: 48, stroke: 2 }),
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const outlineDir = path.join(OUT_DIR, "outline");
  const filledDir = path.join(OUT_DIR, "filled");
  ensureDir(outlineDir);
  ensureDir(filledDir);

  const index = [];
  let missing = 0;
  let written = 0;

  for (const category of CATEGORIES) {
    for (const [name, exportName] of category.icons) {
      const OutlineComp = TablerIcons[exportName];
      if (!OutlineComp) {
        console.warn(`[skip] missing export: ${exportName}`);
        missing++;
        continue;
      }
      const FilledComp = TablerIcons[`${exportName}Filled`];

      fs.writeFileSync(path.join(outlineDir, `${name}.svg`), renderIcon(OutlineComp), "utf8");
      let hasFilled = false;
      if (FilledComp) {
        fs.writeFileSync(path.join(filledDir, `${name}.svg`), renderIcon(FilledComp), "utf8");
        hasFilled = true;
      }
      index.push({
        name,
        category: category.id,
        outline: `/static/icons/outline/${name}.svg`,
        filled: hasFilled ? `/static/icons/filled/${name}.svg` : null,
      });
      written++;
    }
  }

  const indexPath = path.join(OUT_DIR, "index.json");
  fs.writeFileSync(
    indexPath,
    JSON.stringify(
      {
        categories: CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
        icons: index,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Wrote ${written} icons (${missing} skipped) + index.json`);
}

main();
