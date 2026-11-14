/** The U2 panels render the real Story County bundle with the bundle's own numbers. */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import story from '../../public/bundles/farm_story-county-ia.json'
import monona from '../../public/bundles/farm_monona-county-ia.json'
import synthetic from '../../public/bundles/farm_synthetic.json'
import { buildFieldModel, checkBundle } from '../lib/bundle'
import { rankSpeciesForGap } from '../lib/cropFit'
import { fieldFacts, scoreCover } from '../lib/metrics'
import { personaFor } from '../content/story'
import RotationCompare from './RotationCompare'
import FieldNotes from './FieldNotes'
import PhaseToggle from './PhaseToggle'
import CropPlanner from './CropPlanner'

const field = buildFieldModel(checkBundle(story))
const fits = rankSpeciesForGap(field.species, field.mainGap!, field.slice, field.observedCurves, undefined, field.earliestSeedDoy)

describe('U2 shell panels', () => {
  it('compares the three rotations with bundle numbers and evidence tiers', () => {
    const html = renderToStaticMarkup(<RotationCompare field={field} selectedId={null} onSelect={() => {}} />)
    expect(html).toContain('104 bare days')
    expect(html).toContain('(112 soybean · 96 corn)')
    expect(html).toContain('−27%')
    expect(html).toContain('measured on 9 nearby fields')
    expect(html).toContain('Winter wheat: modelled estimate')
    expect(html).not.toContain('soil loss')
  })

  it('shows evidence, grouped fits and the full uncertainty ledger', () => {
    const html = renderToStaticMarkup(<FieldNotes field={field} fits={fits} />)
    expect(html).toContain('9 nearby fields already grow a winter cover')
    expect(html).toContain('Measured on real fields')
    expect(html).toContain('Modelled estimates')
    expect(html).toContain('Sentinel-2')
    // No data source may claim a product the bundle did not use.
    expect(html).not.toMatch(/<strong>[^<]*(SMAP|IMERG|MODIS)[^<]*<\/strong>/)
    expect((html.match(/uncertainty-level/g) ?? []).length).toBe(field.bundle.uncertainty.length)
  })

  it('offers each crop year with its bare days', () => {
    const html = renderToStaticMarkup(<PhaseToggle phases={fieldFacts(field).byPhase} active="soybean" onChange={() => {}} />)
    expect(html).toContain('Soybean year')
    expect(html).toContain('112 bare days')
  })

  it('suggests seeding after harvest, not into a standing crop', () => {
    const score = scoreCover(field, [])
    const html = renderToStaticMarkup(<CropPlanner species={field.species} fits={fits} picked="cereal_rye" placed={[]} onPick={() => {}} onPlace={() => {}} onRemove={() => {}} onReset={() => {}} baseline={score} proposed={score} tierOf={() => 'measured'} />)
    expect(html).toContain('Sep 29')
    expect(html).not.toContain('Aug 15')
  })

  it('renders the second field honestly: a literature rye curve is never called measured', () => {
    const second = buildFieldModel(checkBundle(monona))
    const secondFits = rankSpeciesForGap(second.species, second.mainGap!, second.slice, second.observedCurves, undefined, second.earliestSeedDoy)
    const compare = renderToStaticMarkup(<RotationCompare field={second} selectedId={null} onSelect={() => {}} />)
    expect(compare).toContain('7 bare days')
    expect(compare).toContain('(14 corn · 0 soybean)')
    expect(compare).toContain('extension literature, not measured here')
    const notes = renderToStaticMarkup(<FieldNotes field={second} fits={secondFits} />)
    expect(notes).toContain('Rye curve from the literature, not measured here')
    expect(personaFor(second.bundle)).toBeNull()
  })

  it('labels the persona as illustrative, and never invents one for the synthetic sample', () => {
    expect(personaFor(field.bundle)?.disclosure).toContain('illustrative persona')
    expect(personaFor(checkBundle(synthetic))).toBeNull()
  })
})
