import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const outDir = path.resolve(process.cwd(), 'public', 'ui-skins')

const palette = {
  bg0: '#08111b',
  bg1: '#0d1f2e',
  bg2: '#102739',
  cyan: '#63d9ff',
  cyanSoft: 'rgba(99,217,255,0.22)',
  amber: '#ffbf66',
  amberSoft: 'rgba(255,191,102,0.20)',
  red: '#ff6d6d',
  green: '#6fe09f',
  panel: 'rgba(13,22,34,0.88)',
  panelSoft: 'rgba(13,22,34,0.72)',
}

function toWebpName(fileName) {
  return fileName.replace(/\.png$/i, '.webp')
}

async function writeSvgWebp(fileName, width, height, svgContent) {
  const target = path.join(outDir, toWebpName(fileName))
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svgContent}</svg>`
  const lowerName = fileName.toLowerCase()
  const isLargeGlow =
    lowerName.includes('board_center_glow') ||
    lowerName.includes('board_vignette') ||
    lowerName.includes('board_playfield_overlay')
  const isIconSheet = lowerName.includes('icon_set_ui')
  const isMainBoard = lowerName.includes('board_stage_')

  const quality = isIconSheet ? 45 : isLargeGlow ? 44 : isMainBoard ? 48 : 54
  const alphaQuality = isIconSheet ? 46 : isLargeGlow ? 42 : isMainBoard ? 48 : 56

  await sharp(Buffer.from(svg))
    .webp({ quality, effort: 6, alphaQuality })
    .toFile(target)
}

function defs() {
  return `
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.bg2}"/>
      <stop offset="55%" stop-color="${palette.bg1}"/>
      <stop offset="100%" stop-color="${palette.bg0}"/>
    </linearGradient>
    <radialGradient id="centerGlow" cx="50%" cy="52%" r="45%">
      <stop offset="0%" stop-color="rgba(99,217,255,0.24)"/>
      <stop offset="55%" stop-color="rgba(99,217,255,0.08)"/>
      <stop offset="100%" stop-color="rgba(99,217,255,0)"/>
    </radialGradient>
    <radialGradient id="amberGlow" cx="50%" cy="70%" r="50%">
      <stop offset="0%" stop-color="rgba(255,191,102,0.10)"/>
      <stop offset="100%" stop-color="rgba(255,191,102,0)"/>
    </radialGradient>
    <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="rgba(99,217,255,0)"/>
      <stop offset="50%" stop-color="rgba(99,217,255,0.36)"/>
      <stop offset="100%" stop-color="rgba(99,217,255,0)"/>
    </linearGradient>
    <linearGradient id="amberLineGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="rgba(255,191,102,0)"/>
      <stop offset="50%" stop-color="rgba(255,191,102,0.34)"/>
      <stop offset="100%" stop-color="rgba(255,191,102,0)"/>
    </linearGradient>
  </defs>`
}

function roundedPanel(w, h, radius = 16, stroke = 'rgba(255,255,255,0.18)', fill = palette.panel) {
  return `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`
}

function buttonAtlas(color, glow, w = 1536, h = 512) {
  const slice = w / 4
  const states = [
    { fill: `${color}`, op: 0.23, stroke: `${glow}`, so: 0.55 },
    { fill: `${color}`, op: 0.34, stroke: `${glow}`, so: 0.78 },
    { fill: `${color}`, op: 0.46, stroke: `${glow}`, so: 0.92 },
    { fill: '#8b99a8', op: 0.20, stroke: '#8b99a8', so: 0.38 },
  ]

  let body = `${defs()}<rect width="${w}" height="${h}" fill="transparent"/>`
  states.forEach((state, index) => {
    const x = index * slice
    body += `
      <g transform="translate(${x},0)">
        <rect x="24" y="72" width="${slice - 48}" height="${h - 144}" rx="46" fill="rgba(255,255,255,0.02)"/>
        <rect x="32" y="80" width="${slice - 64}" height="${h - 160}" rx="42" fill="${state.fill}" fill-opacity="${state.op}" stroke="${state.stroke}" stroke-opacity="${state.so}" stroke-width="3"/>
        <line x1="46" y1="106" x2="${slice - 46}" y2="106" stroke="url(#lineGrad)" stroke-width="3"/>
      </g>`
  })
  return body
}

function iconShell(fill = 'rgba(99,217,255,0.18)', stroke = 'rgba(139,198,255,0.88)') {
  return `
    <circle cx="64" cy="64" r="56" fill="${fill}" stroke="${stroke}" stroke-width="4"/>
    <circle cx="64" cy="64" r="46" fill="rgba(8,17,27,0.42)"/>
  `
}

async function writeUiIcon(fileName, glyph, options = {}) {
  const { fill, stroke } = options
  await writeSvgWebp(fileName, 128, 128, `${iconShell(fill, stroke)}${glyph}`)
}

async function main() {
  await fs.mkdir(outDir, { recursive: true })

  const previousFiles = await fs.readdir(outDir)
  await Promise.all(
    previousFiles
      .filter((name) => /\.(png|webp)$/i.test(name))
      .map((name) => fs.unlink(path.join(outDir, name))),
  )

  await writeSvgWebp(
    'board_stage_base.png',
    2560,
    1440,
    `${defs()}
      <rect width="2560" height="1440" fill="url(#bgGrad)"/>
      <ellipse cx="1280" cy="760" rx="1080" ry="520" fill="url(#centerGlow)"/>
      <ellipse cx="1280" cy="980" rx="980" ry="360" fill="url(#amberGlow)"/>
      <rect x="36" y="36" width="2488" height="1368" rx="28" fill="transparent" stroke="rgba(99,217,255,0.14)"/>
      <rect x="72" y="72" width="2416" height="1296" rx="24" fill="transparent" stroke="rgba(255,191,102,0.08)"/>
      <line x1="280" y1="170" x2="2280" y2="170" stroke="url(#lineGrad)" stroke-width="3"/>
      <line x1="320" y1="1268" x2="2240" y2="1268" stroke="url(#amberLineGrad)" stroke-width="3"/>
    `,
  )

  await writeSvgWebp(
    'board_stage_focus.png',
    2560,
    1440,
    `${defs()}
      <rect width="2560" height="1440" fill="${palette.bg1}"/>
      <ellipse cx="1280" cy="760" rx="980" ry="470" fill="url(#centerGlow)"/>
      <rect x="28" y="28" width="2504" height="1384" rx="26" fill="transparent" stroke="rgba(99,217,255,0.12)"/>
      <line x1="360" y1="170" x2="2200" y2="170" stroke="url(#lineGrad)" stroke-width="2"/>
    `,
  )

  await writeSvgWebp(
    'board_playfield_overlay.png',
    2560,
    1440,
    `${defs()}
      <rect width="2560" height="1440" fill="transparent"/>
      <rect x="24" y="24" width="2512" height="1392" rx="28" fill="transparent" stroke="rgba(99,217,255,0.24)" stroke-width="2"/>
      <rect x="66" y="66" width="2428" height="1308" rx="24" fill="transparent" stroke="rgba(255,191,102,0.16)" stroke-width="1.5"/>
      <circle cx="120" cy="120" r="44" fill="rgba(99,217,255,0.16)"/>
      <circle cx="2440" cy="120" r="44" fill="rgba(99,217,255,0.16)"/>
      <circle cx="120" cy="1320" r="44" fill="rgba(255,191,102,0.14)"/>
      <circle cx="2440" cy="1320" r="44" fill="rgba(255,191,102,0.14)"/>
    `,
  )

  await writeSvgWebp(
    'board_center_glow_soft.png',
    1400,
    900,
    `
      <defs>
        <radialGradient id="g" cx="50%" cy="50%" r="52%">
          <stop offset="0%" stop-color="rgba(99,217,255,0.32)"/>
          <stop offset="45%" stop-color="rgba(99,217,255,0.16)"/>
          <stop offset="100%" stop-color="rgba(99,217,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="1400" height="900" fill="transparent"/>
      <ellipse cx="700" cy="450" rx="620" ry="330" fill="url(#g)"/>
    `,
  )

  await writeSvgWebp(
    'board_center_glow_focus.png',
    1400,
    900,
    `
      <defs>
        <radialGradient id="g" cx="50%" cy="50%" r="48%">
          <stop offset="0%" stop-color="rgba(99,217,255,0.26)"/>
          <stop offset="100%" stop-color="rgba(99,217,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="1400" height="900" fill="transparent"/>
      <ellipse cx="700" cy="450" rx="540" ry="280" fill="url(#g)"/>
    `,
  )

  await writeSvgWebp(
    'board_vignette_overlay.png',
    2560,
    1440,
    `
      <defs>
        <radialGradient id="v" cx="50%" cy="50%" r="72%">
          <stop offset="55%" stop-color="rgba(0,0,0,0)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.48)"/>
        </radialGradient>
      </defs>
      <rect width="2560" height="1440" fill="url(#v)"/>
    `,
  )

  await writeSvgWebp('top_hud_panel.png', 2048, 256, `${defs()}${roundedPanel(2048, 256, 22)}<line x1="140" y1="74" x2="1908" y2="74" stroke="url(#lineGrad)" stroke-width="2"/>`)
  await writeSvgWebp('compact_info_chip.png', 512, 128, `${defs()}${roundedPanel(512, 128, 64, 'rgba(99,217,255,0.46)', 'rgba(9,19,30,0.82)')}`)
  await writeSvgWebp('action_hud_panel.png', 1400, 360, `${defs()}${roundedPanel(1400, 360, 20)}<line x1="80" y1="78" x2="1320" y2="78" stroke="url(#lineGrad)" stroke-width="2"/>`)
  await writeSvgWebp('hand_dock_bg.png', 2200, 420, `${defs()}${roundedPanel(2200, 420, 28)}<ellipse cx="1100" cy="60" rx="840" ry="120" fill="rgba(99,217,255,0.10)"/>`)
  await writeSvgWebp('timeline_strip_bg.png', 1200, 220, `${defs()}${roundedPanel(1200, 220, 14)}<line x1="50" y1="54" x2="1150" y2="54" stroke="url(#lineGrad)" stroke-width="2"/>`)
  await writeSvgWebp('seat_panel_bg.png', 700, 320, `${defs()}${roundedPanel(700, 320, 16)}<line x1="44" y1="74" x2="656" y2="74" stroke="url(#lineGrad)" stroke-width="2"/>`)

  await writeSvgWebp('button_primary_atlas.png', 1536, 512, buttonAtlas('#3ea4ff', '#8ad3ff'))
  await writeSvgWebp('button_secondary_atlas.png', 1536, 512, buttonAtlas('#5d7086', '#a6bfd8'))
  await writeSvgWebp('button_danger_atlas.png', 1536, 512, buttonAtlas('#d35656', '#ff9a9a'))

  await writeSvgWebp('toggle_focus_atlas.png', 1024, 256, buttonAtlas('#5f8ac7', '#9cc3ff', 1024, 256))
  await writeSvgWebp('modal_overlay_vignette.png', 2560, 1440, `<rect width="2560" height="1440" fill="rgba(0,0,0,0.58)"/>`)
  await writeSvgWebp('endgame_panel_bg.png', 1400, 900, `${defs()}${roundedPanel(1400, 900, 26, 'rgba(255,191,102,0.58)', 'rgba(13,22,34,0.94)')}<line x1="90" y1="118" x2="1310" y2="118" stroke="url(#amberLineGrad)" stroke-width="3"/>`)

  await writeSvgWebp('vote_chip_accept.png', 512, 128, `${roundedPanel(512, 128, 64, 'rgba(111,224,159,0.7)', 'rgba(25,58,42,0.74)')}`)
  await writeSvgWebp('vote_chip_pending.png', 512, 128, `${roundedPanel(512, 128, 64, 'rgba(255,191,102,0.7)', 'rgba(60,45,28,0.74)')}`)
  await writeSvgWebp('vote_chip_decline.png', 512, 128, `${roundedPanel(512, 128, 64, 'rgba(255,109,109,0.7)', 'rgba(61,26,26,0.76)')}`)

  await writeSvgWebp('fx_glow_soft.png', 512, 512, `<defs><radialGradient id="g" cx="50%" cy="50%" r="52%"><stop offset="0%" stop-color="rgba(99,217,255,0.55)"/><stop offset="100%" stop-color="rgba(99,217,255,0)"/></radialGradient></defs><rect width="512" height="512" fill="transparent"/><circle cx="256" cy="256" r="230" fill="url(#g)"/>`)
  await writeSvgWebp('fx_glow_ring.png', 512, 512, `<rect width="512" height="512" fill="transparent"/><circle cx="256" cy="256" r="210" fill="none" stroke="rgba(99,217,255,0.55)" stroke-width="20"/>`)
  await writeSvgWebp('fx_streak_horizontal.png', 1024, 256, `<defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="rgba(99,217,255,0)"/><stop offset="50%" stop-color="rgba(99,217,255,0.82)"/><stop offset="100%" stop-color="rgba(99,217,255,0)"/></linearGradient></defs><rect width="1024" height="256" fill="transparent"/><rect x="50" y="118" width="924" height="20" fill="url(#s)" rx="10"/>`)
  await writeSvgWebp('fx_particle_soft.png', 256, 256, `<defs><radialGradient id="p" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="rgba(255,191,102,0.92)"/><stop offset="100%" stop-color="rgba(255,191,102,0)"/></radialGradient></defs><rect width="256" height="256" fill="transparent"/><circle cx="128" cy="128" r="90" fill="url(#p)"/>`)

  await writeSvgWebp('card_highlight_frame_blue.png', 512, 768, `<rect width="512" height="768" fill="transparent"/><rect x="10" y="10" width="492" height="748" rx="22" fill="none" stroke="rgba(99,217,255,0.94)" stroke-width="12"/><rect x="26" y="26" width="460" height="716" rx="16" fill="none" stroke="rgba(99,217,255,0.35)" stroke-width="5"/>`)
  await writeSvgWebp('card_highlight_frame_red.png', 512, 768, `<rect width="512" height="768" fill="transparent"/><rect x="10" y="10" width="492" height="748" rx="22" fill="none" stroke="rgba(255,109,109,0.94)" stroke-width="12"/><rect x="26" y="26" width="460" height="716" rx="16" fill="none" stroke="rgba(255,109,109,0.35)" stroke-width="5"/>`)
  await writeSvgWebp('card_highlight_frame_gold.png', 512, 768, `<rect width="512" height="768" fill="transparent"/><rect x="10" y="10" width="492" height="748" rx="22" fill="none" stroke="rgba(255,191,102,0.94)" stroke-width="12"/><rect x="26" y="26" width="460" height="716" rx="16" fill="none" stroke="rgba(255,191,102,0.35)" stroke-width="5"/>`)

  await writeSvgWebp(
    'card_back.png',
    512,
    768,
    `
      <defs>
        <linearGradient id="cbg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#17324a"/>
          <stop offset="100%" stop-color="#0b1624"/>
        </linearGradient>
        <radialGradient id="cglow" cx="50%" cy="46%" r="55%">
          <stop offset="0%" stop-color="rgba(99,217,255,0.28)"/>
          <stop offset="100%" stop-color="rgba(99,217,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="512" height="768" rx="28" fill="url(#cbg)"/>
      <rect x="16" y="16" width="480" height="736" rx="24" fill="none" stroke="rgba(139,198,255,0.76)" stroke-width="6"/>
      <rect x="34" y="34" width="444" height="700" rx="20" fill="none" stroke="rgba(255,191,102,0.34)" stroke-width="3"/>
      <ellipse cx="256" cy="384" rx="188" ry="248" fill="url(#cglow)"/>
      <g stroke="rgba(139,198,255,0.62)" stroke-width="5" fill="none">
        <circle cx="256" cy="384" r="118"/>
        <circle cx="256" cy="384" r="74"/>
      </g>
      <g stroke="rgba(255,191,102,0.72)" stroke-width="5" stroke-linecap="round">
        <line x1="256" y1="230" x2="256" y2="290"/>
        <line x1="256" y1="478" x2="256" y2="538"/>
        <line x1="102" y1="384" x2="162" y2="384"/>
        <line x1="350" y1="384" x2="410" y2="384"/>
      </g>
      <path d="M256 328l42 32-16 50h-52l-16-50z" fill="rgba(255,191,102,0.35)" stroke="rgba(255,191,102,0.8)" stroke-width="4"/>
    `,
  )

  await writeSvgWebp('scrollbar_thumb.png', 128, 32, `<rect width="128" height="32" rx="16" fill="rgba(99,217,255,0.62)"/>`)
  await writeSvgWebp('scrollbar_track.png', 128, 32, `<rect width="128" height="32" rx="16" fill="rgba(9,19,30,0.52)"/>`)

  await writeSvgWebp('chat_panel_bg.png', 900, 700, `${defs()}${roundedPanel(900, 700, 16)}<line x1="50" y1="86" x2="850" y2="86" stroke="url(#lineGrad)" stroke-width="2"/>`)
  await writeSvgWebp('log_panel_bg.png', 900, 700, `${defs()}${roundedPanel(900, 700, 16)}<line x1="50" y1="86" x2="850" y2="86" stroke="url(#amberLineGrad)" stroke-width="2"/>`)

  await writeSvgWebp(
    'page_hero_bg.png',
    2200,
    640,
    `${defs()}
      <rect width="2200" height="640" fill="url(#bgGrad)"/>
      <ellipse cx="520" cy="130" rx="460" ry="210" fill="rgba(99,217,255,0.16)"/>
      <ellipse cx="1850" cy="110" rx="420" ry="190" fill="rgba(255,191,102,0.14)"/>
      <line x1="120" y1="420" x2="2080" y2="420" stroke="url(#lineGrad)" stroke-width="3"/>
      <line x1="220" y1="516" x2="1980" y2="516" stroke="url(#amberLineGrad)" stroke-width="2"/>
    `,
  )

  await writeSvgWebp(
    'section_panel_bg.png',
    1600,
    1000,
    `${defs()}
      <rect width="1600" height="1000" fill="rgba(10,18,30,0.9)"/>
      <rect x="12" y="12" width="1576" height="976" rx="18" fill="none" stroke="rgba(99,217,255,0.18)" stroke-width="2"/>
      <line x1="80" y1="104" x2="1520" y2="104" stroke="url(#lineGrad)" stroke-width="2"/>
      <circle cx="150" cy="850" r="120" fill="rgba(99,217,255,0.08)"/>
      <circle cx="1450" cy="180" r="110" fill="rgba(255,191,102,0.08)"/>
    `,
  )

  await writeSvgWebp(
    'page_shell_overlay.png',
    2560,
    1600,
    `${defs()}
      <rect width="2560" height="1600" fill="rgba(7,13,24,0.85)"/>
      <rect x="24" y="24" width="2512" height="1552" rx="28" fill="none" stroke="rgba(99,217,255,0.12)"/>
      <ellipse cx="260" cy="220" rx="220" ry="140" fill="rgba(99,217,255,0.08)"/>
      <ellipse cx="2300" cy="180" rx="220" ry="130" fill="rgba(255,191,102,0.06)"/>
      <ellipse cx="1280" cy="1460" rx="840" ry="120" fill="rgba(99,217,255,0.05)"/>
    `,
  )

  await writeUiIcon(
    'icon_turn_self.png',
    '<circle cx="64" cy="64" r="18" fill="rgba(111,224,159,0.95)"/><circle cx="64" cy="64" r="28" fill="none" stroke="rgba(111,224,159,0.8)" stroke-width="6"/>',
    { fill: 'rgba(111,224,159,0.16)', stroke: 'rgba(111,224,159,0.85)' },
  )
  await writeUiIcon('icon_turn_other.png', '<circle cx="64" cy="64" r="24" fill="none" stroke="rgba(139,198,255,0.92)" stroke-width="8"/><line x1="64" y1="64" x2="64" y2="44" stroke="rgba(139,198,255,0.92)" stroke-width="6" stroke-linecap="round"/><line x1="64" y1="64" x2="80" y2="74" stroke="rgba(139,198,255,0.92)" stroke-width="6" stroke-linecap="round"/>')
  await writeUiIcon('icon_phase.png', '<path d="M40 40h48v16H70v34H58V56H40z" fill="rgba(139,198,255,0.95)"/>')
  await writeUiIcon('icon_deck.png', '<rect x="40" y="38" width="38" height="52" rx="6" fill="none" stroke="rgba(139,198,255,0.92)" stroke-width="6"/><rect x="52" y="30" width="38" height="52" rx="6" fill="rgba(139,198,255,0.22)" stroke="rgba(139,198,255,0.88)" stroke-width="5"/>')
  await writeUiIcon('icon_discard.png', '<rect x="38" y="32" width="52" height="58" rx="8" fill="rgba(255,191,102,0.22)" stroke="rgba(255,191,102,0.95)" stroke-width="6"/><line x1="44" y1="38" x2="84" y2="78" stroke="rgba(255,191,102,0.92)" stroke-width="5"/>')
  await writeUiIcon('icon_players.png', '<circle cx="50" cy="56" r="10" fill="rgba(139,198,255,0.95)"/><circle cx="78" cy="52" r="9" fill="rgba(139,198,255,0.82)"/><path d="M36 88c2-11 9-18 19-18s17 7 19 18" fill="none" stroke="rgba(139,198,255,0.92)" stroke-width="6" stroke-linecap="round"/><path d="M66 86c2-8 7-13 14-13s12 5 14 13" fill="none" stroke="rgba(139,198,255,0.74)" stroke-width="5" stroke-linecap="round"/>')
  await writeUiIcon('icon_status.png', '<circle cx="64" cy="64" r="24" fill="none" stroke="rgba(139,198,255,0.92)" stroke-width="7"/><circle cx="64" cy="52" r="4" fill="rgba(139,198,255,0.95)"/><line x1="64" y1="62" x2="64" y2="78" stroke="rgba(139,198,255,0.95)" stroke-width="6" stroke-linecap="round"/>')
  await writeUiIcon('icon_sync.png', '<path d="M42 58a22 22 0 0 1 38-10" fill="none" stroke="rgba(139,198,255,0.92)" stroke-width="6" stroke-linecap="round"/><path d="M80 48l8 2-2 8" fill="none" stroke="rgba(139,198,255,0.92)" stroke-width="6" stroke-linecap="round"/><path d="M86 70a22 22 0 0 1-38 10" fill="none" stroke="rgba(139,198,255,0.92)" stroke-width="6" stroke-linecap="round"/><path d="M48 80l-8-2 2-8" fill="none" stroke="rgba(139,198,255,0.92)" stroke-width="6" stroke-linecap="round"/>')
  await writeUiIcon(
    'icon_trophy.png',
    '<path d="M48 40h32v12c0 11-8 20-16 20s-16-9-16-20z" fill="rgba(255,191,102,0.92)"/><path d="M54 72h20v8H54zM50 84h28v8H50z" fill="rgba(255,191,102,0.86)"/><path d="M42 42h6v14h-6c-6 0-10-4-10-10v-2h10zM86 42h10v2c0 6-4 10-10 10h-6z" fill="rgba(255,191,102,0.72)"/>',
    { fill: 'rgba(255,191,102,0.18)', stroke: 'rgba(255,191,102,0.86)' },
  )
  await writeUiIcon('icon_reaction.png', '<path d="M64 34l20 11v22L64 78 44 67V45z" fill="none" stroke="rgba(139,198,255,0.95)" stroke-width="6"/><path d="M54 60l7 7 13-13" fill="none" stroke="rgba(111,224,159,0.95)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>')
  await writeUiIcon('icon_target.png', '<circle cx="64" cy="64" r="26" fill="none" stroke="rgba(139,198,255,0.95)" stroke-width="6"/><circle cx="64" cy="64" r="14" fill="none" stroke="rgba(139,198,255,0.8)" stroke-width="5"/><circle cx="64" cy="64" r="4" fill="rgba(139,198,255,0.96)"/><line x1="64" y1="32" x2="64" y2="44" stroke="rgba(139,198,255,0.85)" stroke-width="5"/><line x1="64" y1="84" x2="64" y2="96" stroke="rgba(139,198,255,0.85)" stroke-width="5"/><line x1="32" y1="64" x2="44" y2="64" stroke="rgba(139,198,255,0.85)" stroke-width="5"/><line x1="84" y1="64" x2="96" y2="64" stroke="rgba(139,198,255,0.85)" stroke-width="5"/>')
  await writeUiIcon('icon_timeline.png', '<path d="M34 64h60" stroke="rgba(139,198,255,0.9)" stroke-width="6" stroke-linecap="round"/><circle cx="44" cy="64" r="6" fill="rgba(139,198,255,0.92)"/><circle cx="64" cy="64" r="6" fill="rgba(255,191,102,0.95)"/><circle cx="84" cy="64" r="6" fill="rgba(139,198,255,0.92)"/><path d="M64 40v10" stroke="rgba(255,191,102,0.88)" stroke-width="5" stroke-linecap="round"/><path d="M64 78v10" stroke="rgba(255,191,102,0.88)" stroke-width="5" stroke-linecap="round"/>')
  await writeUiIcon('icon_chat.png', '<path d="M34 40h60v34H58l-16 14v-14H34z" fill="none" stroke="rgba(139,198,255,0.95)" stroke-width="6" stroke-linejoin="round"/><circle cx="52" cy="57" r="3.5" fill="rgba(139,198,255,0.95)"/><circle cx="64" cy="57" r="3.5" fill="rgba(139,198,255,0.95)"/><circle cx="76" cy="57" r="3.5" fill="rgba(139,198,255,0.95)"/>')
  await writeUiIcon('icon_log.png', '<rect x="40" y="34" width="48" height="60" rx="6" fill="none" stroke="rgba(255,191,102,0.95)" stroke-width="6"/><line x1="50" y1="52" x2="78" y2="52" stroke="rgba(255,191,102,0.9)" stroke-width="5"/><line x1="50" y1="64" x2="78" y2="64" stroke="rgba(255,191,102,0.9)" stroke-width="5"/><line x1="50" y1="76" x2="72" y2="76" stroke="rgba(255,191,102,0.9)" stroke-width="5"/>', { fill: 'rgba(255,191,102,0.16)', stroke: 'rgba(255,191,102,0.86)' })
  await writeUiIcon('icon_accept.png', '<circle cx="64" cy="64" r="26" fill="none" stroke="rgba(111,224,159,0.92)" stroke-width="7"/><path d="M52 64l9 10 17-18" fill="none" stroke="rgba(111,224,159,0.95)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>', { fill: 'rgba(111,224,159,0.18)', stroke: 'rgba(111,224,159,0.85)' })
  await writeUiIcon('icon_decline.png', '<circle cx="64" cy="64" r="26" fill="none" stroke="rgba(255,109,109,0.92)" stroke-width="7"/><line x1="54" y1="54" x2="74" y2="74" stroke="rgba(255,109,109,0.95)" stroke-width="7" stroke-linecap="round"/><line x1="74" y1="54" x2="54" y2="74" stroke="rgba(255,109,109,0.95)" stroke-width="7" stroke-linecap="round"/>', { fill: 'rgba(255,109,109,0.18)', stroke: 'rgba(255,109,109,0.85)' })
  await writeUiIcon('icon_pending.png', '<circle cx="64" cy="64" r="24" fill="none" stroke="rgba(255,191,102,0.92)" stroke-width="7"/><line x1="64" y1="64" x2="64" y2="50" stroke="rgba(255,191,102,0.95)" stroke-width="6" stroke-linecap="round"/><line x1="64" y1="64" x2="76" y2="72" stroke="rgba(255,191,102,0.95)" stroke-width="6" stroke-linecap="round"/>', { fill: 'rgba(255,191,102,0.18)', stroke: 'rgba(255,191,102,0.85)' })

  await writeSvgWebp('icon_set_ui.png', 2048, 2048, `<rect width="2048" height="2048" fill="transparent"/><g stroke="rgba(233,245,255,0.78)" fill="none" stroke-width="18">${Array.from({ length: 64 }, (_, i) => {
    const col = i % 8
    const row = Math.floor(i / 8)
    const x = 96 + col * 240
    const y = 96 + row * 240
    return `<circle cx="${x}" cy="${y}" r="62"/><line x1="${x - 28}" y1="${y}" x2="${x + 28}" y2="${y}"/><line x1="${x}" y1="${y - 28}" x2="${x}" y2="${y + 28}"/>`
  }).join('')}</g>`)

  console.log(`Optimized WebP UI skin pack generated at: ${outDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
