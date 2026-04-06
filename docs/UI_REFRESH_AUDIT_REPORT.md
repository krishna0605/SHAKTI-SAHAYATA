# SHAKTI UI Refresh Audit Report

Date: 2026-04-06
Scope audited: `frontend`
Reference plan: `C:\Users\ADMIN\Desktop\SHAKTI UI Refresh shadcnui Aceternity UI.md`

## Non-Negotiable Guardrails

These constraints are being preserved during implementation:

- Do not change the existing color theme or design token palette.
- Do not change the logo or replace the current BrandMark.
- Do not add new pages or routes.
- Do not change backend behavior, APIs, stores, or business logic unless a frontend integration bug forces a minimal compatibility fix.
- Keep this as a frontend-only refresh focused on presentation, interaction quality, loading states, and component consistency.

## Current Audit Summary

The refresh foundation is partially implemented already.

- `shadcn/ui` primitives are already present for many planned areas: `badge`, `breadcrumb`, `dialog`, `dropdown-menu`, `input`, `scroll-area`, `select`, `sheet`, `skeleton`, `sonner`, `switch`, `tabs`, `tooltip`, and others.
- Most Aceternity components from the plan already exist under `src/components/ui/aceternity/`.
- The following planned Aceternity files are still missing:
  - `floating-dock.tsx`
  - `placeholders-and-vanish-input.tsx`
- `framer-motion`, `clsx`, `tailwind-merge`, and `@tabler/icons-react` are already installed.

This means the repo is past the setup phase. The main remaining work is integration quality and completing the screen-level refresh safely.

## Page-by-Page Status

### 1. Landing Page

Status: partially implemented, strongest of all pages.

Already done:

- `Spotlight`
- `TextGenerateEffect`
- `FlipWords`
- `ColourfulText`
- `HoverEffect`
- `TracingBeam`
- `LampEffect`
- refreshed hero/card layout

Still missing or incomplete versus plan:

- planned `MovingBorder` CTA treatment is not used
- planned `BentoGrid` is not used even though the component exists
- planned `FloatingDock` footer/nav treatment is not present
- footer remains conventional instead of motion-led

Implementation approach:

- preserve current page structure and theme
- upgrade CTA treatment and capability layout using existing components only
- avoid changing the logo or adding new sections/routes

### 2. Login Page

Status: mostly implemented.

Already done:

- `BackgroundBeams`
- `CardSpotlight`
- `TextGenerateEffect`
- shadcn `Input`
- polished auth card layout

Still missing or incomplete versus plan:

- no `MovingBorder` button treatment
- alert state is still custom markup instead of shadcn `Alert`
- no switch-style toggles because there are no actual auth toggles to convert

Implementation approach:

- keep current structure
- normalize feedback and CTA styling

### 3. Signup Page

Status: mostly implemented.

Already done:

- `BackgroundBeams`
- `CardSpotlight`
- `TextGenerateEffect`
- shadcn `Input`
- improved validation cues

Still missing or incomplete versus plan:

- custom error feedback instead of shadcn `Alert`
- no `MovingBorder` CTA
- one unused `Label` import suggests incomplete refactor cleanup

Implementation approach:

- keep the current signup layout intact
- finish component consistency and remove leftover rough edges

### 4. Dashboard

Status: partially implemented.

Already done:

- `Sparkles`
- `GlowingEffect`
- `3DCard`
- `Meteors`
- refreshed hero and empty state

Still missing or incomplete versus plan:

- loading state still uses a simple spinner instead of `Skeleton`
- stat cards do not use tooltips
- animated counters are not implemented
- primary buttons are still standard shadcn buttons instead of the planned premium CTA treatment

Implementation approach:

- convert loading to skeletons
- add tooltips and tighter feedback states
- preserve existing dashboard logic and case API behavior

### 5. Case View

Status: partially implemented but structurally uneven.

Already done:

- animated tab component is used

Still missing or incomplete versus plan:

- no breadcrumb navigation
- badges are still class-based spans instead of shadcn `Badge`
- sections are inconsistent between old CSS and newer component styles
- file review is still a raw HTML table
- loading state is still plain text
- current `h-[40rem]` tab shell is brittle and likely to create overflow/UX issues

Implementation approach:

- keep the same route and data flows
- refactor the visual shell to use `Breadcrumb`, `Badge`, `Card`, `Skeleton`, and better tab panel sizing
- avoid touching upload/analysis business logic

### 6. Create Case Page

Status: partially implemented but still mostly old-form UI.

Already done:

- `MultiStepLoader` overlay exists

Still missing or incomplete versus plan:

- page still uses custom form controls instead of shadcn `Input`, `Select`, `Textarea`, `Alert`
- upload section is custom markup rather than the provided `FileUpload` component
- no toast feedback
- no progress primitive
- plan mentions modal/dialog, but this app already has a dedicated page route and should stay that way to respect the “no new page flow changes” guardrail

