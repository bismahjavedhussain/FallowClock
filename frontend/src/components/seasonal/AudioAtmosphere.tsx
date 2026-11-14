import { useEffect, useRef, useState } from 'react'
import { seasonAtDoy, seasonWeights } from '../../lib/seasons'
import { useStore } from '../../store'
import { setSoundEnabled as setEngineSound } from '../../lib/sound'

type Players = { wind: HTMLAudioElement; leaves: HTMLAudioElement; music: HTMLAudioElement; whoosh: HTMLAudioElement }
const tracks = ['chill-vlog-beats', 'sunny-cafe', 'beautiful-lofi']

export default function AudioAtmosphere({ doy }: { doy: number }) {
  // One switch drives both halves of the audio: the streamed ambience below
  // and the synthesised interaction sounds in lib/sound.ts. Two separate
  // mutes would be a usability trap -- people press the visible one and
  // wonder why clicks still make noise.
  const enabled = useStore((s) => s.soundEnabled)
  const stage = useStore((s) => s.audioStage)
  // Narration owns the opening. Music under a voiceover is the fastest
  // way to make the voice unintelligible, so the bed stays silent until
  // the brief, comes in faded under the typing, and opens up in the tool.
  const bed = stage === 'intro' ? 0 : stage === 'brief' ? 0.38 : 1
  const setEnabled = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(useStore.getState().soundEnabled) : next
    setEngineSound(value)
    useStore.getState().setSoundEnabled(value)
  }
  const [musicEnabled, setMusicEnabled] = useState(true)
  const [ambienceVolume, setAmbienceVolume] = useState(0.28)
  const [musicVolume, setMusicVolume] = useState(0.12)
  const players = useRef<Players | null>(null)
  const levels = useRef({ wind: 0, leaves: 0, music: 0 })
  const target = useRef({ wind: 0, leaves: 0, music: 0 })
  const season = seasonAtDoy(doy)
  const previousSeason = useRef(season)
  const weights = seasonWeights(doy)
  target.current = {
    wind: enabled ? bed * ambienceVolume * (0.48 + weights.winter * 0.32 + weights.autumn * 0.15) : 0,
    leaves: enabled ? bed * ambienceVolume * (weights.spring * 0.4 + weights.summer * 0.55 + weights.autumn * 0.82) : 0,
    music: enabled && musicEnabled ? bed * musicVolume : 0,
  }

  useEffect(() => {
    if (!enabled || players.current) return
    const music = new Audio()
    const whoosh = new Audio()
    const format = music.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'mp3'
    const ambienceFormat = music.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'mp3'
    const wind = new Audio(`/audio/wind.${ambienceFormat}`)
    const leaves = new Audio(`/audio/leaves.${ambienceFormat}`)
    let index = 0
    music.src = `/audio/${tracks[index]}.${format}`
    music.preload = 'none'
    music.addEventListener('ended', () => {
      index = (index + 1) % tracks.length
      music.src = `/audio/${tracks[index]}.${format}`
      if (players.current && target.current.music > 0) void music.play().catch(() => {})
    })
    whoosh.src = `/audio/whoosh.${format}`
    whoosh.preload = 'none'
    whoosh.volume = 0.13
    wind.loop = leaves.loop = true
    wind.volume = leaves.volume = music.volume = 0
    wind.preload = leaves.preload = 'auto'
    players.current = { wind, leaves, music, whoosh }
    // If the streamed ambience cannot start -- offline, slow first load, a
    // codec the browser refuses -- do NOT switch sound off. The interaction
    // sounds are synthesised and need no files, so they still work, and
    // killing them because a 1 MB mp3 stalled would be the wrong trade.
    void wind.play().catch(() => {})
    void leaves.play().catch(() => {})
  }, [enabled])

  useEffect(() => {
    const player = players.current?.music
    if (!player) return
    if (enabled && musicEnabled) void player.play().catch(() => setMusicEnabled(false))
    else if (!musicEnabled) player.pause()
  }, [enabled, musicEnabled])

  useEffect(() => {
    if (previousSeason.current === season) return
    previousSeason.current = season
    const effect = players.current?.whoosh
    if (enabled && effect && !document.hidden) {
      effect.currentTime = 0
      void effect.play().catch(() => {})
    }
  }, [season, enabled])

  useEffect(() => {
    if (!enabled && !players.current) return
    let frame = 0
    const update = () => {
      frame = requestAnimationFrame(update)
      const current = players.current
      if (!current) return
      for (const key of ['wind', 'leaves', 'music'] as const) {
        const desired = document.hidden ? 0 : target.current[key]
        levels.current[key] += (desired - levels.current[key]) * 0.045
        current[key].volume = Math.min(1, Math.max(0, levels.current[key]))
      }
      if (!enabled && Object.values(levels.current).every((level) => level < 0.002)) {
        Object.values(current).forEach((audio) => { audio.pause(); audio.removeAttribute('src'); audio.load() })
        players.current = null
      }
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [enabled])

  useEffect(() => () => {
    if (!players.current) return
    Object.values(players.current).forEach((audio) => { audio.pause(); audio.removeAttribute('src'); audio.load() })
    players.current = null
  }, [])

  return <div className="audio-controls">
    <button type="button" aria-pressed={enabled} onClick={() => setEnabled((value) => !value)}>{enabled ? '♫ Sound on' : '♫ Enable sound'}</button>
    {enabled && <div className="audio-levels">
      <label>Ambience <input aria-label="Ambience volume" type="range" min="0" max="0.6" step="0.01" value={ambienceVolume} onChange={(e) => setAmbienceVolume(Number(e.target.value))} /></label>
      <button type="button" className="music-toggle" aria-pressed={musicEnabled} onClick={() => setMusicEnabled((value) => !value)}>{musicEnabled ? 'Music on' : 'Music off'}</button>
      {musicEnabled && <label>Music <input aria-label="Music volume" type="range" min="0" max="0.35" step="0.01" value={musicVolume} onChange={(e) => setMusicVolume(Number(e.target.value))} /></label>}
    </div>}
  </div>
}
