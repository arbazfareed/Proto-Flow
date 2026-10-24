# ProtoFlow Private Beta Playbook

This is an operator runbook, not evidence that a beta has been launched. It provides the intake and triage process for a 14-day private beta. Recruiting people, sending invitations, provisioning private distribution, hosting Discord, running interviews, and approving a public launch require maintainer action and must be recorded with real results.

## Beta readiness and honest status

Before inviting testers, the maintainer must:

- Create an invite-only GitHub Release or other access-controlled download channel. Do not publish a private beta binary through a public release.
- Publish a signup form and manually approve applicants. No signup backend or beta mailing list is provisioned by this repository.
- Create a Discord `#beta-feedback` channel if Discord is selected. It is not automatically created by the app.
- Arrange the 15-minute getting-started video, shared roadmap, and weekly 1:1 availability.
- Protect release signing secrets and verify that the Windows release workflow is configured before distributing installers.
- Record beta start date, release tag, cohort size, and the owner for issue triage.

The app's **Beta feedback** button opens a public GitHub issue form. Tell testers that reports are public and must not contain project files, customer information, credentials, or secrets. Use a private channel for sensitive security reports rather than public issues.

## Recruitment target

Target 30–50 testers, including at least three current Axure RP users. Recruit across:

| Cohort | Target examples |
|---|---|
| Solo designers | Prototype screens, interactions, and handoff |
| Product managers | Validate flows and review changes |
| Indie developers | Inspect exports and responsive behavior |
| Students | Try learning and onboarding from a fresh install |
| Axure RP users | Recreate representative existing workflows and report specific parity gaps |

The maintainer should recruit through design communities and warm contacts, with a clear invitation and no implied NDA. Keep a private roster; never add tester names or contact details to public issues or analytics.

### Invitation copy

> **Subject: Invitation to test ProtoFlow**
>
> We are inviting a small group of designers and prototyping practitioners to test ProtoFlow for two weeks. We are especially interested in practical workflows involving interactions, responsive/device previews, dynamic panels, repeaters, expressions, and exports. There is no NDA. Please avoid using confidential project data and report issues through the in-app Beta feedback button. Beta builds may contain bugs and are not intended for critical work. Participation and feedback are voluntary.

## Tester onboarding

Send approved testers:

1. The private release link and exact version/checksum.
2. Install and update instructions for their OS.
3. A short getting-started video and a link to the current product roadmap.
4. The feedback form link and warning that GitHub reports are public.
5. A request to try one ordinary prototype workflow and, if applicable, compare one Axure RP workflow.
6. Interview scheduling details, if participating in a 1:1.

Do not promise features, fixes, privacy guarantees beyond the published policy, or that beta builds are production-ready.

## Feedback and triage

### Current repository-supported channel

- **In-app Beta feedback** opens `.github/ISSUE_TEMPLATE/beta-feedback.yml`.
- The form asks for severity (S1–S4), category, reproduction steps, expected/actual results, environment, and whether the report represents an Axure RP parity gap.
- The form warns against posting secrets or private project/customer information.

### Channels requiring operator setup

- Discord `#beta-feedback` is not provisioned by this repository.
- Weekly 1:1 calls require scheduling by the maintainer.
- Linear integration is not configured. GitHub Issues is the implemented intake path.

### Weekly triage

For each report, the maintainer should:

1. Confirm the report can be understood and reproduced; request sanitized details if needed.
2. Apply one severity label (`S1`, `S2`, `S3`, or `S4`) and one category label.
3. Apply `parity-gap` to Axure workflow mismatches; do not label a workflow as at parity without tester confirmation.
4. Assign an owner and next action. Link duplicates instead of losing the original report.
5. Treat any open S1 issue as a public-launch blocker.

Severity guide:

- **S1:** Core workflow blocked, data loss, or serious safety/privacy impact. Blocks public launch.
- **S2:** Major workflow unavailable without a practical workaround.
- **S3:** Feature impaired but a workaround exists.
- **S4:** Minor defect, polish, or enhancement.

## Two-week cadence and measurements

| Period | Operator activity |
|---|---|
| Before day 1 | Configure private distribution, approve testers, prepare onboarding/video/roadmap, validate install and update steps. |
| Days 1–3 | Confirm installation, collect first impressions, reproduce urgent issues. |
| Days 4–7 | Hold first triage; ship a patch with at least one verified fix when a fix is ready; re-test updater delivery. |
| Days 8–13 | Continue feedback and Axure workflow comparisons; hold follow-up calls; prepare second weekly patch if fixes are ready. |
| Day 14+ | Review the exit criteria below. Record evidence and approve, extend, or stop the beta. |

Track install count, DAU/WAU, feature adoption, crash-free rate, feedback count/sentiment, and parity confirmations. Existing opt-in analytics events cover `rule_created`, `variable_created`, `expression_used`, `panel_created`, `repeater_created`, and `export_used`; opt-in crash reporting provides crash signals only when configured. Analytics is not a beta roster and cannot identify Axure RP users. Do not infer user identities or parity confirmation from aggregate telemetry.

Maintain a private cohort sheet with aggregate counts and links to issue IDs. Do not include email addresses or private interview notes in repository files. Compute crash-free rate from a documented source and time window; if diagnostics are not configured or consented, mark the metric unavailable rather than estimating it.

## Axure RP workflow comparison checklist

Record one workflow per tester, with their permission. A parity confirmation requires an Axure RP user to say that the specified workflow works for their needs; a feature being present is not sufficient.

- [ ] Create and switch dynamic panel states; verify state-specific contents and transitions.
- [ ] Create a repeater from a template; test rows, data, and expected interactions.
- [ ] Use expressions/variables in a realistic interaction and validate resulting behavior.
- [ ] Build a flow diagram and add annotations or notes.
- [ ] Use rich text in a prototype screen.
- [ ] Preview at the target device sizes and responsive breakpoints.
- [ ] Export or share the prototype in the workflow the tester expects.
- [ ] Record the result, workaround, and a linked `parity-gap` issue for each mismatch.
- [ ] Obtain explicit tester confirmation before counting a workflow as parity-confirmed.

## Weekly patch and beta exit

Use the existing signed Windows release workflow for tagged release builds after verifying required signing secrets and update signatures. Release one weekly patch when a verified fix is available; record the release tag, fixes, and tester update result. Do not promise automatic updates until the signed release and updater path are confirmed for the distributed build.

Public launch requires evidence for all of the following:

- At least two weeks of beta.
- At least 20 actionable issues triaged.
- Zero open S1 issues.
- Crash-free users at or above 99% over the agreed measurement period, from a documented data source.
- At least five testers explicitly stating they would use ProtoFlow regularly.
- At least two Axure RP users explicitly confirming their named workflows.
- At least 30 testers recruited, including at least three Axure RP users.
- Maintainer approval after reviewing unresolved issues and release readiness.

Record the decision as **approved**, **extend beta**, or **blocked**, with links to evidence. Do not mark these exit criteria complete from repository tests or telemetry alone. Credit testers in a launch post only with permission; swag and early access are optional and require operator arrangements.
