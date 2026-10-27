# Clarify PR action (0.4.4)

## Change

The overflow menu item previously labelled only **Pull Request** switches the
whole review to a pull-request comparison and opens the PR selector. A bare
noun did not communicate that consequence.

The item is now the action **Compare pull request…** / **对比 Pull Request…**
and includes the standard pull-request icon. The ellipsis communicates that a
selector follows. Selecting the action now opens that PR selector directly
rather than first showing another comparison-menu level.

## Validation

The production menu browser regression checks the new Chinese action label at
both standalone and sidebar widths and ensures the ambiguous noun-only item is
absent. It also verifies that activating the action opens the PR-number input
directly. Typecheck, unit tests, production build, source installation, and an
installed UI smoke test are required before delivery.
