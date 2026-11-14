import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    watch: {
      // A file still being written -- a download landing in the project, an
      // archive being unpacked -- makes the watcher throw EBUSY on Windows
      // and takes the whole dev server down with it. Nothing here needs to
      // be watched, so do not try.
      ignored: [
        // Half-written downloads.
        '**/*.zip', '**/*.rar', '**/*.7z', '**/*.crdownload', '**/*.part', '**/*.tmp',
        // Raw sprite drops at the project root. These are SOURCE material,
        // not app files -- nothing imports them, and the app serves copies
        // from public/sprite. Watching them takes the dev server down with
        // an EBUSY the moment a folder is added, renamed or deleted, which
        // has now happened three times.
        '**/FarmerAnimations/**',
        '**/A_friendly_young_farmer*/**',
        '**/Idle/**',
      ],
    },
  },
})
