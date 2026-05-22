const fs = require('fs')
const path = require('path')

function generateIco() {
  const pngPath = path.join(__dirname, '../resources/icon.png')
  const icoPath = path.join(__dirname, '../resources/icon.ico')

  if (!fs.existsSync(pngPath)) {
    console.error('Error: resources/icon.png does not exist.')
    process.exit(1)
  }

  const pngData = fs.readFileSync(pngPath)

  // A PNG starts with 8 bytes signature.
  // Next is the IHDR chunk.
  // IHDR has chunk size (4 bytes), chunk type "IHDR" (4 bytes), width (4 bytes), height (4 bytes).
  // Thus width starts at byte offset 16 (0x10), height at byte offset 20 (0x14).
  const width = pngData.readUInt32BE(16)
  const height = pngData.readUInt32BE(20)

  console.log(`PNG Info: Width = ${width}, Height = ${height}, Size = ${pngData.length} bytes`)

  // Create ICO header (6 bytes)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // Reserved. Must always be 0.
  header.writeUInt16LE(1, 2) // Image type: 1 for icon (.ICO)
  header.writeUInt16LE(1, 4) // Number of images in the file

  // Create ICO directory entry (16 bytes)
  const dirEntry = Buffer.alloc(16)
  // Width and height: 0 means 256 pixels
  dirEntry.writeUInt8(width >= 256 ? 0 : width, 0)
  dirEntry.writeUInt8(height >= 256 ? 0 : height, 1)
  dirEntry.writeUInt8(0, 2) // Number of colors in the color palette (0 for no palette)
  dirEntry.writeUInt8(0, 3) // Reserved. Must be 0.
  dirEntry.writeUInt16LE(1, 4) // Color planes (usually 1 or 0)
  dirEntry.writeUInt16LE(32, 6) // Bits per pixel (usually 32)
  dirEntry.writeUInt32LE(pngData.length, 8) // Size of the image's data in bytes
  dirEntry.writeUInt32LE(6 + 16, 12) // Offset of BMP or PNG data from the beginning of the ICO file (header size + directory entry size)

  // Combine them all
  const icoData = Buffer.concat([header, dirEntry, pngData])

  fs.writeFileSync(icoPath, icoData)
  console.log(`Successfully generated ICO at: ${icoPath}`)
}

generateIco()
