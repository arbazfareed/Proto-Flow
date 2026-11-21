# Touch and mouse events

Interaction rules can respond to pointer and touch input. Choose an event that matches how a person is expected to use the prototype: click-like actions suit common desktop and touch flows, while hover behavior is only meaningful when a pointer can hover.

**Hover** runs once, when the mouse pointer moves onto a widget. To undo something a Hover rule did, add a second rule with **Mouse leave**, which runs once when the pointer moves off the widget. For example, Hover can show a tooltip and Mouse leave can hide it again. Both events work only on Mouse and Both screens.

Test interactions in Preview with the input method and device size you care about. A touch device does not have a persistent hover state, so do not make essential information or navigation available only on hover.

For accessibility and predictable prototypes, provide a clear tap/click action for important controls. Device emulation and actual hardware can differ; validate important touch behavior on the intended platform.
