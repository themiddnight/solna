# Never delete feature branches

When finishing development work, do NOT delete the feature branch after merging into `main` — even though the `finishing-a-development-branch` skill's "merge locally" option includes `git branch -d`. The user keeps feature branches around for reference; the merge keeps all commits reachable, so the branch label should stay.

Integrate by merging locally WITHOUT deleting the branch.

Established 2026-08-30: I deleted `feat/DEV-365-steprow-chord-bass` and `feat/DEV-366-sp2-lead-melody-sequencer` after a local merge; the user asked to restore them (at 96598a3 and 671d6e9) and record this rule.