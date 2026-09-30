import type { ThemeDraft } from '../types.ts'
import { alpine } from './alpine.ts'
import { desert } from './desert.ts'
import { archipelago } from './archipelago.ts'
import { monochrome } from './monochrome.ts'
import { dusk } from './dusk.ts'

export const PRESETS: Record<string, ThemeDraft> = {
  alpine,
  desert,
  archipelago,
  monochrome,
  dusk,
}

export const DEFAULT_PRESET_NAME = 'alpine'

export { alpine, desert, archipelago, monochrome, dusk }

