// Pierre's per-file ShadowRoot cannot see the outer Rome stylesheet.
// All palette values below are inherited Rome semantic tokens, including syntax.
export const reviewCSS = `
:host{
 --diffs-gap-block:0px;
 --diffs-font-family:ui-monospace,"SFMono-Regular",Consolas,monospace;
 --diffs-font-size:13px;--diffs-line-height:26px;
 --diffs-light-bg:var(--app-canvas);--diffs-dark-bg:var(--app-canvas);
 --diffs-light:var(--foreground);--diffs-dark:var(--foreground);
 --diffs-fg-number-override:var(--muted-foreground);
 --diffs-bg-context-override:var(--app-canvas);--diffs-bg-context-gutter-override:var(--app-canvas);
 --diffs-addition-color-override:var(--success);--diffs-deletion-color-override:var(--destructive);
 --diffs-bg-addition-override:color-mix(in srgb,var(--success) 10%,var(--app-canvas));
 --diffs-bg-deletion-override:color-mix(in srgb,var(--destructive) 10%,var(--app-canvas));
 --diffs-bg-addition-emphasis-override:color-mix(in srgb,var(--success) 24%,transparent);
 --diffs-bg-deletion-emphasis-override:color-mix(in srgb,var(--destructive) 24%,transparent);
 --diffs-bg-separator-override:var(--muted);--diffs-bg-buffer-override:var(--app-canvas);
}
[data-diffs-header]{background:var(--app-canvas);color:var(--foreground);border:0;z-index:3}
[data-separator]{padding:3px 10px!important;height:38px!important;background:var(--app-canvas)!important;border:0!important;font-size:12px}
[data-gutter] [data-separator]{padding:3px 0 3px 8px!important}
[data-gutter] .dv-context{border-radius:8px 0 0 8px;max-width:32px}
[data-content] [data-separator]{padding-left:0!important}
[data-content] .dv-context{border-radius:0 8px 8px 0}
[data-separator-wrapper]{display:none!important}
.dv-context{height:32px;display:flex;align-items:center;border-radius:8px;background:var(--muted);color:var(--muted-foreground);font:12px system-ui;overflow:hidden;gap:2px;width:100%}
.dv-context button{display:flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer}
.dv-context button:hover{background:var(--accent)}.dv-context span{padding:0 9px;flex:1}
[data-line-type=change-addition][data-column-number]{box-shadow:inset 3px 0 var(--success)}
[data-line-type=change-deletion][data-column-number]{box-shadow:inset 3px 0 var(--destructive)}
[data-indicators=bars] [data-column-number]:before{width:3px!important}
[data-line-type=context]{background:var(--app-canvas)}
[data-diff-span]{border-radius:2px}
/* Pierre pads each file's bottom by 8px minus the scrollbar thickness; with overlay scrollbars that shows as a gap between files. */
[data-code]{padding-top:0!important;padding-bottom:0!important;scrollbar-gutter:auto!important}
[data-overflow=scroll] [data-code]{overflow-x:auto!important;scrollbar-width:none}
[data-overflow=scroll] [data-code]::-webkit-scrollbar{display:none}
.dv-spin{animation:dv-spin 1s linear infinite}@keyframes dv-spin{to{transform:rotate(360deg)}}
@media(max-width:640px){.dv-copy{display:none!important}.dv-file-state{max-width:23%}.dv-header{gap:5px;padding:0 8px}.dv-path{font-size:12px}}
@media(prefers-reduced-motion:reduce){.dv-spin{animation:none}}
`;
