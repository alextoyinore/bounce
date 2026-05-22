const { FusesPlugin } = require('@electron-forge/plugin-fuses')
const { VitePlugin } = require('@electron-forge/plugin-vite')
const { FuseV1Options, FuseVersion } = require('@electron/fuses')

module.exports = {
  packagerConfig: {
    asar: {
      // Keep audio files unpacked so they can be read directly from disk
      unpack: '**/audio/**'
    },
    icon: './resources/icon',
    name: 'bounce',
    executableName: 'bounce',
    appBundleId: 'com.electron.app',
    appVersion: '1.0.0',
    // macOS entitlements
    osxEntitlements: './build/entitlements.mac.plist',
    // File associations for .bounce project files
    fileAssociations: [
      {
        ext: 'bounce',
        name: 'Bounce Project',
        description: 'Bounce DAW Project File',
        icon: './build/icon',
        role: 'Editor'
      }
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      // Windows: Squirrel installer (silent, no UAC prompt)
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'bounce',
        setupIcon: './resources/icon.ico'
      }
    },
    {
      // macOS: distributable zip
      name: '@electron-forge/maker-zip',
      platforms: ['darwin']
    },
    {
      // Linux: .deb package
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          maintainer: 'Alexander Ore',
          categories: ['Audio', 'Music']
        }
      }
    },

  ],
  plugins: [
    new VitePlugin({
      // Main process + preload builds
      build: [
        {
          entry: 'src/main/index.js',
          config: 'vite.main.config.mjs',
          target: 'main'
        },
        {
          entry: 'src/preload/index.js',
          config: 'vite.preload.config.mjs',
          target: 'preload'
        }
      ],
      // Renderer process (Vite dev server in dev, static build in prod)
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mjs'
        }
      ]
    }),
    // Electron Fuses: harden the app binary
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
}
