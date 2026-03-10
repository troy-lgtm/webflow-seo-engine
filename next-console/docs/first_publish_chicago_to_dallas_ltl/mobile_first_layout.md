# Mobile-First Layout — Chicago to Dallas LTL

## Viewport Breakpoints
- Mobile: 320-767px (primary design target)
- Tablet: 768-1023px
- Desktop: 1024px+

## Mobile Layout (top to bottom)

### 1. Quick Answer Block (above fold)
- Full width, light background
- Bold question, concise 2-sentence answer
- Estimated rate range in large text
- "Get Quote" CTA button immediately visible

### 2. Hero Section
- H1: 24px, 2 lines max
- Intro: 14px, 3 lines max
- Two CTA buttons stacked vertically
- 16px padding

### 3. Estimate Transparency
- 3 cards in single column stack
- Distance, Transit, Rate each in own card
- Confidence badges inline
- Disclaimer at bottom in muted text

### 4. Value Cards
- Single column stack
- Each card: icon + label + value + insight
- 12px gap between cards

### 5. Problem / Solution
- Two blocks, stacked
- Problem in neutral background
- Solution in accent background

### 6. Contrast Table (Legacy vs WARP)
- Horizontal scroll if needed
- 3 columns: Metric | Legacy | WARP
- WARP column highlighted
- Sticky first column on mobile

### 7. FAQ Accordion
- Tap to expand
- Only one open at a time
- Schema markup on all 5 entries

### 8. Internal Links
- Pill-style links, wrapping
- Related lanes first (6 shown)
- Guide links second
- Index page links third

### 9. Bottom CTA
- Full-width primary button
- Secondary link below
- Sticky on scroll (optional)

## Performance Requirements
- First Contentful Paint: under 1.5s
- Largest Contentful Paint: under 2.5s
- No layout shift from loaded content
- Images: lazy load below fold
- Fonts: system stack, no external fonts
