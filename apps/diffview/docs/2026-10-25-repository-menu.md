# Repository menu grouping

The toolbar no longer has a return/revert-shaped arrow beside the repository chip.
The repository popup has exactly two named sections:

1. Current directory repositories (`当前目录仓库`)
2. Other repositories (`其它仓库`)

"Current directory" is the selected conversation project directory, as returned by
`GET repos` in `selectedProject`. Include a repository at that directory and nested
repositories, but not sibling prefixes such as `work-other` for `work`. Unknown
project context does not promote an active or remembered first-opened repository.
Both groups share one radio selection. Empty groups show a short explanation; the
old home border and first-opened labels are removed. Choosing an "other" repository
does not redefine the groups. The project directory is in the first heading's tooltip.

The chip's flex shrinking is explicit, so long names stay inside their grid cell
instead of overlapping the scope pill. The popup width is bounded by Radix's available
viewport width, with an 8px collision margin. Branch endpoint controls retain their
own second toolbar row on narrow screens.

Coverage: path-boundary unit tests; production UI/API browser tests for both section
headings and order, active radio selection across groups, switching away and back,
no return button, popup bounds and non-overlapping toolbar controls at 360/447/1100px.