Implementation approach:

- modernize the existing page, not convert it into a modal
- keep the same create-case flow and upload logic
- replace old controls with shared primitives

### 7. OSINT Tools

Status: largely still on the old UI layer.

Already done:

- functional tabbed workflow exists

Still missing or incomplete versus plan:

- custom tab buttons instead of premium/animated tabs
- custom input and textarea styles instead of shared primitives
- custom error UI instead of shadcn `Alert`
- result layout still uses old CSS utility classes
- planned vanish input is not available because `placeholders-and-vanish-input.tsx` is missing

Implementation approach:

- refresh this page with existing shared primitives
- do not create new backend calls
- avoid inventing missing Aceternity pieces if a stable shadcn pattern covers the same need

### 8. Settings Page

Status: biggest remaining gap.

Already done:

- functional settings page exists
- diagnostics panel exists

Still missing or incomplete versus plan:

- mostly raw HTML inputs, selects, and checkboxes
- no `Accordion`
- no shadcn `Switch`
- no shadcn `Select`
- no toast feedback
- visual hierarchy is flatter than the rest of the refreshed app

Implementation approach:

- convert settings sections to shared shadcn primitives
- improve grouping and feedback without changing settings data shape or save API behavior

### 9. ChatBot

Status: functionally rich, visually custom, not yet aligned to the new component system.

Already done:

- advanced case-aware chat features
- custom rendering for tables, charts, SQL, and case suggestions

Still missing or incomplete versus plan:

- no `ScrollArea`
- no shadcn `Avatar`
- no toast feedback for copy/error actions
- no enhanced input treatment

Implementation approach:

- treat this as medium-risk because the component is large and behaviorally dense
- refresh only the safe shell/UI layer after the higher-value page work is complete

### 10. Navbar and Global Layer

Status: partially implemented.

Already done:

- shadcn `DropdownMenu`
- shadcn `Sheet`
- shadcn `Avatar`
- responsive navigation shell
- tooltip provider in `main.tsx`

Still missing or incomplete versus plan:

- no active underline slide treatment
- no command palette
- no global toaster mounted
- route loading shell is still bespoke instead of skeleton-led
- page transition layer with `AnimatePresence` is not wired
- logo sparkle treatment is intentionally not being applied because the user explicitly asked not to change the logo

Implementation approach:

- improve navigation polish and global feedback layers
- skip any logo mutation
- treat command palette as optional and only implement if it can be done safely without introducing route or behavior regressions

## Implementation Decision Matrix

### Safe to Implement Immediately

- global `Toaster` mounting
- dashboard loading skeletons
- settings page conversion to shared primitives
- create case page conversion to shared primitives
- case view visual shell cleanup
- OSINT visual refresh using existing shared components
- navbar polish that does not alter logo identity
- landing page improvements that keep current theme and structure

### Implement Carefully

- route transition animation
- command palette
- chatbot shell refactor
- create case upload surface replacement

These areas touch broad interaction flows and should only be changed if verification stays clean.

### Intentionally Out of Scope

- backend code
- auth logic
- case creation logic
- API contracts
- new routes/pages
- logo redesign
- theme/token replacement

## Risks and Constraints

### Existing Dirty Worktree

The frontend worktree already contains many uncommitted UI changes. That means implementation must be additive and careful.

Implication:

- do not revert existing user changes
- patch in place
- prefer shared primitive adoption over large rewrites unless the current structure is clearly blocking the refresh

### Incomplete Plan vs Product Reality

The implementation plan assumes some interaction models that differ from the current app:

- the plan mentions a create-case dialog, but the app already uses a full page
- the plan suggests a logo sparkle treatment, but the user explicitly prohibited logo changes
- the plan lists `FloatingDock` and vanish input, but those components are not present yet

Implication:

- follow the user’s constraints over the original plan wherever they conflict
- complete the spirit of the UI refresh without forcing mismatched patterns into the product

## What Will Happen Next

The implementation sequence for this pass should be:

1. Mount global feedback and loading improvements.
2. Finish the most incomplete pages first: `SettingsPage`, `CreateCasePage`, `CaseView`, and `OSINT`.
3. Tighten dashboard and auth consistency.
4. Apply safe landing/navbar polish that does not alter theme or logo identity.
5. Run frontend validation with build/tests.

## Expected Output of This Pass

If implementation proceeds cleanly, the frontend should end this pass with:

- more consistent use of shadcn primitives across all major pages
- better loading, empty, and error states
- more polished CTA and interaction feedback
- zero intentional backend changes
- no changes to the logo, route map, or core theme palette

## Audit Verdict

The repo is in a strong enough state to complete a meaningful UI refresh pass now.

The right move is not to rebuild the whole frontend from scratch. The right move is to finish the integration layer, standardize the remaining pages on the shared component system, and deliberately skip the parts of the original plan that conflict with your constraints.
