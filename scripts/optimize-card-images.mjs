import { mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const workspaceRoot = process.cwd()
const sourceDir = path.join(workspaceRoot, 'public', 'cards')
const targetDir = path.join(workspaceRoot, 'public', 'cards_webp')
const quality = Number(process.env.CARD_WEBP_QUALITY ?? 68)

async function main() {
  await mkdir(targetDir, { recursive: true })

  const entries = await readdir(sourceDir)
  const pngFiles = entries.filter((entry) => entry.toLowerCase().endsWith('.png'))

  if (pngFiles.length === 0) {
    console.log('No PNG card images found in public/cards')
    return
  }

  let totalBefore = 0
  let totalAfter = 0

  for (const file of pngFiles) {
    const sourcePath = path.join(sourceDir, file)
    const targetPath = path.join(targetDir, file.replace(/\.png$/i, '.webp'))

    const sourceStats = await stat(sourcePath)
    totalBefore += sourceStats.size

    await sharp(sourcePath)
      .webp({ quality })
      .toFile(targetPath)

    const targetStats = await stat(targetPath)
    totalAfter += targetStats.size
  }

  const savedBytes = totalBefore - totalAfter
  const savedPercent = totalBefore > 0 ? Math.round((savedBytes / totalBefore) * 100) : 0

  console.log(`Optimized ${pngFiles.length} card images to WebP.`)
  console.log(`Source: ${(totalBefore / (1024 * 1024)).toFixed(2)} MB`)
  console.log(`Output: ${(totalAfter / (1024 * 1024)).toFixed(2)} MB`)
  console.log(`Saved:  ${(savedBytes / (1024 * 1024)).toFixed(2)} MB (${savedPercent}%)`)
}

main().catch((error) => {
  console.error('Failed to optimize card images:', error)
  process.exit(1)
})