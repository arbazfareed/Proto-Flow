# Product analytics

ProtoFlow's anonymous analytics use Umami only when the user opts in and both `VITE_UMAMI_ENDPOINT` and `VITE_UMAMI_WEBSITE_ID` are configured at build time. Without either value, telemetry is not transmitted. The settings dialog reports that state. Crash reporting is a separate preference.

## Event catalog

The client emits only the following names:

- Lifecycle: `app_launched`, `app_updated`, `app_crashed`
- Project: `project_created`, `project_opened`, `project_saved`
- Canvas: `shape_created`, `widget_created`, `symbol_created`
- Logic: `variable_created`, `rule_created`, `expression_used`
- Runtime: `preview_opened`, `preview_rule_fired`
- Advanced: `panel_created`, `panel_state_changed`, `repeater_created`, `repeater_row_added`, `flow_diagram_opened`, `annotation_added`, `rich_text_used`, `version_history_restored`
- Metered: `action_attempted`, `action_succeeded`, `action_failed`
- Export: `export_used`
- Sign-in: `signin_completed`
- Errors: `error_shown`

Properties are validated against fixed enums (widget/shape/action/export/provider/error categories) and bounded row counts. Project data, user-entered values, names, file paths, browser paths, referrers, cookies, and account/device identifiers are not sent. The Umami request uses a fixed URL and omits credentials. The client queues events, flushes on 20 events or after 30 seconds, retries transient failures a bounded number of times, and discards unsent events when consent is withdrawn.

## Dashboard setup and limits

Create an Umami website for ProtoFlow, configure the two build variables above in the trusted build environment, then use the Umami dashboard to review event counts and feature adoption (including panels, repeaters, expressions, and flow diagrams). Configure event-based goals there for first project, first shape, first rule, preview, and export. Do not use project names or event properties as dimensions.

No Umami endpoint or website ID is configured in this checkout, so a live dashboard, funnel, or digest cannot be verified or claimed. The client does not implement a weekly email digest or feedback-to-issue integration; those need separately configured provider APIs and an authorized recipient/destination. The payload deliberately contains no persistent identifier, so user-level DAU/WAU/MAU, retention, crash-free-user rates, and cohorts cannot be measured by this privacy-preserving event stream. Do not add a persistent identifier without a separate privacy review and explicit product decision.
