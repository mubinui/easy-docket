---
name: Easy Docket
description: An Apple-inspired personal finance workspace.
colors:
  primary: '#0066cc'
  background: '#f0f2f6'
  surface: '#ffffff'
  text: '#1d1d1f'
  secondary: '#686870'
  sidebar: '#e8ecf2'
  selected: '#dce8f6'
  line: '#dedee3'
  income: '#23834b'
  expense: '#c13e37'
  dark-background: '#14161b'
  dark-surface: '#242830'
  dark-text: '#f5f5f7'
  dark-primary: '#69aaff'
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif"
    fontSize: '15px'
  title:
    fontSize: '28px'
    fontWeight: 700
    letterSpacing: '-0.025em'
  section:
    fontSize: '17px'
    fontWeight: 650
  balance:
    fontSize: '44px'
    fontWeight: 650
    letterSpacing: '-0.035em'
rounded:
  control: '12px'
  surface: '16px'
  modal: '16px'
spacing:
  small: '8px'
  medium: '16px'
  section: '24px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.surface}'
    rounded: '{rounded.control}'
    height: '42px'
---

## Overview
A quiet, native-feeling workspace for everyday money management. The user's Apple-inspired brief informs the system typography, grouped surfaces, restrained color, and familiar navigation. Financial data and useful controls lead the interface.

## Colors
Semantic tokens live in `app/src/theme/variables.scss`, loaded after global styles. Blue identifies actions and current navigation. Green and red distinguish income and expenses alongside explicit labels and signs. Dark appearance uses graphite surfaces and lighter semantic colors through `.ion-palette-dark`.

## Typography
Use the system sans stack throughout. Tabular numerals align financial amounts. Page titles are 24px on mobile and 28px on desktop; section titles are 17px. Supporting copy is 12–15px. The vault introduction uses 56px type on large desktops, 44px below 1050px, and is omitted on mobile.

## Layout
At 900px, the four bottom tabs become a 232px sidebar with planning shortcuts. Ionic retains ownership of its router outlet. The Summary grid has two unequal columns, collapsing at 650px; its maximum width is 1180px. Settings content is constrained to an 880px reading width. The vault splits into introduction and form at 750px. Preserve the bottom safe area and scroll space below floating actions.

## Elevation & Depth
User-requested tactile elevation uses two shadow scales: broad ambient shadows for panels, tighter contact shadows for controls, and inset top highlights. The balance card and vault introduction use a dark graphite-blue finish. Primary buttons have directional blue lighting and a 1px pressed response. Premium surface rules live in `app/src/theme/premium.scss`.

## Shapes
Grouped surfaces use 16px corners; buttons 12px (10px in toolbars), form controls 9–10px; modals 16px. Outlined Ionicons provide one consistent icon vocabulary. The in-app Easy Docket mark is a currentColor dot-ledger SVG with theme-aware surfaces; packaged launcher icons remain separate.

## Components
Reuse Ionic controls and their native input semantics. Buttons use sentence case. Lists use clear separators and generous touch targets. Empty Summary sections explain their next action and link to the relevant workflow. Keep vault validation, loading, and recovery information visible. Currency radio dialogs use 54px touch rows, explicit selected surfaces and 44px footer actions. Filled Save/Pay actions use the native button part to retain their color inside Ionic toolbars. The welcome panel has a one-shot dot arrangement animation, disabled under reduced motion.

## Do's and Don'ts
- Show real ledger data and preserve explicit currency information.
- Use appearance tokens for all new surfaces, including overlays.
- Give icon-only controls accessible names and keyboard focus indicators.
- Respect reduced-motion preferences.
- Avoid decorative charts, artificial balances, display fonts, and ornamental animation. Gradients are reserved for the explicitly requested material lighting on the balance panel, vault introduction, and primary controls.
